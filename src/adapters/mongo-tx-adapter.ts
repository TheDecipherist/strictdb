/**
 * StrictDB MongoDB Transaction Adapter
 *
 * Transaction-scoped adapter extracted from mongo-adapter.ts.
 * Implements DatabaseAdapter for operations within a MongoDB session.
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
  StrictFilter,
  UpdateOperators,
} from '../types.js';
import { mapNativeError } from '../errors.js';
import { createReceipt } from '../receipts.js';
import type { ClientSession, Db } from 'mongodb';

export class MongoTransactionAdapter implements DatabaseAdapter {
  readonly backend: Backend = 'mongo';
  readonly driver: Driver = 'mongodb';

  constructor(private db: Db, private session: ClientSession) {}

  async connect(): Promise<void> { /* transaction-scoped — no-op */ }
  async close(): Promise<void> { /* transaction-scoped — no-op */ }

  status(): ConnectionStatus {
    return {
      state: 'connected',
      backend: 'mongo',
      driver: 'mongodb',
      uri: 'transaction',
      dbName: this.db.databaseName,
      uptimeMs: 0,
      pool: { active: 0, idle: 0, waiting: 0, max: 0 },
      reconnect: { enabled: false, attempts: 0, lastDisconnect: undefined },
    };
  }

  async queryOne<T>(collection: string, filter: StrictFilter<T>, options?: QueryOptions<T>): Promise<T | null> {
    try {
      const pipeline: Record<string, unknown>[] = [
        { $match: filter as Record<string, unknown> },
      ];
      if (options?.sort) pipeline.push({ $sort: options.sort });
      if (options?.projection) pipeline.push({ $project: options.projection });
      pipeline.push({ $limit: 1 });
      const results = await this.db.collection(collection)
        .aggregate(pipeline, { session: this.session }).toArray();
      return (results[0] as T) ?? null;
    } catch (err) {
      throw mapNativeError('mongo', err, collection, 'queryOne');
    }
  }

  async queryMany<T>(collection: string, filter: StrictFilter<T>, options?: QueryOptions<T>): Promise<T[]> {
    try {
      const pipeline: Record<string, unknown>[] = [
        { $match: filter as Record<string, unknown> },
      ];
      if (options?.sort) pipeline.push({ $sort: options.sort });
      if (options?.skip) pipeline.push({ $skip: options.skip });
      if (options?.limit) pipeline.push({ $limit: options.limit });
      if (options?.projection) pipeline.push({ $project: options.projection });
      return await this.db.collection(collection)
        .aggregate(pipeline, { session: this.session }).toArray() as T[];
    } catch (err) {
      throw mapNativeError('mongo', err, collection, 'queryMany');
    }
  }

  async queryWithLookup<T>(collection: string, options: LookupOptions<T>): Promise<T | null> {
    try {
      const pipeline: Record<string, unknown>[] = [
        { $match: options.match as Record<string, unknown> },
        { $limit: 1 },
        { $lookup: options.lookup },
      ];
      if (options.unwind) {
        pipeline.push({ $unwind: { path: `$${options.unwind}`, preserveNullAndEmptyArrays: true } });
      }
      const results = await this.db.collection(collection)
        .aggregate(pipeline, { session: this.session }).toArray();
      return (results[0] as T) ?? null;
    } catch (err) {
      throw mapNativeError('mongo', err, collection, 'queryWithLookup');
    }
  }

  async count<T>(collection: string, filter?: StrictFilter<T>): Promise<number> {
    try {
      const result = await this.db.collection(collection)
        .aggregate<{ count: number }>(
          [{ $match: (filter ?? {}) as Record<string, unknown> }, { $count: 'count' }],
          { session: this.session },
        ).toArray();
      return result[0]?.count ?? 0;
    } catch (err) {
      throw mapNativeError('mongo', err, collection, 'count');
    }
  }

  async insertOne<T>(collection: string, doc: T): Promise<OperationReceipt> {
    const startTime = Date.now();
    try {
      const result = await this.db.collection(collection).insertOne(
        doc as Record<string, unknown>,
        { session: this.session },
      );
      return createReceipt({
        operation: 'insertOne', collection, backend: 'mongo', startTime, insertedCount: 1,
        insertedId: result.insertedId ? String(result.insertedId) : undefined,
      });
    } catch (err) {
      throw mapNativeError('mongo', err, collection, 'insertOne');
    }
  }

  async insertMany<T>(collection: string, docs: T[]): Promise<OperationReceipt> {
    const startTime = Date.now();
    try {
      const result = await this.db.collection(collection).insertMany(
        docs as Record<string, unknown>[],
        { session: this.session },
      );
      const ids = result.insertedIds
        ? Object.values(result.insertedIds).map(id => String(id))
        : [];
      return createReceipt({
        operation: 'insertMany', collection, backend: 'mongo', startTime, insertedCount: docs.length,
        insertedIds: ids,
      });
    } catch (err) {
      throw mapNativeError('mongo', err, collection, 'insertMany');
    }
  }

  async updateOne<T>(collection: string, filter: StrictFilter<T>, update: UpdateOperators<T>, upsert?: boolean): Promise<OperationReceipt> {
    const startTime = Date.now();
    try {
      const result = await this.db.collection(collection).updateOne(
        filter as Record<string, unknown>,
        update as Record<string, unknown>,
        { session: this.session, upsert },
      );
      return createReceipt({
        operation: 'updateOne', collection, backend: 'mongo', startTime,
        matchedCount: result.matchedCount, modifiedCount: result.modifiedCount,
        upsertedId: result.upsertedId ? String(result.upsertedId) : undefined,
      });
    } catch (err) {
      throw mapNativeError('mongo', err, collection, 'updateOne');
    }
  }

  async updateMany<T>(collection: string, filter: StrictFilter<T>, update: UpdateOperators<T>): Promise<OperationReceipt> {
    const startTime = Date.now();
    try {
      const result = await this.db.collection(collection).updateMany(
        filter as Record<string, unknown>,
        update as Record<string, unknown>,
        { session: this.session },
      );
      return createReceipt({
        operation: 'updateMany', collection, backend: 'mongo', startTime,
        matchedCount: result.matchedCount, modifiedCount: result.modifiedCount,
      });
    } catch (err) {
      throw mapNativeError('mongo', err, collection, 'updateMany');
    }
  }

  async deleteOne<T>(collection: string, filter: StrictFilter<T>, _options?: ConfirmOptions): Promise<OperationReceipt> {
    const startTime = Date.now();
    try {
      const result = await this.db.collection(collection).deleteOne(
        filter as Record<string, unknown>,
        { session: this.session },
      );
      return createReceipt({ operation: 'deleteOne', collection, backend: 'mongo', startTime, deletedCount: result.deletedCount });
    } catch (err) {
      throw mapNativeError('mongo', err, collection, 'deleteOne');
    }
  }

  async deleteMany<T>(collection: string, filter: StrictFilter<T>, _options?: ConfirmOptions): Promise<OperationReceipt> {
    const startTime = Date.now();
    try {
      const result = await this.db.collection(collection).deleteMany(
        filter as Record<string, unknown>,
        { session: this.session },
      );
      return createReceipt({ operation: 'deleteMany', collection, backend: 'mongo', startTime, deletedCount: result.deletedCount });
    } catch (err) {
      throw mapNativeError('mongo', err, collection, 'deleteMany');
    }
  }

  raw(): unknown { return this.db; }
}
