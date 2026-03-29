/**
 * SQL Mode 2 — Type Coercion
 *
 * Automatic value conversion to MongoDB types.
 * Order: ObjectId → Date → Boolean → Number → Array → String
 */

const OBJECTID_RE = /^[0-9a-fA-F]{24}$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/;

/**
 * Coerce a value to the appropriate MongoDB type.
 * Applied to all values before pipeline injection.
 */
export function coerceValue(value: unknown): unknown {
  // null/undefined pass through
  if (value === null || value === undefined) return value;

  // Already non-string types pass through
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return value;

  if (typeof value !== 'string') return value;

  // 1. ObjectId: exactly 24 hex characters
  if (OBJECTID_RE.test(value)) {
    return { $oid: value };
  }

  // 2. ISO 8601 Date
  if (ISO_DATE_RE.test(value)) {
    const d = new Date(value);
    if (!isNaN(d.getTime())) return d;
  }

  // 3. Boolean (case insensitive)
  if (value.toLowerCase() === 'true') return true;
  if (value.toLowerCase() === 'false') return false;

  // 4. Number (in numeric context)
  if (value !== '' && !isNaN(Number(value))) {
    return Number(value);
  }

  // 5. JSON Array
  if (value.startsWith('[') && value.endsWith(']')) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // Not valid JSON, fall through
    }
  }

  // 6. String as-is
  return value;
}

/**
 * Coerce values in a filter object recursively.
 */
export function coerceFilterValues(filter: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(filter)) {
    if (value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
      result[key] = coerceFilterValues(value as Record<string, unknown>);
    } else if (Array.isArray(value)) {
      result[key] = value.map(v => coerceValue(v));
    } else {
      result[key] = coerceValue(value);
    }
  }
  return result;
}

/**
 * Check if a string looks like an ObjectId but has invalid chars.
 * Returns true if it's 24 chars but NOT all hex.
 */
export function isAlmostObjectId(value: string): boolean {
  return value.length === 24 && !OBJECTID_RE.test(value);
}
