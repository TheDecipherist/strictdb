/**
 * StrictDB SQL Transaction Adapter
 *
 * Transaction-scoped adapter extracted from sql-adapter.ts.
 * Implements DatabaseAdapter for operations within a SQL transaction client.
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
  StrictFilter,
  UpdateOperators,
} from '../types.js';
import { mapNativeError, StrictDBError } from '../errors.js';
import { createReceipt } from '../receipts.js';
import {
  buildSelectSQL,
  buildInsertSQL,
  buildBatchInsertSQL,
  buildUpdateSQL,
  buildDeleteSQL,
  buildCountSQL,
  translateToSQL,
  translatePipelineToSQL,
} from '../filter-translator.js';
import type { ExecFn, TxClient } from './sql-helpers.js';
import {
  limitUpdateOne,
  limitDeleteOne,
  performUpsert,
  stripExcludedFields,
  performLookup,
} from './sql-helpers.js';

export class SqlTransactionAdapter implements DatabaseAdapter {
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
      let insertedId: string | undefined;

      if (this.dialect === 'pg') {
        const result = await this.client.query(`${query.sql} RETURNING id`, query.values);
        insertedId = (result.rows?.[0] as Record<string, unknown>)?.['id']?.toString();
      } else if (this.dialect === 'mysql2') {
        await this.client.query(query.sql, query.values);
        const idResult = await this.client.query('SELECT LAST_INSERT_ID() AS id', []);
        insertedId = (idResult.rows?.[0] as Record<string, unknown>)?.['id']?.toString();
      } else if (this.dialect === 'sqlite') {
        await this.client.query(query.sql, query.values);
        const idResult = await this.client.query('SELECT last_insert_rowid() AS id', []);
        insertedId = (idResult.rows?.[0] as Record<string, unknown>)?.['id']?.toString();
      } else if (this.dialect === 'mssql') {
        const result = await this.client.query(`${query.sql}; SELECT SCOPE_IDENTITY() AS id`, query.values);
        insertedId = (result.rows?.[0] as Record<string, unknown>)?.['id']?.toString();
      }

      return createReceipt({ operation: 'insertOne', collection, backend: 'sql', startTime, insertedCount: 1, insertedId });
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
        const result = await this.client.query(`${query.sql} RETURNING id`, query.values);
        const ids = (result.rows ?? [])
          .map(r => (r as Record<string, unknown>)['id']?.toString())
          .filter((id): id is string => id !== undefined);
        if (ids.length > 0) insertedIds = ids;
      } else if (query.sql) {
        // mysql2, sqlite, mssql: bulk ID retrieval not supported — insertedIds left undefined
        await this.client.query(query.sql, query.values);
      }

      return createReceipt({ operation: 'insertMany', collection, backend: 'sql', startTime, insertedCount: docs.length, insertedIds });
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

  async aggregate<T>(collection: string, pipeline: Record<string, unknown>[]): Promise<T[]> {
    try {
      const { sql: sqlStr, values } = translatePipelineToSQL(collection, pipeline, this.dialect);
      const result = await this.client.query(sqlStr, values);
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
    const execFn: ExecFn = (s, p) => this.client.query(s, p);
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
          const result = await this.client.query(`${query.sql} RETURNING id`, query.values);
          id = (result.rows?.[0] as Record<string, unknown>)?.['id']?.toString();
        } else if (this.dialect === 'mysql2') {
          await this.client.query(query.sql, query.values);
          const idResult = await this.client.query('SELECT LAST_INSERT_ID() AS id', []);
          id = (idResult.rows?.[0] as Record<string, unknown>)?.['id']?.toString();
        } else if (this.dialect === 'sqlite') {
          await this.client.query(query.sql, query.values);
          const idResult = await this.client.query('SELECT last_insert_rowid() AS id', []);
          id = (idResult.rows?.[0] as Record<string, unknown>)?.['id']?.toString();
        } else if (this.dialect === 'mssql') {
          const result = await this.client.query(`${query.sql}; SELECT SCOPE_IDENTITY() AS id`, query.values);
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
          const result = await this.client.query(limitedSql, query.values);
          modifiedCount += result.rowCount;
        }

      } else if ('updateMany' in op) {
        const { filter, update } = op.updateMany;
        const query = buildUpdateSQL(collection, filter, update as UpdateOperators<Record<string, unknown>>, this.dialect);
        const result = await this.client.query(query.sql, query.values);
        modifiedCount += result.rowCount;

      } else if ('deleteOne' in op) {
        const { filter } = op.deleteOne;
        const query = buildDeleteSQL(collection, filter, this.dialect);
        const where = translateToSQL(filter, this.dialect);
        const limitedSql = limitDeleteOne(query.sql, collection, where.clause, this.dialect);
        const result = await this.client.query(limitedSql, query.values);
        deletedCount += result.rowCount;

      } else if ('deleteMany' in op) {
        const { filter } = op.deleteMany;
        const query = buildDeleteSQL(collection, filter, this.dialect);
        const result = await this.client.query(query.sql, query.values);
        deletedCount += result.rowCount;

      } else if ('replaceOne' in op) {
        const { filter, replacement } = op.replaceOne;
        const delQuery = buildDeleteSQL(collection, filter, this.dialect);
        const where = translateToSQL(filter, this.dialect);
        const limitedDelSql = limitDeleteOne(delQuery.sql, collection, where.clause, this.dialect);
        const delResult = await this.client.query(limitedDelSql, delQuery.values);
        if (delResult.rowCount > 0) {
          const insQuery = buildInsertSQL(collection, replacement, this.dialect);
          await this.client.query(insQuery.sql, insQuery.values);
          modifiedCount++;
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
  }

  raw(): unknown { return this.client; }
}
