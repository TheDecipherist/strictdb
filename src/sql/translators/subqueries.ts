/**
 * SQL Mode 2 — Subquery Translator
 *
 * IN (SELECT ...) → Phase 2 dependency, inject as $in
 * NOT IN (SELECT ...) → Phase 2 dependency, inject as $nin
 * EXISTS (SELECT ...) → Phase 2 dependency, boolean check
 */

import type { Dependency } from '../types.js';
import { buildSelectPipeline, extractCollection } from './select.js';

// Counter scoped per extractSubqueryDeps call (not module-level)
// resetDepCounter kept for test compatibility
let _testDepCounter = 0;
export function resetDepCounter(): void {
  _testDepCounter = 0;
}

/**
 * Extract subquery dependencies from a WHERE clause AST.
 * Returns dependencies and a modified WHERE with placeholders.
 */
export function extractSubqueryDeps(where: unknown): { deps: Dependency[]; modifiedWhere: unknown } {
  if (!where) return { deps: [], modifiedWhere: where };

  const deps: Dependency[] = [];
  _testDepCounter = 0; // Reset per call — safe for concurrent use
  const modified = walkAndExtract(where as Record<string, unknown>, deps);
  return { deps, modifiedWhere: modified };
}

function walkAndExtract(node: Record<string, unknown>, deps: Dependency[]): Record<string, unknown> {
  if (!node || typeof node !== 'object') return node;

  const type = node['type'] as string;
  const operator = (node['operator'] as string || '').toUpperCase();

  // Check for IN/NOT IN with subquery
  if (type === 'binary_expr' && (operator === 'IN' || operator === 'NOT IN')) {
    const right = node['right'] as Record<string, unknown>;
    // Unwrap: node-sql-parser wraps subqueries in expr_list: { type: 'expr_list', value: [{ ast: {...} }] }
    let subNode = right;
    if (right?.['type'] === 'expr_list') {
      const values = right['value'] as Array<Record<string, unknown>> | undefined;
      if (values?.length === 1 && values[0]!['ast']) {
        subNode = values[0]!;
      }
    }
    if (subNode?.['type'] === 'select' || subNode?.['ast'] !== undefined) {
      const subAst = (subNode['ast'] ?? subNode) as Record<string, unknown>;
      const subCollection = extractCollection(subAst);
      const subPipeline = buildSelectPipeline(subAst);

      const depId = `dep_${++_testDepCounter}`;
      const leftField = (node['left'] as Record<string, unknown>)?.['column'] as string;

      deps.push({
        id: depId,
        type: 'subquery',
        collection: subCollection,
        pipeline: subPipeline,
        injectAs: operator === 'IN' ? 'in' : 'nin',
        targetField: leftField,
      });

      // Return a placeholder that will be replaced after dep resolution
      return { _depPlaceholder: depId, field: leftField, op: operator === 'IN' ? '$in' : '$nin' };
    }
  }

  // Check for EXISTS
  if (type === 'unary_expr' && operator === 'EXISTS') {
    const expr = node['expr'] as Record<string, unknown>;
    if (expr?.['type'] === 'select' || expr?.['ast'] !== undefined) {
      const subAst = (expr['ast'] ?? expr) as Record<string, unknown>;
      const subCollection = extractCollection(subAst);
      const subPipeline = buildSelectPipeline(subAst);

      const depId = `dep_${++_testDepCounter}`;
      deps.push({
        id: depId,
        type: 'subquery',
        collection: subCollection,
        pipeline: subPipeline,
        injectAs: 'exists',
      });

      return { _depPlaceholder: depId, op: 'exists' };
    }
  }

  // Recurse
  const result: Record<string, unknown> = { ...node };
  if (node['left']) result['left'] = walkAndExtract(node['left'] as Record<string, unknown>, deps);
  if (node['right']) result['right'] = walkAndExtract(node['right'] as Record<string, unknown>, deps);
  if (node['expr']) result['expr'] = walkAndExtract(node['expr'] as Record<string, unknown>, deps);

  return result;
}

/**
 * Inject resolved dependency results into a filter.
 */
export function injectDependencyResults(
  filter: Record<string, unknown>,
  results: Map<string, unknown[]>,
): Record<string, unknown> {
  return walkAndInject(filter, results);
}

function walkAndInject(obj: Record<string, unknown>, results: Map<string, unknown[]>): Record<string, unknown> {
  if (!obj || typeof obj !== 'object') return obj;

  // Check for placeholder
  if (obj['_depPlaceholder']) {
    const depId = obj['_depPlaceholder'] as string;
    const field = obj['field'] as string;
    const op = obj['op'] as string;
    const resolved = results.get(depId) ?? [];

    if (op === 'exists') {
      // EXISTS: if results found, condition is true
      return resolved.length > 0 ? {} : { _impossible: { $exists: false } };
    }

    // IN / NOT IN
    return { [field]: { [op]: resolved } };
  }

  // Recurse into arrays and objects
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (Array.isArray(value)) {
      result[key] = value.map(v =>
        typeof v === 'object' && v !== null ? walkAndInject(v as Record<string, unknown>, results) : v,
      );
    } else if (typeof value === 'object' && value !== null) {
      result[key] = walkAndInject(value as Record<string, unknown>, results);
    } else {
      result[key] = value;
    }
  }
  return result;
}
