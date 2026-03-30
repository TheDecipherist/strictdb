/**
 * SQL Query Builders — construct full SQL statements from filters, updates, projections
 */

import type { SqlDialect, UpdateOperators } from '../types.js';
import {
  translateToSQL,
  translateSortToSQL,
  translateUpdateToSQL,
  translateProjectionToSQL,
  quoteIdentifier,
  placeholder,
} from './sql-filter.js';

// ─── Build Full SQL Query ────────────────────────────────────────────────────

export interface FullSqlQuery {
  sql: string;
  values: unknown[];
}

export function buildSelectSQL(
  table: string,
  filter: Record<string, unknown>,
  options: {
    sort?: Record<string, unknown>;
    limit?: number;
    skip?: number;
    projection?: Record<string, 0 | 1>;
    dialect?: SqlDialect;
  } = {},
): FullSqlQuery {
  const dialect = options.dialect ?? 'pg';

  if (dialect === 'mssql') {
    return buildMssqlSelectSQL(table, filter, options);
  }

  const columns = options.projection
    ? translateProjectionToSQL(options.projection)
    : '*';

  const where = translateToSQL(filter, dialect);
  let sql = `SELECT ${columns} FROM ${quoteIdentifier(table)}`;

  if (where.clause !== '1=1') {
    sql += ` WHERE ${where.clause}`;
  }

  if (options.sort) {
    const orderBy = translateSortToSQL(options.sort);
    if (orderBy) sql += ` ORDER BY ${orderBy}`;
  }

  if (options.limit !== undefined) {
    sql += ` LIMIT ${Number(options.limit)}`;
  }

  if (options.skip !== undefined) {
    sql += ` OFFSET ${Number(options.skip)}`;
  }

  return { sql, values: where.values };
}

function buildMssqlSelectSQL(
  table: string,
  filter: Record<string, unknown>,
  options: {
    sort?: Record<string, unknown>;
    limit?: number;
    skip?: number;
    projection?: Record<string, 0 | 1>;
  },
): FullSqlQuery {
  const columns = options.projection
    ? translateProjectionToSQL(options.projection)
    : '*';

  const where = translateToSQL(filter, 'mssql');
  const hasSkip = options.skip !== undefined && options.skip > 0;
  const hasLimit = options.limit !== undefined;

  // MSSQL: skip+limit or skip-only → OFFSET FETCH (requires ORDER BY)
  if (hasSkip) {
    let sql = `SELECT ${columns} FROM ${quoteIdentifier(table)}`;
    if (where.clause !== '1=1') {
      sql += ` WHERE ${where.clause}`;
    }

    if (options.sort) {
      const orderBy = translateSortToSQL(options.sort);
      if (orderBy) sql += ` ORDER BY ${orderBy}`;
    } else {
      sql += ` ORDER BY (SELECT NULL)`;
    }

    sql += ` OFFSET ${Number(options.skip)} ROWS`;
    if (hasLimit) {
      sql += ` FETCH NEXT ${Number(options.limit)} ROWS ONLY`;
    }

    return { sql, values: where.values };
  }

  // MSSQL: limit only → SELECT TOP(n)
  if (hasLimit) {
    let sql = `SELECT TOP(${Number(options.limit)}) ${columns} FROM ${quoteIdentifier(table)}`;
    if (where.clause !== '1=1') {
      sql += ` WHERE ${where.clause}`;
    }
    if (options.sort) {
      const orderBy = translateSortToSQL(options.sort);
      if (orderBy) sql += ` ORDER BY ${orderBy}`;
    }
    return { sql, values: where.values };
  }

  // MSSQL: no pagination
  let sql = `SELECT ${columns} FROM ${quoteIdentifier(table)}`;
  if (where.clause !== '1=1') {
    sql += ` WHERE ${where.clause}`;
  }
  if (options.sort) {
    const orderBy = translateSortToSQL(options.sort);
    if (orderBy) sql += ` ORDER BY ${orderBy}`;
  }
  return { sql, values: where.values };
}

export function buildInsertSQL(
  table: string,
  doc: Record<string, unknown>,
  dialect: SqlDialect = 'pg',
): FullSqlQuery {
  const keys = Object.keys(doc);
  const vals = Object.values(doc);
  const columns = keys.map(k => quoteIdentifier(k)).join(', ');
  const placeholders = keys.map((_, i) => placeholder(dialect, i + 1)).join(', ');

  return {
    sql: `INSERT INTO ${quoteIdentifier(table)} (${columns}) VALUES (${placeholders})`,
    values: vals,
  };
}

export function buildBatchInsertSQL(
  table: string,
  docs: Record<string, unknown>[],
  dialect: SqlDialect = 'pg',
): FullSqlQuery {
  if (docs.length === 0) return { sql: '', values: [] };

  const keys = Object.keys(docs[0]!);
  const columns = keys.map(k => quoteIdentifier(k)).join(', ');
  const allValues: unknown[] = [];
  const rowPlaceholders: string[] = [];

  docs.forEach((doc, rowIdx) => {
    const placeholders = keys.map((_, colIdx) => placeholder(dialect, rowIdx * keys.length + colIdx + 1));
    rowPlaceholders.push(`(${placeholders.join(', ')})`);
    keys.forEach(k => allValues.push(doc[k]));
  });

  return {
    sql: `INSERT INTO ${quoteIdentifier(table)} (${columns}) VALUES ${rowPlaceholders.join(', ')}`,
    values: allValues,
  };
}

export function buildUpdateSQL(
  table: string,
  filter: Record<string, unknown>,
  update: UpdateOperators<Record<string, unknown>>,
  dialect: SqlDialect = 'pg',
): FullSqlQuery {
  const updateResult = translateUpdateToSQL(update, dialect);
  const where = translateToSQL(filter, dialect, updateResult.values.length + 1);

  let sql = `UPDATE ${quoteIdentifier(table)} SET ${updateResult.setClauses}`;
  if (where.clause !== '1=1') {
    sql += ` WHERE ${where.clause}`;
  }

  return { sql, values: [...updateResult.values, ...where.values] };
}

export function buildDeleteSQL(
  table: string,
  filter: Record<string, unknown>,
  dialect: SqlDialect = 'pg',
): FullSqlQuery {
  const where = translateToSQL(filter, dialect);

  let sql = `DELETE FROM ${quoteIdentifier(table)}`;
  if (where.clause !== '1=1') {
    sql += ` WHERE ${where.clause}`;
  }

  return { sql, values: where.values };
}

export function buildCountSQL(
  table: string,
  filter: Record<string, unknown>,
  dialect: SqlDialect = 'pg',
): FullSqlQuery {
  const where = translateToSQL(filter, dialect);
  let sql = `SELECT COUNT(*) as count FROM ${quoteIdentifier(table)}`;
  if (where.clause !== '1=1') {
    sql += ` WHERE ${where.clause}`;
  }
  return { sql, values: where.values };
}
