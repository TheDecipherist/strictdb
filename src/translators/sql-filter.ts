/**
 * SQL Filter Translation — MongoDB-style filters → parameterized SQL WHERE clauses
 */

import type { SqlDialect, SqlTranslation, UpdateOperators } from '../types.js';
import { StrictDBError } from '../errors.js';

// ─── SQL Filter Translation ──────────────────────────────────────────────────

/**
 * Translate a MongoDB-style filter to a parameterized SQL WHERE clause.
 * Returns { clause, values } where clause uses $1, $2, ... placeholders.
 */
export function translateToSQL(
  filter: Record<string, unknown>,
  dialect: SqlDialect = 'pg',
  startIdx = 1,
): SqlTranslation {
  if (!filter || Object.keys(filter).length === 0) {
    return { clause: '1=1', values: [] };
  }

  const parts: string[] = [];
  const values: unknown[] = [];
  let paramIdx = startIdx;

  for (const [key, value] of Object.entries(filter)) {
    // Logical operators
    if (key === '$and' || key === '$or' || key === '$nor') {
      const filters = value as Record<string, unknown>[];
      if (!Array.isArray(filters) || filters.length === 0) continue;

      const subClauses: string[] = [];
      for (const subFilter of filters) {
        const sub = translateToSQL(subFilter, dialect, paramIdx);
        if (sub.clause && sub.clause !== '1=1') {
          subClauses.push(`(${sub.clause})`);
          values.push(...sub.values);
          paramIdx += sub.values.length;
        }
      }

      if (subClauses.length > 0) {
        if (key === '$nor') {
          parts.push(`NOT (${subClauses.join(' OR ')})`);
        } else {
          const joiner = key === '$and' ? ' AND ' : ' OR ';
          parts.push(`(${subClauses.join(joiner)})`);
        }
      }
      continue;
    }

    // Field-level conditions
    if (key.startsWith('$')) {
      throw new StrictDBError({
        code: 'UNKNOWN_OPERATOR',
        message: `Top-level operator "${key}" is not supported in filter.`,
        fix: `Supported top-level operators: $and, $or, $nor. Field operators ($gt, $lt, etc.) must be nested inside a field: { fieldName: { ${key}: value } }.`,
        backend: 'sql',
      });
    }

    const quotedKey = quoteIdentifier(key);

    if (value === null || value === undefined) {
      parts.push(`${quotedKey} IS NULL`);
      continue;
    }

    if (typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date) && !(value instanceof RegExp)) {
      // Operator object: { $gt: 10, $lt: 20 }
      const ops = value as Record<string, unknown>;
      for (const [op, opVal] of Object.entries(ops)) {
        const result = translateOperatorToSQL(quotedKey, op, opVal, dialect, paramIdx);
        parts.push(result.clause);
        values.push(...result.values);
        paramIdx += result.values.length;
      }
      continue;
    }

    // Direct equality: { field: value }
    parts.push(`${quotedKey} = ${placeholder(dialect, paramIdx)}`);
    values.push(value);
    paramIdx++;
  }

  return {
    clause: parts.length > 0 ? parts.join(' AND ') : '1=1',
    values,
  };
}

function translateOperatorToSQL(
  quotedKey: string,
  op: string,
  value: unknown,
  dialect: SqlDialect,
  paramIdx: number,
): SqlTranslation {
  switch (op) {
    case '$eq':
      if (value === null) return { clause: `${quotedKey} IS NULL`, values: [] };
      return { clause: `${quotedKey} = ${placeholder(dialect, paramIdx)}`, values: [value] };

    case '$ne':
      if (value === null) return { clause: `${quotedKey} IS NOT NULL`, values: [] };
      return { clause: `${quotedKey} != ${placeholder(dialect, paramIdx)}`, values: [value] };

    case '$gt':
      return { clause: `${quotedKey} > ${placeholder(dialect, paramIdx)}`, values: [value] };

    case '$gte':
      return { clause: `${quotedKey} >= ${placeholder(dialect, paramIdx)}`, values: [value] };

    case '$lt':
      return { clause: `${quotedKey} < ${placeholder(dialect, paramIdx)}`, values: [value] };

    case '$lte':
      return { clause: `${quotedKey} <= ${placeholder(dialect, paramIdx)}`, values: [value] };

    case '$in': {
      const arr = value as unknown[];
      if (!Array.isArray(arr) || arr.length === 0) {
        return { clause: '1=0', values: [] }; // Empty IN → always false
      }
      const placeholders = arr.map((_, i) => placeholder(dialect, paramIdx + i)).join(', ');
      return { clause: `${quotedKey} IN (${placeholders})`, values: arr };
    }

    case '$nin': {
      const arr = value as unknown[];
      if (!Array.isArray(arr) || arr.length === 0) {
        return { clause: '1=1', values: [] }; // Empty NOT IN → always true
      }
      const placeholders = arr.map((_, i) => placeholder(dialect, paramIdx + i)).join(', ');
      return { clause: `${quotedKey} NOT IN (${placeholders})`, values: arr };
    }

    case '$exists':
      return value
        ? { clause: `${quotedKey} IS NOT NULL`, values: [] }
        : { clause: `${quotedKey} IS NULL`, values: [] };

    case '$regex': {
      const pattern = value instanceof RegExp ? value.source : String(value);
      return translateRegexToSQL(quotedKey, pattern, dialect, paramIdx);
    }

    case '$options':
      // Handled as part of $regex — skip standalone
      return { clause: '', values: [] };

    case '$not': {
      const sub = value as Record<string, unknown>;
      const parts: string[] = [];
      const values: unknown[] = [];
      let idx = paramIdx;
      for (const [subOp, subVal] of Object.entries(sub)) {
        const result = translateOperatorToSQL(quotedKey, subOp, subVal, dialect, idx);
        if (result.clause) {
          parts.push(result.clause);
          values.push(...result.values);
          idx += result.values.length;
        }
      }
      if (parts.length === 0) return { clause: '', values: [] };
      return { clause: `NOT (${parts.join(' AND ')})`, values };
    }

    case '$size':
      // SQL doesn't have native array size — use jsonb_array_length for PG, JSON_LENGTH for MySQL
      if (dialect === 'pg') {
        return {
          clause: `jsonb_array_length(${quotedKey}) = ${placeholder(dialect, paramIdx)}`,
          values: [value],
        };
      }
      if (dialect === 'mysql2') {
        return {
          clause: `JSON_LENGTH(${quotedKey}) = ${placeholder(dialect, paramIdx)}`,
          values: [value],
        };
      }
      // SQLite/MSSQL — JSON array length
      return {
        clause: `json_array_length(${quotedKey}) = ${placeholder(dialect, paramIdx)}`,
        values: [value],
      };

    default:
      throw new StrictDBError({
        code: 'UNKNOWN_OPERATOR',
        message: `Unknown filter operator "${op}".`,
        fix: `Supported operators: $eq, $ne, $gt, $gte, $lt, $lte, $in, $nin, $exists, $regex, $not, $size.`,
        backend: 'sql',
      });
  }
}

function translateRegexToSQL(
  quotedKey: string,
  pattern: string,
  dialect: SqlDialect,
  paramIdx: number,
): SqlTranslation {
  switch (dialect) {
    case 'pg':
      return { clause: `${quotedKey} ~ ${placeholder(dialect, paramIdx)}`, values: [pattern] };
    case 'mysql2':
      return { clause: `${quotedKey} REGEXP ${placeholder(dialect, paramIdx)}`, values: [pattern] };
    case 'mssql':
      // MSSQL doesn't support REGEXP natively — convert simple patterns to LIKE
      return regexToLike(quotedKey, pattern, dialect, paramIdx);
    case 'sqlite':
      // SQLite REGEXP requires an extension — use LIKE for simple patterns, GLOB for others
      return regexToLike(quotedKey, pattern, dialect, paramIdx);
  }
}

function regexToLike(
  quotedKey: string,
  pattern: string,
  dialect: SqlDialect,
  paramIdx: number,
): SqlTranslation {
  // Convert simple regex anchors to LIKE patterns
  let likePattern = pattern;

  // Escape LIKE special chars in the original pattern (except our anchors)
  likePattern = likePattern.replace(/[%_]/g, (ch) => `\\${ch}`);

  // Replace regex anchors
  const startsWithAnchor = likePattern.startsWith('^');
  const endsWithAnchor = likePattern.endsWith('$');

  if (startsWithAnchor) likePattern = likePattern.slice(1);
  if (endsWithAnchor) likePattern = likePattern.slice(0, -1);

  // Replace common regex patterns
  likePattern = likePattern.replace(/\.\*/g, '%').replace(/\./g, '_');

  if (!startsWithAnchor) likePattern = '%' + likePattern;
  if (!endsWithAnchor) likePattern = likePattern + '%';

  return {
    clause: `${quotedKey} LIKE ${placeholder(dialect, paramIdx)}`,
    values: [likePattern],
  };
}

// ─── SQL Sort Translation ────────────────────────────────────────────────────

export function translateSortToSQL(sort: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [field, dir] of Object.entries(sort)) {
    const direction = dir === -1 || dir === 'desc' ? 'DESC' : 'ASC';
    parts.push(`${quoteIdentifier(field)} ${direction}`);
  }
  return parts.length > 0 ? parts.join(', ') : '';
}

// ─── SQL Update Translation ──────────────────────────────────────────────────

export interface SqlUpdateTranslation {
  setClauses: string;
  values: unknown[];
}

export function translateUpdateToSQL(
  update: UpdateOperators<Record<string, unknown>>,
  dialect: SqlDialect = 'pg',
  startIdx = 1,
): SqlUpdateTranslation {
  const setClauses: string[] = [];
  const values: unknown[] = [];
  let paramIdx = startIdx;

  // $set → SET "field" = $N
  if (update.$set) {
    for (const [field, value] of Object.entries(update.$set)) {
      setClauses.push(`${quoteIdentifier(field)} = ${placeholder(dialect, paramIdx)}`);
      values.push(value);
      paramIdx++;
    }
  }

  // $inc → SET "field" = "field" + $N
  if (update.$inc) {
    for (const [field, amount] of Object.entries(update.$inc)) {
      setClauses.push(`${quoteIdentifier(field)} = ${quoteIdentifier(field)} + ${placeholder(dialect, paramIdx)}`);
      values.push(amount);
      paramIdx++;
    }
  }

  // $unset → SET "field" = NULL
  if (update.$unset) {
    for (const field of Object.keys(update.$unset)) {
      setClauses.push(`${quoteIdentifier(field)} = NULL`);
    }
  }

  if (setClauses.length === 0) {
    throw new StrictDBError({
      code: 'QUERY_ERROR',
      message: 'Update operation has no SET clauses.',
      fix: 'Provide at least one update operator: $set, $inc, or $unset.',
      backend: 'sql',
    });
  }

  return { setClauses: setClauses.join(', '), values };
}

// ─── SQL Projection Translation ──────────────────────────────────────────────

export function translateProjectionToSQL(projection: Record<string, 0 | 1>): string {
  const included = Object.entries(projection).filter(([, v]) => v === 1);
  const excluded = Object.entries(projection).filter(([, v]) => v === 0);

  if (included.length > 0) {
    return included.map(([field]) => quoteIdentifier(field)).join(', ');
  }

  // If only exclusions, we can't easily express this in SQL without knowing all columns
  // Return * and let the adapter handle it
  if (excluded.length > 0) {
    return '*';
  }

  return '*';
}

/**
 * Returns an array of field names to exclude when projection is exclusion-only
 * (e.g. { password: 0 }), or null if the projection is inclusion-based or empty.
 */
export function getExcludedFields(projection: Record<string, 0 | 1>): string[] | null {
  const entries = Object.entries(projection);
  if (entries.length === 0) return null;

  const allExclusions = entries.every(([, v]) => v === 0);
  if (!allExclusions) return null;

  return entries.map(([field]) => field);
}

// ─── SQL Helper Functions ────────────────────────────────────────────────────

export function quoteIdentifier(name: string): string {
  // Prevent SQL injection through identifier names
  const sanitized = name.replace(/"/g, '""');
  return `"${sanitized}"`;
}

export function placeholder(dialect: SqlDialect, idx: number): string {
  switch (dialect) {
    case 'pg':
      return `$${idx}`;
    case 'mysql2':
      return '?';
    case 'mssql':
      return `@p${idx}`;
    case 'sqlite':
      return '?';
  }
}
