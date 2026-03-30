/**
 * Shared SQL Adapter Helpers
 *
 * Used by both SqlAdapter and SqlTransactionAdapter.
 * Extracted from sql-adapter.ts — pure code movement.
 */

import type {
  LookupOptions,
  SqlDialect,
  UpdateOperators,
} from '../types.js';
import {
  buildSelectSQL,
  buildInsertSQL,
  buildUpdateSQL,
  translateToSQL,
  getExcludedFields,
  quoteIdentifier,
} from '../filter-translator.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export type ExecFn = (sqlStr: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number }>;

export interface TxClient {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[]; rowCount: number }>;
}

// ─── Helper Functions ───────────────────────────────────────────────────────

/** Limit an UPDATE to a single row, dialect-aware. */
export function limitUpdateOne(
  baseSql: string,
  collection: string,
  whereClause: string,
  dialect: SqlDialect,
): string {
  if (whereClause === '1=1') return baseSql;
  switch (dialect) {
    case 'pg':
      return baseSql.replace(
        `WHERE ${whereClause}`,
        `WHERE ctid = (SELECT ctid FROM ${quoteIdentifier(collection)} WHERE ${whereClause} LIMIT 1)`,
      );
    case 'mysql2':
      return baseSql + ' LIMIT 1';
    case 'sqlite':
      return baseSql.replace(
        `WHERE ${whereClause}`,
        `WHERE rowid = (SELECT rowid FROM ${quoteIdentifier(collection)} WHERE ${whereClause} LIMIT 1)`,
      );
    case 'mssql': {
      // UPDATE TOP(1) "table" SET ... → insert TOP(1) after UPDATE
      return baseSql.replace(
        `UPDATE ${quoteIdentifier(collection)}`,
        `UPDATE TOP(1) ${quoteIdentifier(collection)}`,
      );
    }
  }
}

/** Limit a DELETE to a single row, dialect-aware. */
export function limitDeleteOne(
  baseSql: string,
  collection: string,
  whereClause: string,
  dialect: SqlDialect,
): string {
  if (whereClause === '1=1') return baseSql;
  switch (dialect) {
    case 'pg':
      return baseSql.replace(
        `WHERE ${whereClause}`,
        `WHERE ctid = (SELECT ctid FROM ${quoteIdentifier(collection)} WHERE ${whereClause} LIMIT 1)`,
      );
    case 'mysql2':
    case 'sqlite':
      return baseSql + ' LIMIT 1';
    case 'mssql':
      return baseSql.replace(
        `DELETE FROM ${quoteIdentifier(collection)}`,
        `DELETE TOP(1) FROM ${quoteIdentifier(collection)}`,
      );
  }
}

/** Perform upsert: UPDATE then INSERT if no rows matched. */
export async function performUpsert(
  execFn: ExecFn,
  collection: string,
  filter: Record<string, unknown>,
  update: UpdateOperators<Record<string, unknown>>,
  dialect: SqlDialect,
): Promise<{ rowCount: number; inserted: boolean }> {
  // 1. Try UPDATE (limited to 1 row)
  const updateQuery = buildUpdateSQL(collection, filter, update, dialect);
  const where = translateToSQL(filter, dialect);
  const limitedSql = limitUpdateOne(updateQuery.sql, collection, where.clause, dialect);
  const result = await execFn(limitedSql, updateQuery.values);

  if (result.rowCount > 0) {
    return { rowCount: result.rowCount, inserted: false };
  }

  // 2. No match → INSERT (merge filter equality fields + $set fields)
  const doc: Record<string, unknown> = {};

  // Add filter equality fields
  for (const [key, value] of Object.entries(filter)) {
    if (!key.startsWith('$') && (typeof value !== 'object' || value === null || value instanceof Date)) {
      doc[key] = value;
    }
  }

  // Add $set fields
  if (update.$set) {
    for (const [key, value] of Object.entries(update.$set)) {
      doc[key] = value;
    }
  }

  const insertQuery = buildInsertSQL(collection, doc, dialect);
  await execFn(insertQuery.sql, insertQuery.values);
  return { rowCount: 1, inserted: true };
}

/** Strip excluded fields from result rows. */
export function stripExcludedFields<T>(rows: T[], projection?: Record<string, 0 | 1>): T[] {
  if (!projection) return rows;
  const excluded = getExcludedFields(projection);
  if (!excluded) return rows;

  return rows.map(row => {
    const obj = { ...(row as Record<string, unknown>) };
    for (const field of excluded) {
      delete obj[field];
    }
    return obj as T;
  });
}

/** Two-query lookup: query main table, then related table, nest results. */
export async function performLookup<T>(
  execFn: ExecFn,
  collection: string,
  options: LookupOptions<T>,
  dialect: SqlDialect,
): Promise<T | null> {
  const { from, localField, foreignField, as: alias, type: joinType } = options.lookup;
  const isInner = joinType === 'inner';

  // 1. Query main table
  const mainQuery = buildSelectSQL(collection, options.match as Record<string, unknown>, {
    sort: options.sort as Record<string, unknown> | undefined,
    limit: 1,
    dialect,
  });
  const mainResult = await execFn(mainQuery.sql, mainQuery.values);
  const mainRow = mainResult.rows[0] as Record<string, unknown> | undefined;
  if (!mainRow) return null;

  // 2. Get the local field value and query related table
  const localValue = mainRow[localField];
  if (localValue === undefined || localValue === null) {
    if (isInner) return null;
    (mainRow as Record<string, unknown>)[alias] = [];
    return mainRow as T;
  }

  const relatedWhere = translateToSQL({ [foreignField]: localValue }, dialect);
  let relatedSql = `SELECT * FROM ${quoteIdentifier(from)}`;
  if (relatedWhere.clause !== '1=1') {
    relatedSql += ` WHERE ${relatedWhere.clause}`;
  }
  const relatedResult = await execFn(relatedSql, relatedWhere.values);

  if (isInner && relatedResult.rows.length === 0) {
    return null;
  }

  (mainRow as Record<string, unknown>)[alias] = relatedResult.rows;
  return mainRow as T;
}
