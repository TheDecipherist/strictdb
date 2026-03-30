/**
 * Self-Correcting Error Helpers
 */

import { StrictDBError } from '../errors.js';

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

// ─── Private Helpers ────────────────────────────────────────────────────────

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
