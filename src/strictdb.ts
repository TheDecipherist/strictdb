/**
 * StrictDB — The Unified Database Interface
 *
 * One API for MongoDB, PostgreSQL, MySQL, MSSQL, SQLite, and Elasticsearch.
 * Auto-detects backend from URI. All operations flow through the pipeline:
 *
 *   Developer/AI call → StrictDB (router)
 *     → sanitize (clean input)
 *     → guardrails (block dangerous ops)
 *     → validate (schema check if enabled)
 *     → adapter (mongo/sql/elastic)
 *     → receipts (wrap result)
 *     → logger (emit event)
 *     → return to caller
 */

import type {
  Backend,
  BatchOperation,
  CollectionDescription,
  CollectionSchema,
  ConfirmOptions,
  ConnectionStatus,
  ExplainResult,
  IndexDefinition,
  LookupOptions,
  OperationReceipt,
  QueryOptions,
  SanitizeRule,
  StrictDBConfig,
  StrictDBEvents,
  StrictFilter,
  UpdateOperators,
  ValidationResult,
} from './types.js';
import { StrictDBError } from './errors.js';
import { StrictDBEventEmitter } from './events.js';
import { StrictDBLogger } from './logger.js';
import { checkGuardrails } from './guardrails.js';
import { sanitizeFilter, applySanitizeRules } from './sanitize.js';
import {
  registerCollection,
  getSchema,
  getRegisteredCollections,
  getRegisteredIndexes,
  registerIndex,
  validateDocument,
  generateCreateTableSQL,
  generateCreateIndexSQL,
  generateElasticMapping,
} from './schema.js';
import { createReceipt } from './receipts.js';
import { translateToElastic, buildSelectSQL } from './filter-translator.js';
import { resolveTimestampConfig, injectInsertTimestamps, injectUpdateTimestamps } from './timestamps.js';
import type { ResolvedTimestampConfig } from './timestamps.js';
import type { DatabaseAdapter } from './adapters/adapter.js';
import { MongoAdapter } from './adapters/mongo-adapter.js';
import { SqlAdapter } from './adapters/sql-adapter.js';
import { ElasticAdapter } from './adapters/elastic-adapter.js';

export class StrictDB {
  private adapter: DatabaseAdapter;
  private emitter: StrictDBEventEmitter;
  private logger: StrictDBLogger;
  private config: StrictDBConfig;
  private backend: Backend;
  private schemaValidation: boolean;
  private guardrailsEnabled: boolean;
  private sanitizeEnabled: boolean;
  private sanitizeRules: SanitizeRule[];
  private timestampConfig: ResolvedTimestampConfig;

  private constructor(
    config: StrictDBConfig,
    adapter: DatabaseAdapter,
    emitter: StrictDBEventEmitter,
    logger: StrictDBLogger,
    backend: Backend,
  ) {
    this.config = config;
    this.adapter = adapter;
    this.emitter = emitter;
    this.logger = logger;
    this.backend = backend;
    this.schemaValidation = config.schema ?? false;
    this.guardrailsEnabled = config.guardrails ?? true;
    this.sanitizeEnabled = config.sanitize ?? true;
    this.sanitizeRules = config.sanitizeRules ?? [];
    this.timestampConfig = resolveTimestampConfig(config.timestamps);
  }

  /**
   * Create a new StrictDB instance. Auto-detects backend from URI.
   */
  static async create(config: StrictDBConfig): Promise<StrictDB> {
    const backend = detectBackend(config.uri);
    const emitter = new StrictDBEventEmitter();
    const logger = new StrictDBLogger(
      {
        enabled: config.logging !== false,
        verbose: config.logging === 'verbose',
        slowQueryMs: config.slowQueryMs ?? 1000,
      },
      emitter,
    );

    let adapter: DatabaseAdapter;
    switch (backend) {
      case 'mongo':
        adapter = new MongoAdapter(config, emitter);
        break;
      case 'sql':
        adapter = new SqlAdapter(config, emitter);
        break;
      case 'elastic':
        adapter = new ElasticAdapter(config, emitter);
        break;
    }

    await adapter.connect();

    return new StrictDB(config, adapter, emitter, logger, backend);
  }

  // ─── Read Operations ───────────────────────────────────────────────────────

  async queryOne<T>(collection: string, filter: StrictFilter<T>, options?: QueryOptions<T>): Promise<T | null> {
    if (this.sanitizeEnabled) {
      sanitizeFilter(collection, filter as Record<string, unknown>, this.backend);
    }
    const sanitizedFilter = this.applyRulesToFilter(collection, filter);

    const result = await this.adapter.queryOne(collection, sanitizedFilter, options);
    return result;
  }

  async queryMany<T>(collection: string, filter: StrictFilter<T>, options?: QueryOptions<T>): Promise<T[]> {
    if (this.sanitizeEnabled) {
      sanitizeFilter(collection, filter as Record<string, unknown>, this.backend);
    }
    const sanitizedFilter = this.applyRulesToFilter(collection, filter);

    if (this.guardrailsEnabled) {
      checkGuardrails(
        { enabled: true, emitter: this.emitter },
        'queryMany',
        collection,
        sanitizedFilter as Record<string, unknown>,
        { limit: options?.limit },
      );
    }

    const result = await this.adapter.queryMany(collection, sanitizedFilter, options);
    return result;
  }

  async queryWithLookup<T>(collection: string, options: LookupOptions<T>): Promise<T | null> {
    if (this.sanitizeEnabled) {
      sanitizeFilter(collection, options.match as Record<string, unknown>, this.backend);
    }

    if (this.sanitizeRules.length > 0) {
      const sanitizedMatch = applySanitizeRules(
        options.match as Record<string, unknown>,
        collection,
        this.sanitizeRules,
      ) as StrictFilter<T>;
      return this.adapter.queryWithLookup(collection, { ...options, match: sanitizedMatch });
    }

    return this.adapter.queryWithLookup(collection, options);
  }

  async count<T>(collection: string, filter?: StrictFilter<T>): Promise<number> {
    if (filter && this.sanitizeEnabled) {
      sanitizeFilter(collection, filter as Record<string, unknown>, this.backend);
    }

    return this.adapter.count(collection, filter);
  }

  // ─── Write Operations ──────────────────────────────────────────────────────

  async insertOne<T>(collection: string, doc: T): Promise<OperationReceipt> {
    if (this.schemaValidation) {
      const error = validateDocument(collection, doc);
      if (error) {
        throw new StrictDBError({
          code: 'VALIDATION_ERROR',
          message: `Validation failed for "${collection}": ${error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', ')}`,
          fix: `Fix the document to match the registered schema.`,
          backend: this.backend,
          collection,
          operation: 'insertOne',
        });
      }
    }

    let sanitizedDoc = doc as Record<string, unknown>;
    if (this.sanitizeRules.length > 0) {
      sanitizedDoc = applySanitizeRules(sanitizedDoc, collection, this.sanitizeRules);
    }
    const stamped = injectInsertTimestamps(sanitizedDoc, this.timestampConfig);
    const receipt = await this.adapter.insertOne(collection, stamped);
    this.logger.logOperation(receipt);
    return receipt;
  }

  async insertMany<T>(collection: string, docs: T[]): Promise<OperationReceipt> {
    if (this.schemaValidation) {
      for (const doc of docs) {
        const error = validateDocument(collection, doc);
        if (error) {
          throw new StrictDBError({
            code: 'VALIDATION_ERROR',
            message: `Validation failed for "${collection}": ${error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', ')}`,
            fix: `Fix the documents to match the registered schema.`,
            backend: this.backend,
            collection,
            operation: 'insertMany',
          });
        }
      }
    }

    let sanitizedDocs = docs as Record<string, unknown>[];
    if (this.sanitizeRules.length > 0) {
      sanitizedDocs = sanitizedDocs.map(d => applySanitizeRules(d as Record<string, unknown>, collection, this.sanitizeRules));
    }
    const stampedDocs = sanitizedDocs.map(d => injectInsertTimestamps(d, this.timestampConfig));
    const receipt = await this.adapter.insertMany(collection, stampedDocs);
    this.logger.logOperation(receipt);
    return receipt;
  }

  async updateOne<T>(
    collection: string,
    filter: StrictFilter<T>,
    update: UpdateOperators<T>,
    upsert?: boolean,
  ): Promise<OperationReceipt> {
    if (this.sanitizeEnabled) {
      sanitizeFilter(collection, filter as Record<string, unknown>, this.backend);
    }
    const sanitizedFilter = this.applyRulesToFilter(collection, filter);
    const sanitizedUpdate = this.applyRulesToUpdate(collection, update);

    const stampedUpdate = injectUpdateTimestamps(sanitizedUpdate as Record<string, unknown>, this.timestampConfig);
    const receipt = await this.adapter.updateOne(collection, sanitizedFilter, stampedUpdate, upsert);
    this.logger.logOperation(receipt);
    return receipt;
  }

  async updateMany<T>(
    collection: string,
    filter: StrictFilter<T>,
    update: UpdateOperators<T>,
    options?: ConfirmOptions,
  ): Promise<OperationReceipt> {
    if (this.sanitizeEnabled) {
      sanitizeFilter(collection, filter as Record<string, unknown>, this.backend);
    }
    const sanitizedFilter = this.applyRulesToFilter(collection, filter);
    const sanitizedUpdate = this.applyRulesToUpdate(collection, update);

    if (this.guardrailsEnabled) {
      checkGuardrails(
        { enabled: true, emitter: this.emitter },
        'updateMany',
        collection,
        sanitizedFilter as Record<string, unknown>,
        { confirm: options?.confirm },
      );
    }

    const stampedUpdate = injectUpdateTimestamps(sanitizedUpdate as Record<string, unknown>, this.timestampConfig);
    const receipt = await this.adapter.updateMany(collection, sanitizedFilter, stampedUpdate);
    this.logger.logOperation(receipt);
    return receipt;
  }

  async deleteOne<T>(collection: string, filter: StrictFilter<T>, options?: ConfirmOptions): Promise<OperationReceipt> {
    if (this.sanitizeEnabled) {
      sanitizeFilter(collection, filter as Record<string, unknown>, this.backend);
    }
    const sanitizedFilter = this.applyRulesToFilter(collection, filter);

    if (this.guardrailsEnabled) {
      checkGuardrails(
        { enabled: true, emitter: this.emitter },
        'deleteOne',
        collection,
        sanitizedFilter as Record<string, unknown>,
      );
    }

    const receipt = await this.adapter.deleteOne(collection, sanitizedFilter, options);
    this.logger.logOperation(receipt);
    return receipt;
  }

  async deleteMany<T>(collection: string, filter: StrictFilter<T>, options?: ConfirmOptions): Promise<OperationReceipt> {
    if (this.sanitizeEnabled) {
      sanitizeFilter(collection, filter as Record<string, unknown>, this.backend);
    }
    const sanitizedFilter = this.applyRulesToFilter(collection, filter);

    if (this.guardrailsEnabled) {
      checkGuardrails(
        { enabled: true, emitter: this.emitter },
        'deleteMany',
        collection,
        sanitizedFilter as Record<string, unknown>,
        { confirm: options?.confirm },
      );
    }

    const receipt = await this.adapter.deleteMany(collection, sanitizedFilter, options);
    this.logger.logOperation(receipt);
    return receipt;
  }

  // ─── Batch Operations ──────────────────────────────────────────────────────

  async batch(operations: BatchOperation[]): Promise<OperationReceipt> {
    const startTime = Date.now();
    let insertedCount = 0;
    let modifiedCount = 0;
    let deletedCount = 0;

    for (const op of operations) {
      let receipt: OperationReceipt;
      switch (op.operation) {
        case 'insertOne': {
          const doc = injectInsertTimestamps(op.doc, this.timestampConfig);
          receipt = await this.adapter.insertOne(op.collection, doc);
          insertedCount += receipt.insertedCount;
          break;
        }
        case 'insertMany': {
          const docs = op.docs.map(d => injectInsertTimestamps(d, this.timestampConfig));
          receipt = await this.adapter.insertMany(op.collection, docs);
          insertedCount += receipt.insertedCount;
          break;
        }
        case 'updateOne': {
          const update = injectUpdateTimestamps(op.update as Record<string, unknown>, this.timestampConfig);
          receipt = await this.adapter.updateOne(op.collection, op.filter, update, op.upsert);
          modifiedCount += receipt.modifiedCount;
          break;
        }
        case 'updateMany': {
          const update = injectUpdateTimestamps(op.update as Record<string, unknown>, this.timestampConfig);
          receipt = await this.adapter.updateMany(op.collection, op.filter, update);
          modifiedCount += receipt.modifiedCount;
          break;
        }
        case 'deleteOne':
          receipt = await this.adapter.deleteOne(op.collection, op.filter);
          deletedCount += receipt.deletedCount;
          break;
        case 'deleteMany':
          receipt = await this.adapter.deleteMany(op.collection, op.filter);
          deletedCount += receipt.deletedCount;
          break;
      }
    }

    const batchReceipt = createReceipt({
      operation: 'batch',
      collection: 'batch',
      backend: this.backend,
      startTime,
      insertedCount,
      modifiedCount,
      deletedCount,
    });

    this.logger.logOperation(batchReceipt);
    return batchReceipt;
  }

  // ─── Transactions ──────────────────────────────────────────────────────────

  async withTransaction<T>(fn: (tx: StrictDB) => Promise<T>): Promise<T> {
    if (!this.adapter.withTransaction) {
      throw new StrictDBError({
        code: 'UNSUPPORTED_OPERATION',
        message: `Transactions are not supported for the ${this.backend} backend.`,
        fix: 'Use MongoDB (with replica set), PostgreSQL, MySQL, or SQLite for transaction support.',
        backend: this.backend,
      });
    }

    return this.adapter.withTransaction(async (txAdapter) => {
      const tx = new StrictDB(this.config, txAdapter, this.emitter, this.logger, this.backend);
      return fn(tx);
    });
  }

  // ─── Schema & Indexes ──────────────────────────────────────────────────────

  registerCollection<T>(definition: CollectionSchema<T>): void {
    registerCollection(definition);
  }

  registerIndex(definition: IndexDefinition): void {
    registerIndex(definition);
  }

  async ensureCollections(options?: { dryRun?: boolean }): Promise<void> {
    const collections = getRegisteredCollections();
    const definitions: Array<{ name: string; sql?: string; mapping?: Record<string, unknown> }> = [];

    for (const name of collections) {
      const schema = getSchema(name);
      if (!schema) continue;

      if (this.backend === 'sql') {
        const dialect = detectSqlDialect(this.config.uri);
        const sql = generateCreateTableSQL(name, schema.schema, dialect);
        if (options?.dryRun) {
          console.log(`[strictdb] Would create table:\n${sql}`);
        } else {
          definitions.push({ name, sql });
        }
      } else if (this.backend === 'elastic') {
        const mapping = generateElasticMapping(schema.schema);
        if (options?.dryRun) {
          console.log(`[strictdb] Would create index "${name}" with mapping:`, JSON.stringify(mapping, null, 2));
        } else {
          definitions.push({ name, mapping });
        }
      }
    }

    if (!options?.dryRun && definitions.length > 0 && this.adapter.ensureCollections) {
      await this.adapter.ensureCollections(definitions);
    }
  }

  async ensureIndexes(options?: { dryRun?: boolean }): Promise<void> {
    const indexes = getRegisteredIndexes();

    if (this.backend === 'sql') {
      const dialect = detectSqlDialect(this.config.uri);
      for (const idx of indexes) {
        const sql = generateCreateIndexSQL(idx, dialect);
        if (options?.dryRun) {
          console.log(`[strictdb] Would create index:\n${sql}`);
        } else if (this.adapter.ensureCollections) {
          // Use raw SQL execution for index creation
          const rawAdapter = this.adapter.raw() as { execute?(sql: string): Promise<unknown> };
          if (rawAdapter.execute) {
            await rawAdapter.execute(sql);
          }
        }
      }
    } else if (this.adapter.ensureIndexes) {
      if (options?.dryRun) {
        for (const idx of indexes) {
          console.log(`[strictdb] Would create index:`, idx);
        }
      } else {
        await this.adapter.ensureIndexes(indexes);
      }
    }
  }

  // ─── AI-First: Discovery & Validation ──────────────────────────────────────

  async describe(collection: string): Promise<CollectionDescription> {
    const schema = getSchema(collection);

    // If schema is registered, use it
    if (schema) {
      const fields = extractFieldInfo(schema);
      const indexes = getRegisteredIndexes().filter(i => i.collection === collection);
      const docCount = this.adapter.getDocumentCount
        ? await this.adapter.getDocumentCount(collection)
        : 0;

      return {
        name: collection,
        backend: this.backend,
        fields,
        indexes,
        documentCount: docCount,
        exampleFilter: buildExampleFilter(fields),
      };
    }

    // Fall back to runtime introspection
    if (this.adapter.describeCollection) {
      const fields = await this.adapter.describeCollection(collection);
      const docCount = this.adapter.getDocumentCount
        ? await this.adapter.getDocumentCount(collection)
        : 0;

      return {
        name: collection,
        backend: this.backend,
        fields: fields.map(f => ({ ...f, enum: undefined })),
        indexes: [],
        documentCount: docCount,
        exampleFilter: {},
      };
    }

    throw new StrictDBError({
      code: 'COLLECTION_NOT_FOUND',
      message: `Cannot describe "${collection}" — no schema registered and introspection not available.`,
      fix: `Register a schema with db.registerCollection() or ensure the collection exists.`,
      backend: this.backend,
      collection,
    });
  }

  async validate(collection: string, operation: { filter?: Record<string, unknown>; update?: UpdateOperators<Record<string, unknown>>; doc?: Record<string, unknown> }): Promise<ValidationResult> {
    const errors: ValidationResult['errors'] = [];

    // Validate filter field names
    if (operation.filter) {
      const schema = getSchema(collection);
      if (schema) {
        const fieldNames = extractFieldInfo(schema).map(f => f.name);
        for (const key of Object.keys(operation.filter)) {
          if (!key.startsWith('$') && !fieldNames.includes(key)) {
            errors.push({
              field: key,
              message: `Unknown field "${key}"`,
              expected: fieldNames.join(', '),
              received: key,
            });
          }
        }
      }
    }

    // Validate document against schema
    if (operation.doc) {
      const error = validateDocument(collection, operation.doc);
      if (error) {
        for (const issue of error.issues) {
          errors.push({
            field: issue.path.join('.'),
            message: issue.message,
            expected: 'valid value',
            received: String(issue.code),
          });
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  async explain(collection: string, operation: { filter?: Record<string, unknown>; sort?: Record<string, unknown>; limit?: number }): Promise<ExplainResult> {
    const filter = operation.filter ?? {};

    switch (this.backend) {
      case 'mongo': {
        const pipeline: Record<string, unknown>[] = [{ $match: filter }];
        if (operation.sort) pipeline.push({ $sort: operation.sort });
        if (operation.limit) pipeline.push({ $limit: operation.limit });
        return { backend: 'mongo', native: pipeline };
      }
      case 'sql': {
        const dialect = detectSqlDialect(this.config.uri);
        const query = buildSelectSQL(collection, filter, {
          sort: operation.sort,
          limit: operation.limit,
          dialect,
        });
        return { backend: 'sql', native: query.sql };
      }
      case 'elastic': {
        const query = translateToElastic(filter);
        return { backend: 'elastic', native: query };
      }
    }
  }

  // ─── Status & Health ───────────────────────────────────────────────────────

  status(): ConnectionStatus {
    return this.adapter.status();
  }

  // ─── Events ────────────────────────────────────────────────────────────────

  on<E extends keyof StrictDBEvents>(event: E, listener: (payload: StrictDBEvents[E]) => void): this {
    this.emitter.on(event, listener);
    return this;
  }

  once<E extends keyof StrictDBEvents>(event: E, listener: (payload: StrictDBEvents[E]) => void): this {
    this.emitter.once(event, listener);
    return this;
  }

  off<E extends keyof StrictDBEvents>(event: E, listener: (payload: StrictDBEvents[E]) => void): this {
    this.emitter.off(event, listener);
    return this;
  }

  // ─── Sanitize Rule Helpers ─────────────────────────────────────────────────

  private applyRulesToFilter<T>(collection: string, filter: StrictFilter<T>): StrictFilter<T> {
    if (this.sanitizeRules.length === 0) return filter;
    return applySanitizeRules(
      filter as Record<string, unknown>,
      collection,
      this.sanitizeRules,
    ) as StrictFilter<T>;
  }

  private applyRulesToUpdate<T>(collection: string, update: UpdateOperators<T>): UpdateOperators<T> {
    if (this.sanitizeRules.length === 0 || !update.$set) return update;
    const sanitizedSet = applySanitizeRules(
      update.$set as Record<string, unknown>,
      collection,
      this.sanitizeRules,
    );
    return { ...update, $set: sanitizedSet } as UpdateOperators<T>;
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  async close(): Promise<void> {
    await this.adapter.close();
  }

  async gracefulShutdown(exitCode = 0): Promise<void> {
    this.emitter.emit('shutdown', { exitCode });
    await this.close();
  }

  // ─── Escape Hatch ──────────────────────────────────────────────────────────

  raw(): unknown {
    return this.adapter.raw();
  }
}

// ─── Backend Detection ───────────────────────────────────────────────────────

function detectBackend(uri: string): Backend {
  if (uri.startsWith('mongodb://') || uri.startsWith('mongodb+srv://')) return 'mongo';
  if (uri.startsWith('postgresql://') || uri.startsWith('postgres://')) return 'sql';
  if (uri.startsWith('mysql://')) return 'sql';
  if (uri.startsWith('mssql://')) return 'sql';
  if (uri.startsWith('file:') || uri.startsWith('sqlite:')) return 'sql';
  if (uri.startsWith('http://') || uri.startsWith('https://')) return 'elastic';

  throw new StrictDBError({
    code: 'CONNECTION_FAILED',
    message: `Unsupported URI scheme in "${uri.substring(0, 20)}..."`,
    fix: 'Use mongodb://, postgresql://, mysql://, mssql://, sqlite:, or https:// for Elasticsearch.',
    backend: 'mongo',
  });
}

function detectSqlDialect(uri: string): 'pg' | 'mysql2' | 'mssql' | 'sqlite' {
  if (uri.startsWith('postgresql://') || uri.startsWith('postgres://')) return 'pg';
  if (uri.startsWith('mysql://')) return 'mysql2';
  if (uri.startsWith('mssql://')) return 'mssql';
  if (uri.startsWith('file:') || uri.startsWith('sqlite:')) return 'sqlite';
  return 'pg';
}

// ─── Schema Helpers ──────────────────────────────────────────────────────────

function extractFieldInfo(schema: CollectionSchema): Array<{ name: string; type: string; required: boolean; enum?: string[] }> {
  const def = (schema.schema as unknown as Record<string, unknown>)['_def'] as Record<string, unknown> | undefined;
  if (!def) return [];

  const typeName = def['typeName'] as string | undefined;
  if (typeName !== 'ZodObject') return [];

  const shape = def['shape'] as (() => Record<string, unknown>) | Record<string, unknown>;
  const resolved = typeof shape === 'function' ? shape() : shape;

  return Object.entries(resolved).map(([name, fieldSchema]) => {
    const fieldDef = (fieldSchema as Record<string, unknown>)['_def'] as Record<string, unknown>;
    const fieldType = fieldDef?.['typeName'] as string | undefined;

    let type = 'unknown';
    let required = true;
    let enumValues: string[] | undefined;

    let currentDef = fieldDef;
    let currentType = fieldType;

    // Unwrap Optional/Nullable/Default
    while (currentType === 'ZodOptional' || currentType === 'ZodNullable' || currentType === 'ZodDefault') {
      required = false;
      const inner = currentDef?.['innerType'] as Record<string, unknown> | undefined;
      if (inner) {
        currentDef = (inner as Record<string, unknown>)['_def'] as Record<string, unknown>;
        currentType = currentDef?.['typeName'] as string | undefined;
      } else {
        break;
      }
    }

    switch (currentType) {
      case 'ZodString': type = 'string'; break;
      case 'ZodNumber': type = 'number'; break;
      case 'ZodBoolean': type = 'boolean'; break;
      case 'ZodDate': type = 'date'; break;
      case 'ZodEnum':
        type = 'enum';
        enumValues = currentDef?.['values'] as string[];
        break;
      case 'ZodArray': type = 'array'; break;
      case 'ZodObject': type = 'object'; break;
    }

    return { name, type, required, enum: enumValues };
  });
}

function buildExampleFilter(fields: Array<{ name: string; type: string; enum?: string[] }>): Record<string, unknown> {
  const filter: Record<string, unknown> = {};
  for (const field of fields.slice(0, 2)) {
    switch (field.type) {
      case 'string':
        filter[field.name] = 'example';
        break;
      case 'number':
        filter[field.name] = { $gte: 0 };
        break;
      case 'boolean':
        filter[field.name] = true;
        break;
      case 'enum':
        if (field.enum && field.enum.length > 0) {
          filter[field.name] = field.enum[0];
        }
        break;
    }
  }
  return filter;
}
