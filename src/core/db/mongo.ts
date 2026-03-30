/**
 * Centralized MongoDB Wrapper — Native Driver, Singleton Pool
 *
 * ALL database access MUST go through this file.
 * NEVER create MongoClient instances in other files.
 * NEVER use mongoose or ODMs — native driver only.
 *
 * Based on production patterns from Claude Code Mastery Guides.
 *
 * Best practices enforced:
 * - Singleton pool per URI (prevents connection exhaustion)
 * - Aggregation framework for all reads (consistent, flexible)
 * - BulkWrite for all writes (atomic, performant)
 * - $limit BEFORE $lookup (critical for join performance)
 * - $inc for counters (no read-modify-write races)
 * - Smart NoSQL injection sanitization (allows safe operators, blocks $where/$function)
 * - Graceful shutdown with closePool()
 * - Next.js hot-reload persistence via globalThis
 *
 * Install: npm install mongodb
 */

import {
  type AnyBulkWriteOperation,
  type ClientSession,
  type Collection,
  type Document,
  type Filter,
  type OptionalId,
  type TransactionOptions,
  type UpdateFilter,
} from 'mongodb';

// Re-export connection management
export { connect, closePool, getDb, getCollection, gracefulShutdown } from './mongo-connection.js';
export type { ConnectOptions } from './mongo-connection.js';

// Re-export sanitization
export { configureSanitization, sanitizeFilter } from './mongo-sanitize.js';

// Re-export index management
export { registerIndex, ensureIndexes } from './mongo-indexes.js';
export type { IndexDefinition } from './mongo-indexes.js';

// Import what we need internally
import { connect } from './mongo-connection.js';
import { getDb } from './mongo-connection.js';
import { sanitize, sanitizePipeline } from './mongo-sanitize.js';

// ---------------------------------------------------------------------------
// Read operations — Aggregation framework only
// ---------------------------------------------------------------------------

/**
 * Find a single document by filter.
 * Uses aggregation with automatic $limit: 1.
 *
 * Pass `{ trusted: true }` when the match filter is server-constructed
 * and uses MongoDB operators ($gte, $in, $regex, etc.).
 */
export async function queryOne<T extends Document>(
  collection: string,
  match: Filter<T>,
  options?: { trusted?: boolean },
): Promise<T | null> {
  const db = await getDb();
  const safeMatch = options?.trusted ? match : sanitize(match);
  const results = await db
    .collection<T>(collection)
    .aggregate<T>([{ $match: safeMatch }, { $limit: 1 }])
    .toArray();
  return results[0] ?? null;
}

/**
 * Find multiple documents using an aggregation pipeline.
 * Always use this over .find() for consistency.
 *
 * Pass `{ trusted: true }` when the pipeline is server-constructed
 * and uses MongoDB operators ($gte, $in, $regex, etc.) in $match stages.
 */
export async function queryMany<T extends Document>(
  collection: string,
  pipeline: Document[],
  options?: { trusted?: boolean },
): Promise<T[]> {
  const db = await getDb();
  const safePipeline = options?.trusted ? pipeline : sanitizePipeline(pipeline);
  return db.collection<T>(collection).aggregate<T>(safePipeline).toArray();
}

/**
 * Find a single document with a $lookup join.
 * Enforces $limit BEFORE $lookup for performance.
 */
export async function queryWithLookup<T extends Document>(
  collection: string,
  options: {
    match: Filter<Document>;
    lookup: {
      from: string;
      localField: string;
      foreignField: string;
      as: string;
    };
    unwind?: string;
    postStages?: Document[];
  }
): Promise<T | null> {
  const db = await getDb();
  const pipeline: Document[] = [
    { $match: sanitize(options.match) },
    { $limit: 1 }, // ALWAYS limit before lookup
    { $lookup: options.lookup },
  ];

  if (options.unwind) {
    pipeline.push({ $unwind: { path: `$${options.unwind}`, preserveNullAndEmptyArrays: true } });
  }

  if (options.postStages) {
    pipeline.push(...options.postStages);
  }

  const results = await db.collection(collection).aggregate<T>(pipeline).toArray();
  return results[0] ?? null;
}

/**
 * Count documents in a collection.
 * Uses aggregation $count for consistency.
 *
 * Pass `{ trusted: true }` when the match filter is server-constructed
 * and uses MongoDB operators ($gte, $in, $regex, etc.).
 */
export async function count(
  collection: string,
  match: Filter<Document> = {},
  options?: { trusted?: boolean },
): Promise<number> {
  const db = await getDb();
  const safeMatch = options?.trusted ? match : sanitize(match);
  const result = await db
    .collection(collection)
    .aggregate<{ count: number }>([{ $match: safeMatch }, { $count: 'count' }])
    .toArray();
  return result[0]?.count ?? 0;
}

// ---------------------------------------------------------------------------
// Write operations — BulkWrite only
// ---------------------------------------------------------------------------

/**
 * Insert a single document.
 * Wraps in bulkWrite for consistency.
 */
export interface MongoWriteResult {
  insertedId?: string;
  insertedIds?: string[];
  upsertedId?: string;
  matchedCount?: number;
  modifiedCount?: number;
}

export async function insertOne<T extends Document>(
  collection: string,
  doc: T
): Promise<MongoWriteResult> {
  const db = await getDb();
  const result = await db.collection<T>(collection).bulkWrite([
    { insertOne: { document: doc as OptionalId<T> } },
  ]);
  const insertedId = result.insertedIds?.[0];
  return {
    insertedId: insertedId ? String(insertedId) : undefined,
  };
}

/**
 * Insert multiple documents in a single batch.
 * NEVER use insertOne in a loop — always batch with this.
 */
export async function insertMany<T extends Document>(
  collection: string,
  docs: T[]
): Promise<MongoWriteResult> {
  if (docs.length === 0) return { insertedIds: [] };
  const db = await getDb();
  const result = await db.collection<T>(collection).bulkWrite(
    docs.map((doc) => ({ insertOne: { document: doc as OptionalId<T> } }))
  );
  const ids = result.insertedIds
    ? Object.values(result.insertedIds).map(id => String(id))
    : [];
  return { insertedIds: ids };
}

/**
 * Update a single document.
 * Use $inc for counters, $set for fields — never read-modify-write.
 */
export async function updateOne<T extends Document>(
  collection: string,
  filter: Filter<T>,
  update: UpdateFilter<T>,
  upsert = false
): Promise<MongoWriteResult> {
  const db = await getDb();
  const result = await db.collection<T>(collection).bulkWrite([
    { updateOne: { filter, update, upsert } },
  ]);
  const upsertedId = result.upsertedIds?.[0];
  return {
    matchedCount: result.matchedCount,
    modifiedCount: result.modifiedCount,
    upsertedId: upsertedId ? String(upsertedId) : undefined,
  };
}

/**
 * Update multiple documents matching a filter.
 */
export async function updateMany<T extends Document>(
  collection: string,
  filter: Filter<T>,
  update: UpdateFilter<T>
): Promise<void> {
  const db = await getDb();
  await db.collection<T>(collection).bulkWrite([
    { updateMany: { filter, update } },
  ]);
}

/**
 * Execute arbitrary bulk operations.
 * Use for complex multi-operation writes.
 * Includes automatic retry for E11000 concurrent upsert races.
 */
export async function bulkOps<T extends Document>(
  collection: string,
  operations: AnyBulkWriteOperation<T>[]
): Promise<void> {
  if (operations.length === 0) return;
  const db = await getDb();
  try {
    await db.collection<T>(collection).bulkWrite(operations);
  } catch (err: unknown) {
    // Retry on E11000 (concurrent upsert race condition)
    if (err && typeof err === 'object' && 'code' in err && (err as { code: number }).code === 11000) {
      await db.collection<T>(collection).bulkWrite(operations);
    } else {
      throw err;
    }
  }
}

/**
 * Delete a single document.
 */
export async function deleteOne<T extends Document>(
  collection: string,
  filter: Filter<T>
): Promise<void> {
  const db = await getDb();
  const safeFilter = sanitize(filter);
  await db.collection<T>(collection).bulkWrite([
    { deleteOne: { filter: safeFilter } },
  ]);
}

/**
 * Delete multiple documents matching a filter.
 */
export async function deleteMany<T extends Document>(
  collection: string,
  filter: Filter<T>
): Promise<void> {
  const db = await getDb();
  const safeFilter = sanitize(filter);
  await db.collection<T>(collection).bulkWrite([
    { deleteMany: { filter: safeFilter } },
  ]);
}

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

/**
 * Execute an operation within a MongoDB transaction.
 * Use for multi-document atomic operations.
 */
export async function withTransaction<T>(
  operation: (session: ClientSession) => Promise<T>,
  txOptions?: TransactionOptions
): Promise<T> {
  const { client } = await connect();
  const session = client.startSession();
  try {
    let result: T;
    await session.withTransaction(async () => {
      result = await operation(session);
    }, txOptions);
    return result!;
  } finally {
    await session.endSession();
  }
}

// ---------------------------------------------------------------------------
// Raw access (for Change Streams, advanced operations)
// ---------------------------------------------------------------------------

/**
 * Get raw access to a MongoDB Collection.
 * Use for Change Streams or operations not covered by the wrapper.
 */
export async function rawCollection<T extends Document>(
  name: string
): Promise<Collection<T>> {
  const db = await getDb();
  return db.collection<T>(name);
}
