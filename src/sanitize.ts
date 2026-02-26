/**
 * StrictDB Input Sanitization — Backend-specific
 *
 * MongoDB: Already handled internally by core/db/mongo.ts (whitelist-based)
 * SQL: Column name validation against schema + parameterized values
 * Elasticsearch: Field name validation + script injection prevention
 */

import { StrictDBError } from './errors.js';
import type { Backend, SanitizeRule } from './types.js';

// ─── Column/Field Whitelist ──────────────────────────────────────────────────

const schemaCache = new Map<string, Set<string>>();

/**
 * Register known fields for a collection. Used by the filter translator
 * to validate field names in filters and prevent identifier injection.
 */
export function registerFields(collection: string, fields: string[]): void {
  schemaCache.set(collection, new Set(fields));
}

export function getRegisteredFields(collection: string): Set<string> | undefined {
  return schemaCache.get(collection);
}

export function clearFieldRegistry(): void {
  schemaCache.clear();
}

// ─── SQL Sanitization ────────────────────────────────────────────────────────

/**
 * Validate that all field names in a filter exist in the registered schema.
 * Only validates if schema is registered for the collection.
 * If no schema registered, allows all field names through (runtime introspection fallback).
 */
export function validateFilterFields(
  collection: string,
  filter: Record<string, unknown>,
  backend: Backend,
): void {
  const fields = schemaCache.get(collection);
  if (!fields) return; // No schema registered — skip validation

  validateFieldsRecursive(collection, filter, fields, backend);
}

function validateFieldsRecursive(
  collection: string,
  filter: Record<string, unknown>,
  validFields: Set<string>,
  backend: Backend,
): void {
  for (const [key, value] of Object.entries(filter)) {
    // Skip logical operators
    if (key === '$and' || key === '$or' || key === '$nor') {
      if (Array.isArray(value)) {
        for (const sub of value) {
          validateFieldsRecursive(collection, sub as Record<string, unknown>, validFields, backend);
        }
      }
      continue;
    }

    // Skip other operators
    if (key.startsWith('$')) continue;

    // Validate field name
    if (!validFields.has(key)) {
      const suggestions = [...validFields].join(', ');
      throw new StrictDBError({
        code: 'QUERY_ERROR',
        message: `Unknown field "${key}" in collection "${collection}".`,
        fix: `Valid fields: ${suggestions}. Check the field name for typos.`,
        backend,
        collection,
      });
    }
  }
}

// ─── Elasticsearch Sanitization ──────────────────────────────────────────────

/** ES internal fields that must never be used in user queries */
const ES_INTERNAL_FIELDS = new Set([
  '_id', '_index', '_score', '_source', '_type', '_routing',
  '_meta', '_field_names', '_ignored', '_seq_no', '_primary_term',
]);

/**
 * Validate field names for Elasticsearch queries.
 * Blocks access to internal ES fields and validates against schema.
 */
export function validateElasticFields(
  collection: string,
  filter: Record<string, unknown>,
): void {
  for (const [key, value] of Object.entries(filter)) {
    if (key === '$and' || key === '$or' || key === '$nor') {
      if (Array.isArray(value)) {
        for (const sub of value) {
          validateElasticFields(collection, sub as Record<string, unknown>);
        }
      }
      continue;
    }

    if (key.startsWith('$')) continue;

    // Block ES internal fields
    if (ES_INTERNAL_FIELDS.has(key)) {
      throw new StrictDBError({
        code: 'QUERY_ERROR',
        message: `Field "${key}" is an Elasticsearch internal field and cannot be used in queries.`,
        fix: `Remove "${key}" from your filter. To query by document ID, use a separate lookup method.`,
        backend: 'elastic',
        collection,
      });
    }

    // Validate against registered schema
    validateFilterFields(collection, { [key]: value }, 'elastic');
  }
}

/**
 * Validate an Elasticsearch index name to prevent cross-index access.
 */
export function validateIndexName(name: string): void {
  // Block wildcard patterns
  if (name.includes('*') || name.includes(',') || name.includes(' ')) {
    throw new StrictDBError({
      code: 'QUERY_ERROR',
      message: `Invalid index name "${name}".`,
      fix: `Index names cannot contain wildcards (*), commas, or spaces. Use a specific index name.`,
      backend: 'elastic',
    });
  }

  // Block names starting with dot or dash (system indices)
  if (name.startsWith('.') || name.startsWith('-')) {
    throw new StrictDBError({
      code: 'QUERY_ERROR',
      message: `Index name "${name}" appears to be a system index.`,
      fix: `System indices (starting with . or -) cannot be accessed directly. Use a regular index name.`,
      backend: 'elastic',
    });
  }
}

/**
 * Validate regex patterns for catastrophic backtracking.
 * Rejects patterns with nested quantifiers that could cause exponential matching.
 */
export function validateRegexComplexity(pattern: string): void {
  // Check for nested quantifiers like (a+)+ or (a*)*
  const nestedQuantifier = /(\(.+[+*]\))[+*]|\(\?[^)]*[+*][^)]*\)[+*]/;
  if (nestedQuantifier.test(pattern)) {
    throw new StrictDBError({
      code: 'QUERY_ERROR',
      message: `Regex pattern "${pattern}" has nested quantifiers that could cause catastrophic backtracking.`,
      fix: `Simplify the regex pattern. Avoid nested quantifiers like (a+)+ or (a*)*. Use atomic groups or possessive quantifiers if available.`,
      backend: 'elastic',
    });
  }

  // Check for excessive length
  if (pattern.length > 1000) {
    throw new StrictDBError({
      code: 'QUERY_ERROR',
      message: `Regex pattern is too long (${pattern.length} chars, max 1000).`,
      fix: `Shorten the regex pattern or use a different query approach.`,
      backend: 'elastic',
    });
  }
}

// ─── Generic Sanitize Entrypoint ─────────────────────────────────────────────

/**
 * Run backend-specific sanitization on a filter.
 * MongoDB: No-op (handled internally by core/db/mongo.ts)
 * SQL: Validates field names against registered schema
 * Elasticsearch: Validates field names + blocks internal fields
 */
export function sanitizeFilter(
  collection: string,
  filter: Record<string, unknown>,
  backend: Backend,
): void {
  switch (backend) {
    case 'mongo':
      // MongoDB sanitization is handled internally by core/db/mongo.ts
      break;
    case 'sql':
      validateFilterFields(collection, filter, 'sql');
      break;
    case 'elastic':
      validateElasticFields(collection, filter);
      break;
  }
}

// ─── Custom Sanitize Rules ───────────────────────────────────────────────────

/**
 * Apply user-defined sanitize rules to a data object.
 * Returns a new object (never mutates input). Short-circuits if rules is empty.
 */
export function applySanitizeRules(
  data: Record<string, unknown>,
  collection: string,
  rules: SanitizeRule[],
): Record<string, unknown> {
  if (rules.length === 0) return data;

  const result = { ...data };

  for (const rule of rules) {
    if (rule.field === undefined || rule.field === '*') {
      // Apply to every field
      for (const key of Object.keys(result)) {
        result[key] = rule.transform(result[key], key, collection);
      }
    } else if (typeof rule.field === 'string') {
      // Apply to a single named field
      if (rule.field in result) {
        result[rule.field] = rule.transform(result[rule.field], rule.field, collection);
      }
    } else if (Array.isArray(rule.field)) {
      // Apply to each named field
      for (const fieldName of rule.field) {
        if (fieldName in result) {
          result[fieldName] = rule.transform(result[fieldName], fieldName, collection);
        }
      }
    }
  }

  return result;
}
