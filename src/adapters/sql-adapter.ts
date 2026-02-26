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
  OperationReceipt,
  QueryOptions,
  SqlDialect,
  StrictDBConfig,
  StrictFilter,
  UpdateOperators,
} from '../types.js';
import { mapNativeError } from '../errors.js';
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
  getExcludedFields,
  quoteIdentifier,
} from '../filter-translator.js';

// ─── Shared Helpers (used by both SqlAdapter and SqlTransactionAdapter) ──────

type ExecFn = (sqlStr: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number }>;

/** Limit an UPDATE to a single row, dialect-aware. */
function limitUpdateOne(
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
function limitDeleteOne(
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
async function performUpsert(
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
function stripExcludedFields<T>(rows: T[], projection?: Record<string, 0 | 1>): T[] {
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
async function performLookup<T>(
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
      await sql.execute(query.sql, query.values);
      return createReceipt({
        operation: 'insertOne',
        collection,
        backend: 'sql',
        startTime,
        insertedCount: 1,
      });
    } catch (err) {
      throw mapNativeError('sql', err, collection, 'insertOne');
    }
  }

  async insertMany<T>(collection: string, docs: T[]): Promise<OperationReceipt> {
    const startTime = Date.now();
    try {
      const query = buildBatchInsertSQL(collection, docs as Record<string, unknown>[], this.dialect);
      if (query.sql) {
        await sql.execute(query.sql, query.values);
      }
      return createReceipt({
        operation: 'insertMany',
        collection,
        backend: 'sql',
        startTime,
        insertedCount: docs.length,
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

// ─── Transaction-Scoped Adapter ───────────────────────────────────────────

interface TxClient {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[]; rowCount: number }>;
}

class SqlTransactionAdapter implements DatabaseAdapter {
  readonly backend: Backend = 'sql';
  readonly driver: Driver;

  private client: TxClient;
  private dialect: SqlDialect;

  constructor(client: TxClient, dialect: SqlDialect, driver: Driver) {
    this.client = client;
    this.dialect = dialect;
    this.driver = driver;
  }

  async connect(): Promise<void> { /* transaction-scoped — no-op */ }
  async close(): Promise<void> { /* transaction-scoped — no-op */ }

  status(): ConnectionStatus {
    return {
      state: 'connected',
      backend: 'sql',
      driver: this.driver,
      uri: 'transaction',
      dbName: 'transaction',
      uptimeMs: 0,
      pool: { active: 0, idle: 0, waiting: 0, max: 0 },
      reconnect: { enabled: false, attempts: 0, lastDisconnect: undefined },
    };
  }

  async queryOne<T>(collection: string, filter: StrictFilter<T>, options?: QueryOptions<T>): Promise<T | null> {
    try {
      const query = buildSelectSQL(collection, filter as Record<string, unknown>, {
        sort: options?.sort as Record<string, unknown> | undefined,
        limit: 1,
        skip: options?.skip,
        projection: options?.projection as Record<string, 0 | 1> | undefined,
        dialect: this.dialect,
      });
      const result = await this.client.query(query.sql, query.values);
      const row = (result.rows[0] as T) ?? null;
      if (!row) return null;
      const stripped = stripExcludedFields([row], options?.projection as Record<string, 0 | 1> | undefined);
      return stripped[0] ?? null;
    } catch (err) {
      throw mapNativeError('sql', err, collection, 'queryOne');
    }
  }

  async queryMany<T>(collection: string, filter: StrictFilter<T>, options?: QueryOptions<T>): Promise<T[]> {
    try {
      const query = buildSelectSQL(collection, filter as Record<string, unknown>, {
        sort: options?.sort as Record<string, unknown> | undefined,
        limit: options?.limit,
        skip: options?.skip,
        projection: options?.projection as Record<string, 0 | 1> | undefined,
        dialect: this.dialect,
      });
      const result = await this.client.query(query.sql, query.values);
      return stripExcludedFields(result.rows as T[], options?.projection as Record<string, 0 | 1> | undefined);
    } catch (err) {
      throw mapNativeError('sql', err, collection, 'queryMany');
    }
  }

  async queryWithLookup<T>(collection: string, options: LookupOptions<T>): Promise<T | null> {
    try {
      const execFn: ExecFn = (s, p) => this.client.query(s, p);
      return await performLookup(execFn, collection, options, this.dialect);
    } catch (err) {
      throw mapNativeError('sql', err, collection, 'queryWithLookup');
    }
  }

  async count<T>(collection: string, filter?: StrictFilter<T>): Promise<number> {
    try {
      const query = buildCountSQL(collection, (filter ?? {}) as Record<string, unknown>, this.dialect);
      const result = await this.client.query(query.sql, query.values);
      return Number((result.rows[0] as { count: string | number })?.count ?? 0);
    } catch (err) {
      throw mapNativeError('sql', err, collection, 'count');
    }
  }

  async insertOne<T>(collection: string, doc: T): Promise<OperationReceipt> {
    const startTime = Date.now();
    try {
      const query = buildInsertSQL(collection, doc as Record<string, unknown>, this.dialect);
      await this.client.query(query.sql, query.values);
      return createReceipt({ operation: 'insertOne', collection, backend: 'sql', startTime, insertedCount: 1 });
    } catch (err) {
      throw mapNativeError('sql', err, collection, 'insertOne');
    }
  }

  async insertMany<T>(collection: string, docs: T[]): Promise<OperationReceipt> {
    const startTime = Date.now();
    try {
      const query = buildBatchInsertSQL(collection, docs as Record<string, unknown>[], this.dialect);
      if (query.sql) {
        await this.client.query(query.sql, query.values);
      }
      return createReceipt({ operation: 'insertMany', collection, backend: 'sql', startTime, insertedCount: docs.length });
    } catch (err) {
      throw mapNativeError('sql', err, collection, 'insertMany');
    }
  }

  async updateOne<T>(collection: string, filter: StrictFilter<T>, update: UpdateOperators<T>, upsert?: boolean): Promise<OperationReceipt> {
    const startTime = Date.now();
    try {
      const execFn: ExecFn = (s, p) => this.client.query(s, p);
      const filterRec = filter as Record<string, unknown>;
      const updateRec = update as UpdateOperators<Record<string, unknown>>;

      if (upsert) {
        const { rowCount, inserted } = await performUpsert(execFn, collection, filterRec, updateRec, this.dialect);
        return createReceipt({
          operation: 'updateOne', collection, backend: 'sql', startTime,
          matchedCount: inserted ? 0 : rowCount,
          modifiedCount: inserted ? 0 : rowCount,
          insertedCount: inserted ? 1 : 0,
        });
      }

      const query = buildUpdateSQL(collection, filterRec, updateRec, this.dialect);
      const where = translateToSQL(filterRec, this.dialect);
      const limitedSql = limitUpdateOne(query.sql, collection, where.clause, this.dialect);
      const result = await this.client.query(limitedSql, query.values);
      return createReceipt({
        operation: 'updateOne', collection, backend: 'sql', startTime,
        matchedCount: result.rowCount, modifiedCount: result.rowCount,
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
      const result = await this.client.query(query.sql, query.values);
      return createReceipt({
        operation: 'updateMany', collection, backend: 'sql', startTime,
        matchedCount: result.rowCount, modifiedCount: result.rowCount,
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
      const result = await this.client.query(limitedSql, query.values);
      return createReceipt({ operation: 'deleteOne', collection, backend: 'sql', startTime, deletedCount: result.rowCount });
    } catch (err) {
      throw mapNativeError('sql', err, collection, 'deleteOne');
    }
  }

  async deleteMany<T>(collection: string, filter: StrictFilter<T>, _options?: ConfirmOptions): Promise<OperationReceipt> {
    const startTime = Date.now();
    try {
      const query = buildDeleteSQL(collection, filter as Record<string, unknown>, this.dialect);
      const result = await this.client.query(query.sql, query.values);
      return createReceipt({ operation: 'deleteMany', collection, backend: 'sql', startTime, deletedCount: result.rowCount });
    } catch (err) {
      throw mapNativeError('sql', err, collection, 'deleteMany');
    }
  }

  raw(): unknown { return this.client; }
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
