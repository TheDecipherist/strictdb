/**
 * StrictDB Error System — Normalized errors with self-correcting fix instructions
 *
 * All database errors are caught, normalized into StrictDBError instances,
 * and include AI-readable fix instructions for automatic recovery.
 */

import type { Backend, StrictErrorCode } from './types.js';

// ─── StrictDBError ───────────────────────────────────────────────────────────

export class StrictDBError extends Error {
  readonly code: StrictErrorCode;
  readonly backend: Backend;
  readonly originalError: unknown;
  readonly collection?: string;
  readonly operation?: string;
  readonly retryable: boolean;
  readonly timestamp: Date;
  readonly fix: string;

  constructor(opts: {
    code: StrictErrorCode;
    message: string;
    fix: string;
    backend: Backend;
    originalError?: unknown;
    collection?: string;
    operation?: string;
    retryable?: boolean;
  }) {
    super(`${opts.message} Fix: ${opts.fix}`);
    this.name = 'StrictDBError';
    this.code = opts.code;
    this.backend = opts.backend;
    this.originalError = opts.originalError;
    this.collection = opts.collection;
    this.operation = opts.operation;
    this.retryable = opts.retryable ?? false;
    this.timestamp = new Date();
    this.fix = opts.fix;
  }
}

// ─── Error Code Metadata ─────────────────────────────────────────────────────

export const ERROR_RETRYABLE: Record<StrictErrorCode, boolean> = {
  CONNECTION_FAILED: true,
  CONNECTION_LOST: true,
  AUTHENTICATION_FAILED: false,
  TIMEOUT: true,
  POOL_EXHAUSTED: true,
  DUPLICATE_KEY: false,
  VALIDATION_ERROR: false,
  COLLECTION_NOT_FOUND: false,
  QUERY_ERROR: false,
  GUARDRAIL_BLOCKED: false,
  UNKNOWN_OPERATOR: false,
  SCHEMA_MISMATCH: false,
  UNSUPPORTED_OPERATION: false,
  INTERNAL_ERROR: false,
};

// ─── MongoDB Error Mapping ───────────────────────────────────────────────────

export function mapMongoError(err: unknown, collection?: string, operation?: string): StrictDBError {
  const e = err as Record<string, unknown>;
  const code = e['code'] as number | undefined;
  const message = e['message'] as string | undefined ?? String(err);

  // E11000 duplicate key
  if (code === 11000) {
    const match = message.match(/index: (\S+)/);
    const indexName = match?.[1] ?? 'unknown';
    return new StrictDBError({
      code: 'DUPLICATE_KEY',
      message: `Duplicate key violation on index "${indexName}" in "${collection ?? 'unknown'}".`,
      fix: `A document with this value already exists. Use db.updateOne() to update instead, or check for existence with db.queryOne() first.`,
      backend: 'mongo',
      originalError: err,
      collection,
      operation,
    });
  }

  // Topology closed / connection lost
  if (message.includes('topology was destroyed') || message.includes('TopologyDescription') || message.includes('Server selection timed out')) {
    return new StrictDBError({
      code: 'CONNECTION_LOST',
      message: `MongoDB connection lost.`,
      fix: `Connection will auto-reconnect. If persistent, check the MongoDB URI and network connectivity.`,
      backend: 'mongo',
      originalError: err,
      collection,
      operation,
      retryable: true,
    });
  }

  // Authentication
  if (code === 18 || message.includes('Authentication failed') || message.includes('EAUTH')) {
    return new StrictDBError({
      code: 'AUTHENTICATION_FAILED',
      message: `MongoDB authentication failed.`,
      fix: `Check your MongoDB username and password in the connection URI.`,
      backend: 'mongo',
      originalError: err,
      collection,
      operation,
    });
  }

  // Connection refused
  if (message.includes('ECONNREFUSED') || message.includes('connect ENOTFOUND')) {
    return new StrictDBError({
      code: 'CONNECTION_FAILED',
      message: `Cannot connect to MongoDB.`,
      fix: `Verify the MongoDB URI is correct and the server is running. Check firewall and network access.`,
      backend: 'mongo',
      originalError: err,
      collection,
      operation,
      retryable: true,
    });
  }

  // Timeout
  if (message.includes('timed out') || message.includes('maxTimeMS')) {
    return new StrictDBError({
      code: 'TIMEOUT',
      message: `MongoDB query timed out on "${collection ?? 'unknown'}".`,
      fix: `Add a filter to narrow results, add an index, or increase the timeout.`,
      backend: 'mongo',
      originalError: err,
      collection,
      operation,
      retryable: true,
    });
  }

  // Fallback
  return new StrictDBError({
    code: 'INTERNAL_ERROR',
    message: `MongoDB error on "${collection ?? 'unknown'}": ${message}`,
    fix: `Check the original error for details.`,
    backend: 'mongo',
    originalError: err,
    collection,
    operation,
  });
}

// ─── SQL Error Mapping ───────────────────────────────────────────────────────

export function mapSqlError(err: unknown, collection?: string, operation?: string): StrictDBError {
  const e = err as Record<string, unknown>;
  const code = (e['code'] as string) ?? '';
  const message = (e['message'] as string) ?? String(err);

  // PostgreSQL 23505, MySQL ER_DUP_ENTRY
  if (code === '23505' || code === 'ER_DUP_ENTRY' || message.includes('UNIQUE constraint failed')) {
    return new StrictDBError({
      code: 'DUPLICATE_KEY',
      message: `Duplicate key violation in "${collection ?? 'unknown'}".`,
      fix: `A row with this value already exists. Use db.updateOne() to update instead, or check for existence with db.queryOne() first.`,
      backend: 'sql',
      originalError: err,
      collection,
      operation,
    });
  }

  // Connection refused
  if (code === 'ECONNREFUSED' || message.includes('ECONNREFUSED') || message.includes('connect ENOTFOUND')) {
    return new StrictDBError({
      code: 'CONNECTION_FAILED',
      message: `Cannot connect to SQL database.`,
      fix: `Verify the DATABASE_URL is correct and the database server is running.`,
      backend: 'sql',
      originalError: err,
      collection,
      operation,
      retryable: true,
    });
  }

  // PostgreSQL 57014 query_canceled (timeout)
  if (code === '57014' || message.includes('canceling statement due to statement timeout')) {
    return new StrictDBError({
      code: 'TIMEOUT',
      message: `SQL query timed out on "${collection ?? 'unknown'}".`,
      fix: `Add a filter to narrow results, add an index, or increase the statement timeout.`,
      backend: 'sql',
      originalError: err,
      collection,
      operation,
      retryable: true,
    });
  }

  // Authentication
  if (code === '28P01' || code === '28000' || message.includes('password authentication failed')) {
    return new StrictDBError({
      code: 'AUTHENTICATION_FAILED',
      message: `SQL authentication failed.`,
      fix: `Check your database username and password in the connection URI.`,
      backend: 'sql',
      originalError: err,
      collection,
      operation,
    });
  }

  // Table not found
  if (code === '42P01' || message.includes('no such table') || message.includes('does not exist')) {
    return new StrictDBError({
      code: 'COLLECTION_NOT_FOUND',
      message: `Table "${collection ?? 'unknown'}" not found.`,
      fix: `Run db.ensureCollections() to create tables from registered schemas, or check the table name.`,
      backend: 'sql',
      originalError: err,
      collection,
      operation,
    });
  }

  // Pool exhausted
  if (message.includes('timeout exceeded') && message.includes('pool')) {
    return new StrictDBError({
      code: 'POOL_EXHAUSTED',
      message: `SQL connection pool exhausted.`,
      fix: `Increase pool size with { pool: 'high' } or ensure connections are being released properly.`,
      backend: 'sql',
      originalError: err,
      collection,
      operation,
      retryable: true,
    });
  }

  // Fallback
  return new StrictDBError({
    code: 'INTERNAL_ERROR',
    message: `SQL error on "${collection ?? 'unknown'}": ${message}`,
    fix: `Check the original error for details.`,
    backend: 'sql',
    originalError: err,
    collection,
    operation,
  });
}

// ─── Elasticsearch Error Mapping ─────────────────────────────────────────────

export function mapElasticError(err: unknown, collection?: string, operation?: string): StrictDBError {
  const e = err as Record<string, unknown>;
  const statusCode = (e['statusCode'] as number) ?? (e['status'] as number);
  const message = (e['message'] as string) ?? String(err);
  const meta = e['meta'] as Record<string, unknown> | undefined;
  const body = meta?.['body'] as Record<string, unknown> | undefined;
  const errorType = (body?.['error'] as Record<string, unknown>)?.['type'] as string | undefined;

  // 409 version conflict (duplicate key equivalent)
  if (statusCode === 409) {
    return new StrictDBError({
      code: 'DUPLICATE_KEY',
      message: `Document version conflict in "${collection ?? 'unknown'}".`,
      fix: `The document was modified concurrently. Retry the operation or use db.queryOne() to get the latest version first.`,
      backend: 'elastic',
      originalError: err,
      collection,
      operation,
    });
  }

  // 401/403 authentication
  if (statusCode === 401 || statusCode === 403) {
    return new StrictDBError({
      code: 'AUTHENTICATION_FAILED',
      message: `Elasticsearch authentication failed (HTTP ${statusCode}).`,
      fix: `Check your Elasticsearch API key or credentials in the config.`,
      backend: 'elastic',
      originalError: err,
      collection,
      operation,
    });
  }

  // 404 index not found
  if (statusCode === 404 || errorType === 'index_not_found_exception') {
    return new StrictDBError({
      code: 'COLLECTION_NOT_FOUND',
      message: `Index "${collection ?? 'unknown'}" not found in Elasticsearch.`,
      fix: `Run db.ensureCollections() to create the index, or check the index name.`,
      backend: 'elastic',
      originalError: err,
      collection,
      operation,
    });
  }

  // Connection errors
  if (message.includes('ConnectionError') || message.includes('ECONNREFUSED') || message.includes('connect ENOTFOUND')) {
    return new StrictDBError({
      code: 'CONNECTION_FAILED',
      message: `Cannot connect to Elasticsearch.`,
      fix: `Verify the Elasticsearch URI is correct and the cluster is running. Check network access.`,
      backend: 'elastic',
      originalError: err,
      collection,
      operation,
      retryable: true,
    });
  }

  // Timeout
  if (message.includes('TimeoutError') || message.includes('Request timed out')) {
    return new StrictDBError({
      code: 'TIMEOUT',
      message: `Elasticsearch query timed out on "${collection ?? 'unknown'}".`,
      fix: `Add a filter to narrow results or increase the request timeout.`,
      backend: 'elastic',
      originalError: err,
      collection,
      operation,
      retryable: true,
    });
  }

  // Fallback
  return new StrictDBError({
    code: 'INTERNAL_ERROR',
    message: `Elasticsearch error on "${collection ?? 'unknown'}": ${message}`,
    fix: `Check the original error for details.`,
    backend: 'elastic',
    originalError: err,
    collection,
    operation,
  });
}

// ─── Generic Error Mapper ────────────────────────────────────────────────────

export function mapNativeError(
  backend: Backend,
  err: unknown,
  collection?: string,
  operation?: string,
): StrictDBError {
  if (err instanceof StrictDBError) return err;

  switch (backend) {
    case 'mongo':
      return mapMongoError(err, collection, operation);
    case 'sql':
      return mapSqlError(err, collection, operation);
    case 'elastic':
      return mapElasticError(err, collection, operation);
  }
}

// ─── Self-Correcting Error Helpers ───────────────────────────────────────────

export function unknownMethodError(methodName: string): StrictDBError {
  const suggestions: Record<string, string> = {
    find: 'db.queryMany(collection, filter)',
    findOne: 'db.queryOne(collection, filter)',
    findOneAndUpdate: 'db.updateOne(collection, filter, update)',
    findOneAndDelete: 'db.deleteOne(collection, filter)',
    aggregate: 'db.queryMany(collection, filter) — StrictDB handles aggregation internally',
    save: 'db.insertOne(collection, doc) or db.updateOne(collection, filter, update)',
    remove: 'db.deleteOne(collection, filter) or db.deleteMany(collection, filter)',
    create: 'db.insertOne(collection, doc)',
    bulkWrite: 'db.batch(operations)',
    collection: 'Pass the collection name as first argument: db.queryMany("users", filter)',
  };

  const suggestion = suggestions[methodName];
  const fix = suggestion
    ? `Use ${suggestion}.`
    : `Check the StrictDB API. Available methods: queryOne, queryMany, count, insertOne, insertMany, updateOne, updateMany, deleteOne, deleteMany, batch, describe, validate, explain.`;

  return new StrictDBError({
    code: 'UNSUPPORTED_OPERATION',
    message: `Method "${methodName}" does not exist on StrictDB.`,
    fix,
    backend: 'mongo',
  });
}

export function unknownOperatorError(operator: string, collection?: string): StrictDBError {
  const suggestions: Record<string, string> = {
    $match: 'Use filter syntax: db.queryMany("col", { status: "active" }). $match is a MongoDB aggregation concept — StrictDB handles this internally.',
    $project: 'Use projection in options: db.queryMany("col", filter, { projection: { name: 1 } }).',
    $group: 'StrictDB does not support aggregation pipelines directly. Use db.queryMany() with filters and process results in application code.',
    $lookup: 'Use db.queryWithLookup() for joins.',
    $sort: 'Use sort in options: db.queryMany("col", filter, { sort: { name: 1 } }).',
    $limit: 'Use limit in options: db.queryMany("col", filter, { limit: 50 }).',
    $skip: 'Use skip in options: db.queryMany("col", filter, { skip: 10 }).',
  };

  const fix = suggestions[operator]
    ?? `Unknown operator "${operator}". Supported filter operators: $eq, $ne, $gt, $gte, $lt, $lte, $in, $nin, $exists, $regex, $not, $and, $or, $nor, $size.`;

  return new StrictDBError({
    code: 'UNKNOWN_OPERATOR',
    message: `Unknown operator "${operator}" in filter.`,
    fix,
    backend: 'mongo',
    collection,
  });
}

export function collectionNotFoundError(name: string, registered: string[]): StrictDBError {
  // Fuzzy match suggestion
  const suggestion = findClosestMatch(name, registered);
  const registeredList = registered.length > 0
    ? `Registered collections: ${registered.join(', ')}.`
    : 'No collections are registered.';

  const fix = suggestion
    ? `Did you mean "${suggestion}"? ${registeredList}`
    : registeredList;

  return new StrictDBError({
    code: 'COLLECTION_NOT_FOUND',
    message: `Collection "${name}" not found.`,
    fix,
    backend: 'mongo',
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function findClosestMatch(input: string, candidates: string[]): string | null {
  if (candidates.length === 0) return null;

  let bestMatch: string | null = null;
  let bestDistance = Infinity;

  for (const candidate of candidates) {
    const dist = levenshtein(input.toLowerCase(), candidate.toLowerCase());
    if (dist < bestDistance && dist <= 3) {
      bestDistance = dist;
      bestMatch = candidate;
    }
  }

  return bestMatch;
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0) as number[]);

  for (let i = 0; i <= m; i++) dp[i]![0] = i;
  for (let j = 0; j <= n; j++) dp[0]![j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i]![j] = Math.min(
        dp[i - 1]![j]! + 1,
        dp[i]![j - 1]! + 1,
        dp[i - 1]![j - 1]! + cost,
      );
    }
  }

  return dp[m]![n]!;
}
