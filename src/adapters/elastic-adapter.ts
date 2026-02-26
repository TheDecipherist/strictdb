/**
 * StrictDB Elasticsearch Adapter
 *
 * Uses filter-translator.ts for filter → ES Query DSL.
 * Uses @elastic/elasticsearch client for all operations.
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
import { mapNativeError, StrictDBError } from '../errors.js';
import { createReceipt } from '../receipts.js';
import type { StrictDBEventEmitter } from '../events.js';
import { ReconnectManager } from '../reconnect.js';
import {
  translateToElastic,
  translateSortToElastic,
  translateUpdateToElastic,
} from '../filter-translator.js';
import { validateIndexName } from '../sanitize.js';

// Lazy-loaded Elasticsearch client
type ElasticClient = {
  search(params: Record<string, unknown>): Promise<Record<string, unknown>>;
  index(params: Record<string, unknown>): Promise<Record<string, unknown>>;
  bulk(params: Record<string, unknown>): Promise<Record<string, unknown>>;
  count(params: Record<string, unknown>): Promise<Record<string, unknown>>;
  updateByQuery(params: Record<string, unknown>): Promise<Record<string, unknown>>;
  deleteByQuery(params: Record<string, unknown>): Promise<Record<string, unknown>>;
  indices: {
    create(params: Record<string, unknown>): Promise<Record<string, unknown>>;
    exists(params: Record<string, unknown>): Promise<boolean>;
    getMapping(params: Record<string, unknown>): Promise<Record<string, unknown>>;
  };
  ping(): Promise<boolean>;
  close(): Promise<void>;
};

export class ElasticAdapter implements DatabaseAdapter {
  readonly backend: Backend = 'elastic';
  readonly driver: Driver = 'elasticsearch';

  private config: StrictDBConfig;
  private emitter: StrictDBEventEmitter;
  private reconnectManager: ReconnectManager;
  private client: ElasticClient | null = null;
  private connectedAt: Date | null = null;

  constructor(config: StrictDBConfig, emitter: StrictDBEventEmitter) {
    this.config = config;
    this.emitter = emitter;
    this.reconnectManager = new ReconnectManager(config.reconnect, emitter, 'elastic');
  }

  async connect(): Promise<void> {
    try {
      const { Client } = await import('@elastic/elasticsearch');
      const clientOpts: Record<string, unknown> = {
        node: this.config.uri,
      };

      if (this.config.elastic?.apiKey) {
        clientOpts['auth'] = { apiKey: this.config.elastic.apiKey };
      }
      if (this.config.elastic?.caFingerprint) {
        clientOpts['caFingerprint'] = this.config.elastic.caFingerprint;
      }
      if (this.config.elastic?.sniffOnStart) {
        clientOpts['sniffOnStart'] = true;
      }

      this.client = new Client(clientOpts) as unknown as ElasticClient;
      await this.client.ping();
      this.connectedAt = new Date();

      this.emitter.emit('connected', {
        backend: 'elastic',
        dbName: this.config.dbName ?? 'elasticsearch',
        label: this.config.label ?? 'ES',
      });
    } catch (err) {
      throw mapNativeError('elastic', err);
    }
  }

  async close(): Promise<void> {
    this.reconnectManager.stop();
    if (this.client) {
      await this.client.close();
      this.client = null;
    }
    this.connectedAt = null;
  }

  status(): ConnectionStatus {
    return {
      state: this.connectedAt ? 'connected' : 'disconnected',
      backend: 'elastic',
      driver: 'elasticsearch',
      uri: this.config.uri,
      dbName: this.config.dbName ?? 'elasticsearch',
      uptimeMs: this.connectedAt ? Date.now() - this.connectedAt.getTime() : 0,
      pool: { active: 0, idle: 0, waiting: 0, max: 10 },
      reconnect: {
        enabled: this.reconnectManager.enabled,
        attempts: this.reconnectManager.attemptCount,
        lastDisconnect: this.reconnectManager.lastDisconnect,
      },
    };
  }

  private getClient(): ElasticClient {
    if (!this.client) {
      throw new StrictDBError({
        code: 'CONNECTION_FAILED',
        message: 'Elasticsearch client not connected.',
        fix: 'Call connect() before performing operations.',
        backend: 'elastic',
      });
    }
    return this.client;
  }

  async queryOne<T>(collection: string, filter: StrictFilter<T>, options?: QueryOptions<T>): Promise<T | null> {
    validateIndexName(collection);
    try {
      const client = this.getClient();
      const query = translateToElastic(filter as Record<string, unknown>);

      const params: Record<string, unknown> = {
        index: collection,
        size: 1,
        body: { query },
      };

      if (options?.sort) {
        (params['body'] as Record<string, unknown>)['sort'] = translateSortToElastic(options.sort as Record<string, unknown>);
      }
      if (options?.projection) {
        params['_source'] = Object.entries(options.projection)
          .filter(([, v]) => v === 1)
          .map(([k]) => k);
      }

      const result = await client.search(params);
      const hits = (result['hits'] as Record<string, unknown>)?.['hits'] as Array<Record<string, unknown>> | undefined;
      if (!hits || hits.length === 0) return null;
      return hits[0]!['_source'] as T;
    } catch (err) {
      throw mapNativeError('elastic', err, collection, 'queryOne');
    }
  }

  async queryMany<T>(collection: string, filter: StrictFilter<T>, options?: QueryOptions<T>): Promise<T[]> {
    validateIndexName(collection);
    try {
      const client = this.getClient();
      const query = translateToElastic(filter as Record<string, unknown>);

      const body: Record<string, unknown> = { query };
      if (options?.sort) {
        body['sort'] = translateSortToElastic(options.sort as Record<string, unknown>);
      }

      const params: Record<string, unknown> = {
        index: collection,
        body,
        size: options?.limit ?? 100,
      };

      if (options?.skip) {
        params['from'] = options.skip;
      }
      if (options?.projection) {
        params['_source'] = Object.entries(options.projection)
          .filter(([, v]) => v === 1)
          .map(([k]) => k);
      }

      const result = await client.search(params);
      const hits = (result['hits'] as Record<string, unknown>)?.['hits'] as Array<Record<string, unknown>> | undefined;
      if (!hits) return [];
      return hits.map(h => h['_source'] as T);
    } catch (err) {
      throw mapNativeError('elastic', err, collection, 'queryMany');
    }
  }

  async queryWithLookup<T>(collection: string, options: LookupOptions<T>): Promise<T | null> {
    // ES has no server-side joins — do two queries
    const doc = await this.queryOne<Record<string, unknown>>(collection, options.match as StrictFilter<Record<string, unknown>>);
    if (!doc) return null;

    const localValue = doc[options.lookup.localField];
    if (localValue === undefined || localValue === null) return doc as T;

    const related = await this.queryMany<Record<string, unknown>>(
      options.lookup.from,
      { [options.lookup.foreignField]: localValue } as StrictFilter<Record<string, unknown>>,
      { limit: options.limit ?? 100 },
    );

    const result = { ...doc, [options.lookup.as]: related };
    if (options.unwind && related.length > 0) {
      return { ...doc, [options.lookup.as]: related[0] } as T;
    }
    return result as T;
  }

  async count<T>(collection: string, filter?: StrictFilter<T>): Promise<number> {
    validateIndexName(collection);
    try {
      const client = this.getClient();
      const query = filter ? translateToElastic(filter as Record<string, unknown>) : { match_all: {} };

      const result = await client.count({
        index: collection,
        body: { query },
      });
      return (result['count'] as number) ?? 0;
    } catch (err) {
      throw mapNativeError('elastic', err, collection, 'count');
    }
  }

  async insertOne<T>(collection: string, doc: T): Promise<OperationReceipt> {
    validateIndexName(collection);
    const startTime = Date.now();
    try {
      const client = this.getClient();
      await client.index({
        index: collection,
        body: doc,
        refresh: 'wait_for',
      });
      return createReceipt({
        operation: 'insertOne',
        collection,
        backend: 'elastic',
        startTime,
        insertedCount: 1,
      });
    } catch (err) {
      throw mapNativeError('elastic', err, collection, 'insertOne');
    }
  }

  async insertMany<T>(collection: string, docs: T[]): Promise<OperationReceipt> {
    validateIndexName(collection);
    const startTime = Date.now();
    try {
      const client = this.getClient();
      const operations: Record<string, unknown>[] = [];
      for (const doc of docs) {
        operations.push({ index: { _index: collection } });
        operations.push(doc as Record<string, unknown>);
      }

      await client.bulk({
        body: operations,
        refresh: 'wait_for',
      });

      return createReceipt({
        operation: 'insertMany',
        collection,
        backend: 'elastic',
        startTime,
        insertedCount: docs.length,
      });
    } catch (err) {
      throw mapNativeError('elastic', err, collection, 'insertMany');
    }
  }

  async updateOne<T>(collection: string, filter: StrictFilter<T>, update: UpdateOperators<T>, _upsert?: boolean): Promise<OperationReceipt> {
    validateIndexName(collection);
    const startTime = Date.now();
    try {
      const client = this.getClient();
      const query = translateToElastic(filter as Record<string, unknown>);
      const script = translateUpdateToElastic(update as UpdateOperators<Record<string, unknown>>);

      const result = await client.updateByQuery({
        index: collection,
        body: {
          query,
          script: {
            source: script.source,
            params: script.params,
            lang: 'painless',
          },
        },
        max_docs: 1,
        refresh: true,
      });

      const updated = (result['updated'] as number) ?? 0;
      return createReceipt({
        operation: 'updateOne',
        collection,
        backend: 'elastic',
        startTime,
        matchedCount: updated,
        modifiedCount: updated,
      });
    } catch (err) {
      throw mapNativeError('elastic', err, collection, 'updateOne');
    }
  }

  async updateMany<T>(collection: string, filter: StrictFilter<T>, update: UpdateOperators<T>): Promise<OperationReceipt> {
    validateIndexName(collection);
    const startTime = Date.now();
    try {
      const client = this.getClient();
      const query = translateToElastic(filter as Record<string, unknown>);
      const script = translateUpdateToElastic(update as UpdateOperators<Record<string, unknown>>);

      const result = await client.updateByQuery({
        index: collection,
        body: {
          query,
          script: {
            source: script.source,
            params: script.params,
            lang: 'painless',
          },
        },
        refresh: true,
      });

      const updated = (result['updated'] as number) ?? 0;
      return createReceipt({
        operation: 'updateMany',
        collection,
        backend: 'elastic',
        startTime,
        matchedCount: (result['total'] as number) ?? updated,
        modifiedCount: updated,
      });
    } catch (err) {
      throw mapNativeError('elastic', err, collection, 'updateMany');
    }
  }

  async deleteOne<T>(collection: string, filter: StrictFilter<T>, _options?: ConfirmOptions): Promise<OperationReceipt> {
    validateIndexName(collection);
    const startTime = Date.now();
    try {
      const client = this.getClient();
      const query = translateToElastic(filter as Record<string, unknown>);

      const result = await client.deleteByQuery({
        index: collection,
        body: { query },
        max_docs: 1,
        refresh: true,
      });

      const deleted = (result['deleted'] as number) ?? 0;
      return createReceipt({
        operation: 'deleteOne',
        collection,
        backend: 'elastic',
        startTime,
        deletedCount: deleted,
      });
    } catch (err) {
      throw mapNativeError('elastic', err, collection, 'deleteOne');
    }
  }

  async deleteMany<T>(collection: string, filter: StrictFilter<T>, _options?: ConfirmOptions): Promise<OperationReceipt> {
    validateIndexName(collection);
    const startTime = Date.now();
    try {
      const client = this.getClient();
      const query = translateToElastic(filter as Record<string, unknown>);

      const result = await client.deleteByQuery({
        index: collection,
        body: { query },
        refresh: true,
      });

      const deleted = (result['deleted'] as number) ?? 0;
      return createReceipt({
        operation: 'deleteMany',
        collection,
        backend: 'elastic',
        startTime,
        deletedCount: deleted,
      });
    } catch (err) {
      throw mapNativeError('elastic', err, collection, 'deleteMany');
    }
  }

  async withTransaction<T>(_fn: (txAdapter: DatabaseAdapter) => Promise<T>): Promise<T> {
    throw new StrictDBError({
      code: 'UNSUPPORTED_OPERATION',
      message: 'Transactions are not supported for Elasticsearch.',
      fix: 'Use MongoDB, PostgreSQL, MySQL, or SQLite for transaction support.',
      backend: 'elastic',
    });
  }

  async ensureCollections(definitions: Array<{ name: string; mapping?: Record<string, unknown> }>): Promise<void> {
    const client = this.getClient();
    for (const def of definitions) {
      const exists = await client.indices.exists({ index: def.name });
      if (!exists) {
        const params: Record<string, unknown> = { index: def.name };
        if (def.mapping) {
          params['body'] = { mappings: def.mapping };
        }
        await client.indices.create(params);
      }
    }
  }

  async describeCollection(collection: string): Promise<Array<{ name: string; type: string; required: boolean }>> {
    validateIndexName(collection);
    try {
      const client = this.getClient();
      const mapping = await client.indices.getMapping({ index: collection });
      const indexMapping = (mapping[collection] as Record<string, unknown>)?.['mappings'] as Record<string, unknown>;
      const properties = (indexMapping?.['properties'] ?? {}) as Record<string, Record<string, unknown>>;

      return Object.entries(properties).map(([name, prop]) => ({
        name,
        type: (prop['type'] as string) ?? 'object',
        required: false, // ES doesn't enforce required fields via mapping
      }));
    } catch (err) {
      throw mapNativeError('elastic', err, collection, 'describe');
    }
  }

  async getDocumentCount(collection: string): Promise<number> {
    return this.count(collection);
  }

  raw(): unknown {
    return this.client;
  }
}
