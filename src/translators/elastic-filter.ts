/**
 * Elasticsearch Filter Translation — MongoDB-style filters → Elasticsearch Query DSL
 */

import type { UpdateOperators } from '../types.js';
import { StrictDBError } from '../errors.js';

// ─── Elasticsearch Filter Translation ────────────────────────────────────────

/**
 * Translate a MongoDB-style filter to Elasticsearch Query DSL.
 */
export function translateToElastic(filter: Record<string, unknown>): Record<string, unknown> {
  if (!filter || Object.keys(filter).length === 0) {
    return { match_all: {} };
  }

  const must: Record<string, unknown>[] = [];

  for (const [key, value] of Object.entries(filter)) {
    // Logical operators
    if (key === '$and') {
      const filters = value as Record<string, unknown>[];
      const clauses = filters.map(f => translateToElastic(f));
      must.push({ bool: { must: clauses } });
      continue;
    }
    if (key === '$or') {
      const filters = value as Record<string, unknown>[];
      const clauses = filters.map(f => translateToElastic(f));
      must.push({ bool: { should: clauses, minimum_should_match: 1 } });
      continue;
    }
    if (key === '$nor') {
      const filters = value as Record<string, unknown>[];
      const clauses = filters.map(f => translateToElastic(f));
      must.push({ bool: { must_not: clauses } });
      continue;
    }

    if (key.startsWith('$')) {
      throw new StrictDBError({
        code: 'UNKNOWN_OPERATOR',
        message: `Top-level operator "${key}" is not supported in filter.`,
        fix: `Supported top-level operators: $and, $or, $nor. Field operators must be nested: { fieldName: { ${key}: value } }.`,
        backend: 'elastic',
      });
    }

    // Field-level
    if (value === null || value === undefined) {
      must.push({ bool: { must_not: { exists: { field: key } } } });
      continue;
    }

    if (typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date) && !(value instanceof RegExp)) {
      const ops = value as Record<string, unknown>;
      const fieldClauses = translateFieldOpsToElastic(key, ops);
      must.push(...fieldClauses);
      continue;
    }

    // Direct equality
    must.push({ term: { [key]: value } });
  }

  if (must.length === 0) return { match_all: {} };
  if (must.length === 1) return must[0]!;
  return { bool: { must } };
}

function translateFieldOpsToElastic(field: string, ops: Record<string, unknown>): Record<string, unknown>[] {
  const clauses: Record<string, unknown>[] = [];

  // Collect range operators into a single range query
  const rangeOps: Record<string, unknown> = {};
  let hasRange = false;

  for (const [op, value] of Object.entries(ops)) {
    switch (op) {
      case '$eq':
        if (value === null) {
          clauses.push({ bool: { must_not: { exists: { field } } } });
        } else {
          clauses.push({ term: { [field]: value } });
        }
        break;

      case '$ne':
        if (value === null) {
          clauses.push({ exists: { field } });
        } else {
          clauses.push({ bool: { must_not: { term: { [field]: value } } } });
        }
        break;

      case '$gt':
        rangeOps['gt'] = value;
        hasRange = true;
        break;

      case '$gte':
        rangeOps['gte'] = value;
        hasRange = true;
        break;

      case '$lt':
        rangeOps['lt'] = value;
        hasRange = true;
        break;

      case '$lte':
        rangeOps['lte'] = value;
        hasRange = true;
        break;

      case '$in':
        clauses.push({ terms: { [field]: value } });
        break;

      case '$nin':
        clauses.push({ bool: { must_not: { terms: { [field]: value } } } });
        break;

      case '$exists':
        if (value) {
          clauses.push({ exists: { field } });
        } else {
          clauses.push({ bool: { must_not: { exists: { field } } } });
        }
        break;

      case '$regex': {
        const pattern = value instanceof RegExp ? value.source : String(value);
        clauses.push({ regexp: { [field]: pattern } });
        break;
      }

      case '$options':
        // Handled as part of $regex — skip standalone
        break;

      case '$not': {
        const sub = value as Record<string, unknown>;
        const subClauses = translateFieldOpsToElastic(field, sub);
        clauses.push({ bool: { must_not: subClauses } });
        break;
      }

      case '$size':
        // ES doesn't have a direct array length query — use script
        clauses.push({
          script: {
            script: {
              source: `doc['${field}'].size() == params.size`,
              params: { size: value },
            },
          },
        });
        break;

      default:
        throw new StrictDBError({
          code: 'UNKNOWN_OPERATOR',
          message: `Unknown filter operator "${op}".`,
          fix: `Supported operators: $eq, $ne, $gt, $gte, $lt, $lte, $in, $nin, $exists, $regex, $not, $size.`,
          backend: 'elastic',
        });
    }
  }

  if (hasRange) {
    clauses.push({ range: { [field]: rangeOps } });
  }

  return clauses;
}

// ─── Elasticsearch Sort Translation ──────────────────────────────────────────

export function translateSortToElastic(sort: Record<string, unknown>): Array<Record<string, unknown>> {
  const result: Array<Record<string, unknown>> = [];
  for (const [field, dir] of Object.entries(sort)) {
    const order = dir === -1 || dir === 'desc' ? 'desc' : 'asc';
    result.push({ [field]: { order } });
  }
  return result;
}

// ─── Elasticsearch Update Translation (Painless Script) ─────────────────────

export interface PainlessScript {
  source: string;
  params: Record<string, unknown>;
}

export function translateUpdateToElastic(
  update: UpdateOperators<Record<string, unknown>>,
): PainlessScript {
  const scriptParts: string[] = [];
  const params: Record<string, unknown> = {};

  // $set → ctx._source.field = params.field
  if (update.$set) {
    for (const [field, value] of Object.entries(update.$set)) {
      const paramName = `set_${field}`;
      scriptParts.push(`ctx._source.${field} = params.${paramName}`);
      params[paramName] = value;
    }
  }

  // $inc → ctx._source.field += params.field
  if (update.$inc) {
    for (const [field, amount] of Object.entries(update.$inc)) {
      const paramName = `inc_${field}`;
      scriptParts.push(`ctx._source.${field} += params.${paramName}`);
      params[paramName] = amount;
    }
  }

  // $unset → ctx._source.remove('field')
  if (update.$unset) {
    for (const field of Object.keys(update.$unset)) {
      scriptParts.push(`ctx._source.remove('${field}')`);
    }
  }

  // $push → ctx._source.field.add(params.field)
  if (update.$push) {
    for (const [field, value] of Object.entries(update.$push)) {
      const paramName = `push_${field}`;
      scriptParts.push(`if (ctx._source.${field} == null) { ctx._source.${field} = [] } ctx._source.${field}.add(params.${paramName})`);
      params[paramName] = value;
    }
  }

  // $pull → ctx._source.field.removeIf(item -> item == params.field)
  if (update.$pull) {
    for (const [field, value] of Object.entries(update.$pull)) {
      const paramName = `pull_${field}`;
      scriptParts.push(`if (ctx._source.${field} != null) { ctx._source.${field}.removeIf(item -> item == params.${paramName}) }`);
      params[paramName] = value;
    }
  }

  if (scriptParts.length === 0) {
    throw new StrictDBError({
      code: 'QUERY_ERROR',
      message: 'Update operation has no operations.',
      fix: 'Provide at least one update operator: $set, $inc, $unset, $push, or $pull.',
      backend: 'elastic',
    });
  }

  return {
    source: scriptParts.join('; '),
    params,
  };
}
