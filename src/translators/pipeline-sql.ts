/**
 * SQL Pipeline Translation — MongoDB-style aggregation pipeline → SQL query
 */

import type { SqlDialect } from '../types.js';
import { StrictDBError } from '../errors.js';
import type { FullSqlQuery } from './sql-builder.js';
import { translateToSQL, translateSortToSQL, quoteIdentifier } from './sql-filter.js';

// ─── Pipeline Translation (SQL) ──────────────────────────────────────────────

/**
 * Translate a MongoDB-style aggregation pipeline to a SQL query.
 * Walks stages in order and builds SELECT ... FROM ... JOIN ... WHERE ... GROUP BY ... ORDER BY ... LIMIT ... OFFSET.
 *
 * Supported stages: $match, $sort, $limit, $skip, $project, $group, $count, $lookup, $unwind, $addFields.
 * Unsupported stages throw PIPELINE_STAGE_UNSUPPORTED.
 */
export function translatePipelineToSQL(
  collection: string,
  pipeline: Record<string, unknown>[],
  dialect: SqlDialect,
): FullSqlQuery {
  // Accumulated query parts
  let selectColumns = '*';
  const joins: string[] = [];
  let whereClause = '';
  const whereValues: unknown[] = [];
  let groupByClause = '';
  let orderByClause = '';
  let limitClause = '';
  let offsetClause = '';
  const addFieldsExprs: string[] = [];

  let paramIdx = 1;

  for (const stage of pipeline) {
    const keys = Object.keys(stage);
    if (keys.length === 0) continue;
    const stageName = keys[0]!;
    const stageValue = stage[stageName];

    switch (stageName) {
      case '$match': {
        const filter = stageValue as Record<string, unknown>;
        const result = translateToSQL(filter, dialect, paramIdx);
        if (result.clause !== '1=1') {
          whereClause = whereClause ? `(${whereClause}) AND (${result.clause})` : result.clause;
          whereValues.push(...result.values);
          paramIdx += result.values.length;
        }
        break;
      }

      case '$sort': {
        const sort = stageValue as Record<string, unknown>;
        const sortStr = translateSortToSQL(sort);
        if (sortStr) orderByClause = sortStr;
        break;
      }

      case '$limit': {
        limitClause = `LIMIT ${Number(stageValue)}`;
        break;
      }

      case '$skip': {
        offsetClause = `OFFSET ${Number(stageValue)}`;
        break;
      }

      case '$project': {
        const proj = stageValue as Record<string, unknown>;
        const included = Object.entries(proj).filter(([, v]) => v === 1).map(([f]) => quoteIdentifier(f));
        if (included.length > 0) {
          selectColumns = included.join(', ');
        }
        // Exclusions can't be expressed without knowing all columns — leave as *
        break;
      }

      case '$group': {
        const group = stageValue as Record<string, unknown>;
        const idField = group['_id'];
        const groupByParts: string[] = [];
        const selectParts: string[] = [];

        // _id determines GROUP BY columns
        if (idField !== null && idField !== undefined && idField !== '') {
          if (typeof idField === 'string' && idField.startsWith('$')) {
            // e.g. _id: '$status' → GROUP BY "status"
            const col = idField.slice(1);
            groupByParts.push(quoteIdentifier(col));
            selectParts.push(quoteIdentifier(col));
          } else if (typeof idField === 'object' && idField !== null) {
            // e.g. _id: { status: '$status', region: '$region' }
            for (const [alias, expr] of Object.entries(idField as Record<string, unknown>)) {
              if (typeof expr === 'string' && expr.startsWith('$')) {
                const col = expr.slice(1);
                groupByParts.push(quoteIdentifier(col));
                selectParts.push(`${quoteIdentifier(col)} AS ${quoteIdentifier(alias)}`);
              }
            }
          }
        }

        // Accumulator fields
        for (const [field, accum] of Object.entries(group)) {
          if (field === '_id') continue;
          const accumObj = accum as Record<string, unknown>;
          const accumKeys = Object.keys(accumObj);
          if (accumKeys.length === 0) continue;
          const accumOp = accumKeys[0]!;
          const accumArg = accumObj[accumOp];

          switch (accumOp) {
            case '$sum':
              if (accumArg === 1 || accumArg === '1') {
                selectParts.push(`COUNT(*) AS ${quoteIdentifier(field)}`);
              } else if (typeof accumArg === 'string' && accumArg.startsWith('$')) {
                selectParts.push(`SUM(${quoteIdentifier(accumArg.slice(1))}) AS ${quoteIdentifier(field)}`);
              } else {
                selectParts.push(`SUM(${Number(accumArg)}) AS ${quoteIdentifier(field)}`);
              }
              break;
            case '$avg':
              if (typeof accumArg === 'string' && accumArg.startsWith('$')) {
                selectParts.push(`AVG(${quoteIdentifier(accumArg.slice(1))}) AS ${quoteIdentifier(field)}`);
              }
              break;
            case '$min':
              if (typeof accumArg === 'string' && accumArg.startsWith('$')) {
                selectParts.push(`MIN(${quoteIdentifier(accumArg.slice(1))}) AS ${quoteIdentifier(field)}`);
              }
              break;
            case '$max':
              if (typeof accumArg === 'string' && accumArg.startsWith('$')) {
                selectParts.push(`MAX(${quoteIdentifier(accumArg.slice(1))}) AS ${quoteIdentifier(field)}`);
              }
              break;
            case '$count':
              selectParts.push(`COUNT(*) AS ${quoteIdentifier(field)}`);
              break;
          }
        }

        if (selectParts.length > 0) selectColumns = selectParts.join(', ');
        if (groupByParts.length > 0) groupByClause = groupByParts.join(', ');
        break;
      }

      case '$count': {
        // $count: 'fieldName' → SELECT COUNT(*) AS "fieldName" with no GROUP BY
        const countField = stageValue as string;
        selectColumns = `COUNT(*) AS ${quoteIdentifier(countField)}`;
        groupByClause = '';
        break;
      }

      case '$lookup': {
        const lookup = stageValue as { from: string; localField: string; foreignField: string; as: string; type?: string };
        const joinType = lookup.type === 'inner' ? 'INNER JOIN' : 'LEFT JOIN';
        joins.push(
          `${joinType} ${quoteIdentifier(lookup.from)} ON ${quoteIdentifier(collection)}.${quoteIdentifier(lookup.localField)} = ${quoteIdentifier(lookup.from)}.${quoteIdentifier(lookup.foreignField)}`,
        );
        break;
      }

      case '$unwind':
        // $unwind is implicit in the JOIN — no standalone SQL equivalent, ignore
        break;

      case '$addFields': {
        const fields = stageValue as Record<string, unknown>;
        for (const [alias, expr] of Object.entries(fields)) {
          if (typeof expr === 'string' && expr.startsWith('$')) {
            addFieldsExprs.push(`${quoteIdentifier(expr.slice(1))} AS ${quoteIdentifier(alias)}`);
          } else if (typeof expr === 'object' && expr !== null) {
            // Simple arithmetic: { $multiply: ['$price', '$qty'] } → skip complex, just alias field
            addFieldsExprs.push(`NULL AS ${quoteIdentifier(alias)}`);
          }
        }
        // Rebuild selectColumns to include addFields expressions
        if (addFieldsExprs.length > 0) {
          if (selectColumns === '*') {
            selectColumns = `*, ${addFieldsExprs.join(', ')}`;
          } else {
            selectColumns = `${selectColumns}, ${addFieldsExprs.join(', ')}`;
          }
          addFieldsExprs.length = 0; // clear after merging
        }
        break;
      }

      default:
        throw new StrictDBError({
          code: 'PIPELINE_STAGE_UNSUPPORTED',
          message: `Pipeline stage "${stageName}" is not supported for SQL backends.`,
          fix: `Connect to MongoDB for full pipeline support. Supported SQL stages: $match, $sort, $limit, $skip, $project, $group, $count, $lookup, $unwind, $addFields.`,
          backend: 'sql',
        });
    }
  }

  // Build the final SQL for non-MSSQL dialects (MSSQL TOP/OFFSET FETCH not handled here for simplicity)
  let sqlStr = `SELECT ${selectColumns} FROM ${quoteIdentifier(collection)}`;

  if (joins.length > 0) {
    sqlStr += ` ${joins.join(' ')}`;
  }

  if (whereClause) {
    sqlStr += ` WHERE ${whereClause}`;
  }

  if (groupByClause) {
    sqlStr += ` GROUP BY ${groupByClause}`;
  }

  if (orderByClause) {
    sqlStr += ` ORDER BY ${orderByClause}`;
  }

  if (dialect === 'mssql') {
    // MSSQL: if skip+limit, use OFFSET FETCH; if limit only, use TOP
    const hasOffset = offsetClause !== '';
    const hasLimit = limitClause !== '';
    if (hasOffset) {
      const offsetNum = Number(offsetClause.replace('OFFSET ', ''));
      sqlStr += ` ORDER BY (SELECT NULL)`.replace('ORDER BY (SELECT NULL)', orderByClause ? '' : ' ORDER BY (SELECT NULL)');
      if (!orderByClause) sqlStr += ' ORDER BY (SELECT NULL)';
      sqlStr += ` OFFSET ${offsetNum} ROWS`;
      if (hasLimit) {
        const limitNum = Number(limitClause.replace('LIMIT ', ''));
        sqlStr += ` FETCH NEXT ${limitNum} ROWS ONLY`;
      }
    } else if (hasLimit) {
      const limitNum = Number(limitClause.replace('LIMIT ', ''));
      sqlStr = sqlStr.replace(`SELECT ${selectColumns}`, `SELECT TOP(${limitNum}) ${selectColumns}`);
    }
  } else {
    if (limitClause) sqlStr += ` ${limitClause}`;
    if (offsetClause) sqlStr += ` ${offsetClause}`;
  }

  return { sql: sqlStr, values: whereValues };
}
