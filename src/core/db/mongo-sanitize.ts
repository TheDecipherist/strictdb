/**
 * MongoDB NoSQL Injection Sanitization
 *
 * Runs automatically on ALL filter/match inputs before they touch MongoDB.
 * Extracted from mongo.ts — pure code movement.
 */

import type { Document, Filter } from 'mongodb';

// ---------------------------------------------------------------------------
// NoSQL injection sanitization — runs automatically on ALL inputs
// ---------------------------------------------------------------------------

/**
 * Sanitization is ENABLED by default. To disable, set:
 *   DB_SANITIZE_INPUTS=false  (in .env)
 *   sanitize = false          (in claude-mastery-project.conf)
 *
 * You should only disable this if you handle sanitization at a higher layer
 * (e.g., Zod/Joi validation that strips operators before they reach the db).
 */
let _sanitizeEnabled: boolean | null = null;

function isSanitizeEnabled(): boolean {
  if (_sanitizeEnabled !== null) return _sanitizeEnabled;
  _sanitizeEnabled = process.env.DB_SANITIZE_INPUTS !== 'false';
  return _sanitizeEnabled;
}

/** Programmatically enable or disable input sanitization at runtime. */
export function configureSanitization(enabled: boolean): void {
  _sanitizeEnabled = enabled;
}

/**
 * Known-safe MongoDB query operators. These are standard query/filter operators
 * that do NOT execute arbitrary code. The sanitizer allows these through while
 * still recursively sanitizing their values.
 *
 * Dangerous operators like $where, $function, $accumulator (which execute
 * arbitrary JavaScript on the server) are NOT in this list and will be stripped.
 */
const SAFE_MONGO_OPERATORS = new Set([
  // Comparison
  '$eq', '$gt', '$gte', '$lt', '$lte', '$ne', '$in', '$nin',
  // Logical
  '$and', '$or', '$nor', '$not',
  // Element
  '$exists', '$type',
  // Array
  '$all', '$elemMatch', '$size',
  // Regex
  '$regex', '$options',
  // Modulo
  '$mod',
  // Text search
  '$text', '$search', '$language', '$caseSensitive', '$diacriticSensitive',
  // Geospatial
  '$geoWithin', '$geoIntersects', '$near', '$nearSphere',
  '$geometry', '$maxDistance', '$minDistance', '$center', '$centerSphere', '$box', '$polygon',
  // Bitwise
  '$bitsAllClear', '$bitsAllSet', '$bitsAnyClear', '$bitsAnySet',
  // Expression (aggregation expressions in $match)
  '$expr',
]);

/**
 * Recursively sanitize an object to prevent NoSQL injection.
 * - Allows known-safe MongoDB operators ($gte, $in, $regex, etc.) — values still sanitized
 * - Strips dangerous operators ($where, $function, $accumulator — JS execution)
 * - Strips unknown/unrecognized $ keys (defense in depth)
 * - Strips keys containing `.` (blocks path traversal like `field.nested`)
 *
 * This runs automatically on all filter/match inputs before they touch MongoDB.
 * Internal operations (like $set, $inc in update operators) are NOT sanitized
 * because they come from trusted application code, not user input.
 *
 * Disable with DB_SANITIZE_INPUTS=false or configureSanitization(false).
 */
export function sanitize<T>(input: T): T {
  // When sanitization is disabled, pass through unchanged
  if (!isSanitizeEnabled()) return input;

  if (input === null || input === undefined) return input;

  // Primitives are safe
  if (typeof input !== 'object') return input;

  // Dates, ObjectIds, RegExp, Buffer — pass through (trusted types)
  if (input instanceof Date) return input;
  if (input instanceof RegExp) return input;
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(input)) return input;
  if (typeof input === 'object' && '_bsontype' in (input as Record<string, unknown>)) return input;

  // Arrays — sanitize each element
  if (Array.isArray(input)) {
    return input.map((item) => sanitize(item)) as unknown as T;
  }

  // Plain objects — allow safe operators, strip dangerous ones
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    // Block keys containing . (field path traversal)
    if (key.includes('.')) continue;

    if (key.startsWith('$')) {
      if (SAFE_MONGO_OPERATORS.has(key)) {
        // Known safe operator — keep key, recursively sanitize value
        cleaned[key] = sanitize(value);
      }
      // Unknown/dangerous $ key ($where, $function, etc.) — strip it
      continue;
    }

    // Regular field — recursively sanitize value
    cleaned[key] = sanitize(value);
  }
  return cleaned as T;
}

/**
 * Sanitize a filter object (user-facing queries like $match).
 * Exported for use in custom pipelines where you pass user input.
 */
export function sanitizeFilter<T>(filter: Filter<T>): Filter<T> {
  return sanitize(filter);
}

/**
 * Sanitize an aggregation pipeline.
 * Only sanitizes the value inside $match stages (where user input goes).
 * Other stages ($sort, $limit, $lookup, etc.) are trusted application code.
 */
export function sanitizePipeline(pipeline: Document[]): Document[] {
  return pipeline.map((stage) => {
    if ('$match' in stage) {
      return { $match: sanitize(stage.$match) };
    }
    return stage;
  });
}
