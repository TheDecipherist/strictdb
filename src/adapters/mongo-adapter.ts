/**
 * StrictDB MongoDB Adapter
 *
 * Wraps core/db/mongo.ts — the existing production-tested MongoDB wrapper.
 * Filter syntax IS MongoDB's native syntax — no translation needed.
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
  StrictDBConfig,
  StrictFilter,
  UpdateOperators,
} from '../types.js';
import { mapNativeError } from '../errors.js';
import { createReceipt } from '../receipts.js';
import type { StrictDBEventEmitter } from '../events.js';
import { ReconnectManager } from '../reconnect.js';
import * as mongo from '../core/db/mongo.js';
import type { ClientSession, Db } from 'mongodb';

export class MongoAdapter implements DatabaseAdapter {
  readonly backend: Backend = 'mongo';
  readonly driver: Driver = 'mongodb';

  private config: StrictDBConfig;
  private emitter: StrictDBEventEmitter;
  private reconnectManager: ReconnectManager;
  private connectedAt: Date | null = null;

  constructor(config: StrictDBConfig, emitter: StrictDBEventEmitter) {
    this.config = config;
    this.emitter = emitter;
    this.reconnectManager = new ReconnectManager(config.reconnect, emitter, 'mongo');
  }

  async connect(): Promise<void> {
    try {
      await mongo.connect(this.config.uri, {
        pool: this.config.pool,
        dbName: this.config.dbName,
        label: this.config.label,
      });
      this.connectedAt = new Date();
      this.emitter.emit('connected', {
        backend: 'mongo',
        dbName: this.config.dbName ?? 'app',
        label: this.config.label ?? 'default',
      });
    } catch (err) {
      throw mapNativeError('mongo', err);
    }
  }

  async close(): Promise<void> {
    this.reconnectManager.stop();
    await mongo.closePool();
    this.connectedAt = null;
  }

  status(): ConnectionStatus {
    return {
      state: this.connectedAt ? 'connected' : 'disconnected',
      backend: 'mongo',
      driver: 'mongodb',
      uri: redactUri(this.config.uri),
      dbName: this.config.dbName ?? 'app',
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
      // MongoDB adapter: filter is native MongoDB syntax
      // Options: sort is handled via aggregation pipeline
      if (options?.sort || options?.projection) {
        const pipeline: Record<string, unknown>[] = [
          { $match: filter as Record<string, unknown> },
        ];
        if (options.sort) pipeline.push({ $sort: options.sort });
        if (options.projection) pipeline.push({ $project: options.projection });
        pipeline.push({ $limit: 1 });
        const results = await mongo.queryMany<Record<string, unknown>>(collection, pipeline, { trusted: true });
        return (results[0] as T) ?? null;
      }
      return await mongo.queryOne<Record<string, unknown>>(collection, filter as Record<string, unknown>) as T | null;
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

      return await mongo.queryMany<Record<string, unknown>>(collection, pipeline, { trusted: true }) as T[];
    } catch (err) {
      throw mapNativeError('mongo', err, collection, 'queryMany');
    }
  }

  async queryWithLookup<T>(collection: string, options: LookupOptions<T>): Promise<T | null> {
    try {
      return await mongo.queryWithLookup<Record<string, unknown>>(collection, {
        match: options.match as Record<string, unknown>,
        lookup: options.lookup,
        unwind: options.unwind,
      }) as T | null;
    } catch (err) {
      throw mapNativeError('mongo', err, collection, 'queryWithLookup');
    }
  }

  async count<T>(collection: string, filter?: StrictFilter<T>): Promise<number> {
    try {
      return await mongo.count(collection, (filter ?? {}) as Record<string, unknown>);
    } catch (err) {
      throw mapNativeError('mongo', err, collection, 'count');
    }
  }

  async insertOne<T>(collection: string, doc: T): Promise<OperationReceipt> {
    const startTime = Date.now();
    try {
      await mongo.insertOne(collection, doc as Record<string, unknown>);
      return createReceipt({
        operation: 'insertOne',
        collection,
        backend: 'mongo',
        startTime,
        insertedCount: 1,
      });
    } catch (err) {
      throw mapNativeError('mongo', err, collection, 'insertOne');
    }
  }

  async insertMany<T>(collection: string, docs: T[]): Promise<OperationReceipt> {
    const startTime = Date.now();
    try {
      await mongo.insertMany(collection, docs as Record<string, unknown>[]);
      return createReceipt({
        operation: 'insertMany',
        collection,
        backend: 'mongo',
        startTime,
        insertedCount: docs.length,
      });
    } catch (err) {
      throw mapNativeError('mongo', err, collection, 'insertMany');
    }
  }

  async updateOne<T>(collection: string, filter: StrictFilter<T>, update: UpdateOperators<T>, upsert?: boolean): Promise<OperationReceipt> {
    const startTime = Date.now();
    try {
      await mongo.updateOne(
        collection,
        filter as Record<string, unknown>,
        update as Record<string, unknown>,
        upsert,
      );
      return createReceipt({
        operation: 'updateOne',
        collection,
        backend: 'mongo',
        startTime,
        matchedCount: 1,
        modifiedCount: 1,
      });
    } catch (err) {
      throw mapNativeError('mongo', err, collection, 'updateOne');
    }
  }

  async updateMany<T>(collection: string, filter: StrictFilter<T>, update: UpdateOperators<T>): Promise<OperationReceipt> {
    const startTime = Date.now();
    try {
      await mongo.updateMany(
        collection,
        filter as Record<string, unknown>,
        update as Record<string, unknown>,
      );
      return createReceipt({
        operation: 'updateMany',
        collection,
        backend: 'mongo',
        startTime,
        matchedCount: 1,
        modifiedCount: 1,
      });
    } catch (err) {
      throw mapNativeError('mongo', err, collection, 'updateMany');
    }
  }

  async deleteOne<T>(collection: string, filter: StrictFilter<T>, _options?: ConfirmOptions): Promise<OperationReceipt> {
    const startTime = Date.now();
    try {
      await mongo.deleteOne(collection, filter as Record<string, unknown>);
      return createReceipt({
        operation: 'deleteOne',
        collection,
        backend: 'mongo',
        startTime,
        deletedCount: 1,
      });
    } catch (err) {
      throw mapNativeError('mongo', err, collection, 'deleteOne');
    }
  }

  async deleteMany<T>(collection: string, filter: StrictFilter<T>, _options?: ConfirmOptions): Promise<OperationReceipt> {
    const startTime = Date.now();
    try {
      await mongo.deleteMany(collection, filter as Record<string, unknown>);
      return createReceipt({
        operation: 'deleteMany',
        collection,
        backend: 'mongo',
        startTime,
        deletedCount: 1,
      });
    } catch (err) {
      throw mapNativeError('mongo', err, collection, 'deleteMany');
    }
  }

  async withTransaction<T>(fn: (txAdapter: DatabaseAdapter) => Promise<T>): Promise<T> {
    return mongo.withTransaction(async (session) => {
      const db = await mongo.getDb();
      const txAdapter = new MongoTransactionAdapter(db, session);
      return fn(txAdapter);
    });
  }

  async ensureIndexes(indexes: Array<{ collection: string; fields: Record<string, 1 | -1>; unique?: boolean; sparse?: boolean; expireAfterSeconds?: number }>): Promise<void> {
    for (const idx of indexes) {
      mongo.registerIndex(idx);
    }
    await mongo.ensureIndexes();
  }

  raw(): unknown {
    return mongo;
  }
}

// ─── Transaction-Scoped Adapter ───────────────────────────────────────────

class MongoTransactionAdapter implements DatabaseAdapter {
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
      await this.db.collection(collection).insertOne(
        doc as Record<string, unknown>,
        { session: this.session },
      );
      return createReceipt({ operation: 'insertOne', collection, backend: 'mongo', startTime, insertedCount: 1 });
    } catch (err) {
      throw mapNativeError('mongo', err, collection, 'insertOne');
    }
  }

  async insertMany<T>(collection: string, docs: T[]): Promise<OperationReceipt> {
    const startTime = Date.now();
    try {
      await this.db.collection(collection).insertMany(
        docs as Record<string, unknown>[],
        { session: this.session },
      );
      return createReceipt({ operation: 'insertMany', collection, backend: 'mongo', startTime, insertedCount: docs.length });
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

function redactUri(uri: string): string {
  try {
    const url = new URL(uri);
    if (url.password) url.password = '***';
    return url.toString();
  } catch {
    return uri.replace(/\/\/[^:]+:[^@]+@/, '//***:***@');
  }
}
