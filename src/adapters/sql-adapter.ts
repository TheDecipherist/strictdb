/**
 * StrictDB SQL Adapter
 *
 * Wraps core/db/sql.ts. Uses filter-translator.ts to convert
 * MongoDB-style filters to parameterized SQL.
 */

import type { DatabaseAdapter } from './adapter.js';
import type {
  Backend,
  ConfirmOptions,
  ConnectionStatus,
  Driver,
  LookupOptions,
  NativeBulkWriteOp,
  OperationReceipt,
  QueryOptions,
  SqlDialect,
  StrictDBConfig,
  StrictFilter,
  UpdateOperators,
} from '../types.js';
import { mapNativeError, StrictDBError } from '../errors.js';
import { createReceipt } from '../receipts.js';
import type { StrictDBEventEmitter } from '../events.js';
import { ReconnectManager } from '../reconnect.js';
import * as sql from '../core/db/sql.js';
import {
  buildSelectSQL,
  buildInsertSQL,
  buildBatchInsertSQL,
  buildUpdateSQL,
  buildDeleteSQL,
  buildCountSQL,
  translateToSQL,
  translatePipelineToSQL,
  getExcludedFields,
  quoteIdentifier,
} from '../filter-translator.js';

import { SqlTransactionAdapter } from './sql-tx-adapter.js';

// ─── Shared Helpers (used by both SqlAdapter and SqlTransactionAdapter) ──────

export type ExecFn = (sqlStr: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number }>;

export interface TxClient {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[]; rowCount: number }>;
}

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

export class SqlAdapter implements DatabaseAdapter {
  readonly backend: Backend = 'sql';
  readonly driver: Driver;

  private config: StrictDBConfig;
  private dialect: SqlDialect;
  private emitter: StrictDBEventEmitter;
  private reconnectManager: ReconnectManager;
  private connectedAt: Date | null = null;

  constructor(config: StrictDBConfig, emitter: StrictDBEventEmitter) {
    this.config = config;
    this.emitter = emitter;
    this.dialect = detectDialect(config.uri);
    this.driver = dialectToDriver(this.dialect);
    this.reconnectManager = new ReconnectManager(config.reconnect, emitter, 'sql');
  }

  async connect(): Promise<void> {
    try {
      await sql.connect(this.config.uri, {
        pool: this.config.pool,
        label: this.config.label,
      });
      this.connectedAt = new Date();
      this.emitter.emit('connected', {
        backend: 'sql',
        dbName: this.config.dbName ?? extractDbName(this.config.uri),
        label: this.config.label ?? 'SQL',
      });
    } catch (err) {
      throw mapNativeError('sql', err);
    }
  }

  async close(): Promise<void> {
    this.reconnectManager.stop();
    await sql.closePool();
    this.connectedAt = null;
  }

  status(): ConnectionStatus {
    return {
      state: this.connectedAt ? 'connected' : 'disconnected',
      backend: 'sql',
      driver: this.driver,
      uri: redactUri(this.config.uri),
      dbName: this.config.dbName ?? extractDbName(this.config.uri),
      uptimeMs: this.connectedAt ? Date.now() - this.connectedAt.getTime() : 0,
      pool: { active: 0, idle: 0, waiting: 0, max: 10 },
      reconnect: {
        enabled: this.reconnectManager.enabled,
        attempts: this.reconnectManager.attemptCount,
        lastDisconnect: this.reconnectManager.lastDisconnect,
      },
    };
  }

  async queryOne<T>(collection: string, filter: StrictFilter<T>, options?: QueryOptions<T>): Promise<T | null> {
    try {
      const query = buildSelectSQL(
        collection,
        filter as Record<string, unknown>,
        {
          sort: options?.sort as Record<string, unknown> | undefined,
          limit: 1,
          skip: options?.skip,
          projection: options?.projection as Record<string, 0 | 1> | undefined,
          dialect: this.dialect,
        },
      );
      const result = await sql.queryOne<T>(query.sql, query.values);
      if (!result) return null;
      const stripped = stripExcludedFields([result], options?.projection as Record<string, 0 | 1> | undefined);
      return stripped[0] ?? null;
    } catch (err) {
      throw mapNativeError('sql', err, collection, 'queryOne');
    }
  }

  async queryMany<T>(collection: string, filter: StrictFilter<T>, options?: QueryOptions<T>): Promise<T[]> {
    try {
      const query = buildSelectSQL(
        collection,
        filter as Record<string, unknown>,
        {
          sort: options?.sort as Record<string, unknown> | undefined,
          limit: options?.limit,
          skip: options?.skip,
          projection: options?.projection as Record<string, 0 | 1> | undefined,
          dialect: this.dialect,
        },
      );
      const results = await sql.queryMany<T>(query.sql, query.values);
      return stripExcludedFields(results, options?.projection as Record<string, 0 | 1> | undefined);
    } catch (err) {
      throw mapNativeError('sql', err, collection, 'queryMany');
    }
  }

  async queryWithLookup<T>(collection: string, options: LookupOptions<T>): Promise<T | null> {
    try {
      const execFn: ExecFn = (s, p) => sql.getPool().query(s, p);
      return await performLookup(execFn, collection, options, this.dialect);
    } catch (err) {
      throw mapNativeError('sql', err, collection, 'queryWithLookup');
    }
  }

  async count<T>(collection: string, filter?: StrictFilter<T>): Promise<number> {
    try {
      const query = buildCountSQL(collection, (filter ?? {}) as Record<string, unknown>, this.dialect);
      const result = await sql.queryOne<{ count: string | number }>(query.sql, query.values);
      return Number(result?.count ?? 0);
    } catch (err) {
      throw mapNativeError('sql', err, collection, 'count');
    }
  }

  async insertOne<T>(collection: string, doc: T): Promise<OperationReceipt> {
    const startTime = Date.now();
    try {
      const query = buildInsertSQL(collection, doc as Record<string, unknown>, this.dialect);
      let insertedId: string | undefined;

      if (this.dialect === 'pg') {
        const sqlStr = `${query.sql} RETURNING id`;
        const result = await sql.execute(sqlStr, query.values);
        insertedId = (result.rows?.[0] as Record<string, unknown>)?.['id']?.toString();
      } else if (this.dialect === 'mysql2') {
        await sql.execute(query.sql, query.values);
        const idResult = await sql.execute('SELECT LAST_INSERT_ID() AS id', []);
        insertedId = (idResult.rows?.[0] as Record<string, unknown>)?.['id']?.toString();
      } else if (this.dialect === 'sqlite') {
        await sql.execute(query.sql, query.values);
        const idResult = await sql.execute('SELECT last_insert_rowid() AS id', []);
        insertedId = (idResult.rows?.[0] as Record<string, unknown>)?.['id']?.toString();
      } else if (this.dialect === 'mssql') {
        const sqlStr = `${query.sql}; SELECT SCOPE_IDENTITY() AS id`;
        const result = await sql.execute(sqlStr, query.values);
        insertedId = (result.rows?.[0] as Record<string, unknown>)?.['id']?.toString();
      }

      return createReceipt({
        operation: 'insertOne',
        collection,
        backend: 'sql',
        startTime,
        insertedCount: 1,
        insertedId,
      });
    } catch (err) {
      throw mapNativeError('sql', err, collection, 'insertOne');
    }
  }

  async insertMany<T>(collection: string, docs: T[]): Promise<OperationReceipt> {
    const startTime = Date.now();
    try {
      const query = buildBatchInsertSQL(collection, docs as Record<string, unknown>[], this.dialect);
      let insertedIds: string[] | undefined;

      if (this.dialect === 'pg' && query.sql) {
        const sqlStr = `${query.sql} RETURNING id`;
        const result = await sql.execute(sqlStr, query.values);
        const ids = (result.rows ?? [])
          .map(r => (r as Record<string, unknown>)['id']?.toString())
          .filter((id): id is string => id !== undefined);
        if (ids.length > 0) insertedIds = ids;
      } else if (query.sql) {
        // mysql2, sqlite, mssql: bulk ID retrieval not supported — insertedIds left undefined
        await sql.execute(query.sql, query.values);
      }

      return createReceipt({
        operation: 'insertMany',
        collection,
        backend: 'sql',
        startTime,
        insertedCount: docs.length,
        insertedIds,
      });
    } catch (err) {
      throw mapNativeError('sql', err, collection, 'insertMany');
    }
  }

  async updateOne<T>(collection: string, filter: StrictFilter<T>, update: UpdateOperators<T>, upsert?: boolean): Promise<OperationReceipt> {
    const startTime = Date.now();
    try {
      const execFn: ExecFn = (s, p) => sql.getPool().query(s, p);
      const filterRec = filter as Record<string, unknown>;
      const updateRec = update as UpdateOperators<Record<string, unknown>>;

      if (upsert) {
        const { rowCount, inserted } = await performUpsert(execFn, collection, filterRec, updateRec, this.dialect);
        return createReceipt({
          operation: 'updateOne',
          collection,
          backend: 'sql',
          startTime,
          matchedCount: inserted ? 0 : rowCount,
          modifiedCount: inserted ? 0 : rowCount,
          insertedCount: inserted ? 1 : 0,
        });
      }

      const query = buildUpdateSQL(collection, filterRec, updateRec, this.dialect);
      const where = translateToSQL(filterRec, this.dialect);
      const limitedSql = limitUpdateOne(query.sql, collection, where.clause, this.dialect);
      const result = await sql.execute(limitedSql, query.values);
      return createReceipt({
        operation: 'updateOne',
        collection,
        backend: 'sql',
        startTime,
        matchedCount: result.rowCount,
        modifiedCount: result.rowCount,
      });
    } catch (err) {
      throw mapNativeError('sql', err, collection, 'updateOne');
    }
  }

  async updateMany<T>(collection: string, filter: StrictFilter<T>, update: UpdateOperators<T>): Promise<OperationReceipt> {
    const startTime = Date.now();
    try {
      const query = buildUpdateSQL(
        collection,
        filter as Record<string, unknown>,
        update as UpdateOperators<Record<string, unknown>>,
        this.dialect,
      );
      const result = await sql.execute(query.sql, query.values);
      return createReceipt({
        operation: 'updateMany',
        collection,
        backend: 'sql',
        startTime,
        matchedCount: result.rowCount,
        modifiedCount: result.rowCount,
      });
    } catch (err) {
      throw mapNativeError('sql', err, collection, 'updateMany');
    }
  }

  async deleteOne<T>(collection: string, filter: StrictFilter<T>, _options?: ConfirmOptions): Promise<OperationReceipt> {
    const startTime = Date.now();
    try {
      const query = buildDeleteSQL(collection, filter as Record<string, unknown>, this.dialect);
      const where = translateToSQL(filter as Record<string, unknown>, this.dialect);
      const limitedSql = limitDeleteOne(query.sql, collection, where.clause, this.dialect);
      const result = await sql.execute(limitedSql, query.values);
      return createReceipt({
        operation: 'deleteOne',
        collection,
        backend: 'sql',
        startTime,
        deletedCount: result.rowCount,
      });
    } catch (err) {
      throw mapNativeError('sql', err, collection, 'deleteOne');
    }
  }

  async deleteMany<T>(collection: string, filter: StrictFilter<T>, _options?: ConfirmOptions): Promise<OperationReceipt> {
    const startTime = Date.now();
    try {
      const query = buildDeleteSQL(collection, filter as Record<string, unknown>, this.dialect);
      const result = await sql.execute(query.sql, query.values);
      return createReceipt({
        operation: 'deleteMany',
        collection,
        backend: 'sql',
        startTime,
        deletedCount: result.rowCount,
      });
    } catch (err) {
      throw mapNativeError('sql', err, collection, 'deleteMany');
    }
  }

  async aggregate<T>(collection: string, pipeline: Record<string, unknown>[]): Promise<T[]> {
    try {
      const { sql: sqlStr, values } = translatePipelineToSQL(collection, pipeline, this.dialect);
      const result = await sql.execute(sqlStr, values);
      return (result.rows ?? []) as T[];
    } catch (err) {
      if (err instanceof StrictDBError) throw err;
      throw mapNativeError('sql', err, collection, 'aggregate');
    }
  }

  async nativeBulkWrite(collection: string, operations: NativeBulkWriteOp[]): Promise<{
    insertedCount: number;
    modifiedCount: number;
    deletedCount: number;
    insertedIds?: string[];
    upsertedIds?: string[];
  }> {
    return sql.withTransaction(async (client) => {
      const execFn: ExecFn = (s, p) => client.query(s, p);
      let insertedCount = 0;
      let modifiedCount = 0;
      let deletedCount = 0;
      const insertedIds: string[] = [];
      const upsertedIds: string[] = [];

      for (const op of operations) {
        if ('insertOne' in op) {
          const query = buildInsertSQL(collection, op.insertOne.document, this.dialect);
          insertedCount++;
          let id: string | undefined;
          if (this.dialect === 'pg') {
            const result = await client.query(`${query.sql} RETURNING id`, query.values);
            id = (result.rows?.[0] as Record<string, unknown>)?.['id']?.toString();
          } else if (this.dialect === 'mysql2') {
            await client.query(query.sql, query.values);
            const idResult = await client.query('SELECT LAST_INSERT_ID() AS id', []);
            id = (idResult.rows?.[0] as Record<string, unknown>)?.['id']?.toString();
          } else if (this.dialect === 'sqlite') {
            await client.query(query.sql, query.values);
            const idResult = await client.query('SELECT last_insert_rowid() AS id', []);
            id = (idResult.rows?.[0] as Record<string, unknown>)?.['id']?.toString();
          } else if (this.dialect === 'mssql') {
            const result = await client.query(`${query.sql}; SELECT SCOPE_IDENTITY() AS id`, query.values);
            id = (result.rows?.[0] as Record<string, unknown>)?.['id']?.toString();
          }
          if (id) insertedIds.push(id);

        } else if ('updateOne' in op) {
          const { filter, update, upsert } = op.updateOne;
          const updateOps = update as UpdateOperators<Record<string, unknown>>;
          if (upsert) {
            const { rowCount, inserted } = await performUpsert(execFn, collection, filter, updateOps, this.dialect);
            if (inserted) { insertedCount++; } else { modifiedCount += rowCount; }
          } else {
            const query = buildUpdateSQL(collection, filter, updateOps, this.dialect);
            const where = translateToSQL(filter, this.dialect);
            const limitedSql = limitUpdateOne(query.sql, collection, where.clause, this.dialect);
            const result = await client.query(limitedSql, query.values);
            modifiedCount += result.rowCount;
          }

        } else if ('updateMany' in op) {
          const { filter, update } = op.updateMany;
          const query = buildUpdateSQL(collection, filter, update as UpdateOperators<Record<string, unknown>>, this.dialect);
          const result = await client.query(query.sql, query.values);
          modifiedCount += result.rowCount;

        } else if ('deleteOne' in op) {
          const { filter } = op.deleteOne;
          const query = buildDeleteSQL(collection, filter, this.dialect);
          const where = translateToSQL(filter, this.dialect);
          const limitedSql = limitDeleteOne(query.sql, collection, where.clause, this.dialect);
          const result = await client.query(limitedSql, query.values);
          deletedCount += result.rowCount;

        } else if ('deleteMany' in op) {
          const { filter } = op.deleteMany;
          const query = buildDeleteSQL(collection, filter, this.dialect);
          const result = await client.query(query.sql, query.values);
          deletedCount += result.rowCount;

        } else if ('replaceOne' in op) {
          const { filter, replacement, upsert } = op.replaceOne;
          // replaceOne: delete + insert (or upsert)
          if (upsert) {
            // Check if exists
            const countQuery = buildCountSQL(collection, filter, this.dialect);
            const countResult = await client.query(countQuery.sql, countQuery.values);
            const cnt = Number((countResult.rows[0] as Record<string, unknown>)?.['count'] ?? 0);
            if (cnt > 0) {
              // Delete the matched row and re-insert
              const delQuery = buildDeleteSQL(collection, filter, this.dialect);
              const where = translateToSQL(filter, this.dialect);
              const limitedDelSql = limitDeleteOne(delQuery.sql, collection, where.clause, this.dialect);
              await client.query(limitedDelSql, delQuery.values);
              const insQuery = buildInsertSQL(collection, replacement, this.dialect);
              await client.query(insQuery.sql, insQuery.values);
              modifiedCount++;
            } else {
              const insQuery = buildInsertSQL(collection, replacement, this.dialect);
              await client.query(insQuery.sql, insQuery.values);
              insertedCount++;
              upsertedIds.push('');
            }
          } else {
            const delQuery = buildDeleteSQL(collection, filter, this.dialect);
            const where = translateToSQL(filter, this.dialect);
            const limitedDelSql = limitDeleteOne(delQuery.sql, collection, where.clause, this.dialect);
            const delResult = await client.query(limitedDelSql, delQuery.values);
            if (delResult.rowCount > 0) {
              const insQuery = buildInsertSQL(collection, replacement, this.dialect);
              await client.query(insQuery.sql, insQuery.values);
              modifiedCount++;
            }
          }
        }
      }

      return {
        insertedCount,
        modifiedCount,
        deletedCount,
        insertedIds: insertedIds.length > 0 ? insertedIds : undefined,
        upsertedIds: upsertedIds.length > 0 ? upsertedIds : undefined,
      };
    }, this.dialect);
  }

  async withTransaction<T>(fn: (txAdapter: DatabaseAdapter) => Promise<T>): Promise<T> {
    return sql.withTransaction(async (client) => {
      const txAdapter = new SqlTransactionAdapter(client, this.dialect, this.driver);
      return fn(txAdapter);
    }, this.dialect);
  }

  async ensureCollections(definitions: Array<{ name: string; sql?: string }>): Promise<void> {
    for (const def of definitions) {
      if (def.sql) {
        await sql.execute(def.sql);
      }
    }
  }

  async describeCollection(collection: string): Promise<Array<{ name: string; type: string; required: boolean }>> {
    try {
      if (this.dialect === 'pg') {
        const rows = await sql.queryMany<{ column_name: string; data_type: string; is_nullable: string }>(
          `SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = $1 ORDER BY ordinal_position`,
          [collection],
        );
        return rows.map(r => ({
          name: r.column_name,
          type: r.data_type,
          required: r.is_nullable === 'NO',
        }));
      }

      if (this.dialect === 'sqlite') {
        const rows = await sql.queryMany<{ name: string; type: string; notnull: number }>(
          `PRAGMA table_info("${collection}")`,
        );
        return rows.map(r => ({
          name: r.name,
          type: r.type,
          required: r.notnull === 1,
        }));
      }

      // MySQL, MSSQL
      const rows = await sql.queryMany<{ COLUMN_NAME: string; DATA_TYPE: string; IS_NULLABLE: string }>(
        `SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE FROM information_schema.columns WHERE table_name = $1`,
        [collection],
      );
      return rows.map(r => ({
        name: r.COLUMN_NAME,
        type: r.DATA_TYPE,
        required: r.IS_NULLABLE === 'NO',
      }));
    } catch (err) {
      throw mapNativeError('sql', err, collection, 'describe');
    }
  }

  async getDocumentCount(collection: string): Promise<number> {
    return this.count(collection);
  }

  raw(): unknown {
    return sql;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function detectDialect(uri: string): SqlDialect {
  if (uri.startsWith('postgresql://') || uri.startsWith('postgres://')) return 'pg';
  if (uri.startsWith('mysql://')) return 'mysql2';
  if (uri.startsWith('mssql://')) return 'mssql';
  if (uri.startsWith('file:') || uri.startsWith('sqlite:')) return 'sqlite';
  return 'pg'; // default
}

function dialectToDriver(dialect: SqlDialect): Driver {
  switch (dialect) {
    case 'pg': return 'pg';
    case 'mysql2': return 'mysql2';
    case 'mssql': return 'mssql';
    case 'sqlite': return 'sqlite';
  }
}

function extractDbName(uri: string): string {
  try {
    const url = new URL(uri);
    return url.pathname.replace(/^\//, '') || 'default';
  } catch {
    return 'default';
  }
}

function redactUri(uri: string): string {
  try {
    const url = new URL(uri);
    if (url.password) url.password = '***';
    return url.toString();
  } catch {
    return uri.replace(/\/\/[^:]+:[^@]+@/, '//***:***@');
  }
}
