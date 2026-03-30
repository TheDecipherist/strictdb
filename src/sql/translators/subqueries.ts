/**
 * SQL Mode 2 — Subquery Translator
 *
 * IN (SELECT ...) → Phase 2 dependency, inject as $in
 * NOT IN (SELECT ...) → Phase 2 dependency, inject as $nin
 * EXISTS (SELECT ...) → Phase 2 dependency, boolean check
 * NOT EXISTS (SELECT ...) → Phase 2 dependency, inverted boolean check
 */

import type { Dependency } from '../types.js';
import { buildSelectPipeline, extractCollection, translateWhere } from './select.js';
import { hasAggregates, extractAggregateFields, buildGroupStage } from './aggregates.js';

/**
 * Build a complete pipeline for a subquery AST, including aggregate support.
 * Unlike buildSelectPipeline (which is simplified), this handles $group for
 * aggregate subqueries like SELECT AVG(age) FROM users.
 */
function buildSubqueryPipeline(ast: Record<string, unknown>): Record<string, unknown>[] {
  const columns = ast['columns'];
  const where = ast['where'];

  // Check if this is an aggregate subquery (SELECT AVG/COUNT/SUM/etc.)
  if (hasAggregates(columns)) {
    const stages: Record<string, unknown>[] = [];

    // WHERE → $match
    if (where) {
      const match = translateWhere(where);
      if (Object.keys(match).length > 0) {
        stages.push({ $match: match });
      }
    }

    // Build $group
    const aggFields = extractAggregateFields(columns);
    const tableAliases = new Map<string, string>();
    const groupResult = buildGroupStage(null, aggFields, columns, tableAliases);
    stages.push(groupResult.groupStage);

    return stages;
  }

  // Non-aggregate: use the standard pipeline builder
  return buildSelectPipeline(ast);
}

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
      const subPipeline = buildSubqueryPipeline(subAst);

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

  // Check for scalar subquery on right side of comparison (>, <, >=, <=, =, !=)
  if (type === 'binary_expr' && ['>', '<', '>=', '<=', '=', '!=', '<>'].includes(operator)) {
    const right = node['right'] as Record<string, unknown>;
    // Unwrap expr_list wrapper
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
      const subPipeline = buildSubqueryPipeline(subAst);

      const depId = `dep_${++_testDepCounter}`;
      const leftField = (node['left'] as Record<string, unknown>)?.['column'] as string;

      // Map SQL operator to MongoDB operator
      const opMap: Record<string, string> = {
        '>': '$gt', '<': '$lt', '>=': '$gte', '<=': '$lte',
        '=': '$eq', '!=': '$ne', '<>': '$ne',
      };

      deps.push({
        id: depId,
        type: 'subquery',
        collection: subCollection,
        pipeline: subPipeline,
        injectAs: 'scalar',
        targetField: leftField,
      });

      return {
        _depPlaceholder: depId,
        field: leftField,
        op: opMap[operator] ?? '$gt',
        scalarOp: true,
      };
    }
  }

  // Check for EXISTS
  if (type === 'unary_expr' && operator === 'EXISTS') {
    const expr = node['expr'] as Record<string, unknown>;
    if (expr?.['type'] === 'select' || expr?.['ast'] !== undefined) {
      const subAst = (expr['ast'] ?? expr) as Record<string, unknown>;
      const subCollection = extractCollection(subAst);
      const subPipeline = buildSubqueryPipeline(subAst);

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

  // Check for NOT EXISTS — parser may emit as NOT wrapping EXISTS
  if (type === 'unary_expr' && operator === 'NOT') {
    const inner = node['expr'] as Record<string, unknown>;
    const innerOp = (inner?.['operator'] as string || '').toUpperCase();
    if (inner?.['type'] === 'unary_expr' && innerOp === 'EXISTS') {
      const innerExpr = inner['expr'] as Record<string, unknown>;
      if (innerExpr?.['type'] === 'select' || innerExpr?.['ast'] !== undefined) {
        const subAst = (innerExpr['ast'] ?? innerExpr) as Record<string, unknown>;
        const subCollection = extractCollection(subAst);
        const subPipeline = buildSubqueryPipeline(subAst);

        const depId = `dep_${++_testDepCounter}`;
        deps.push({
          id: depId,
          type: 'subquery',
          collection: subCollection,
          pipeline: subPipeline,
          injectAs: 'not-exists',
        });

        return { _depPlaceholder: depId, op: 'not-exists' };
      }
    }
  }

  // Check for NOT EXISTS — parser may emit as a single operator
  if (type === 'unary_expr' && operator === 'NOT EXISTS') {
    const expr = node['expr'] as Record<string, unknown>;
    if (expr?.['type'] === 'select' || expr?.['ast'] !== undefined) {
      const subAst = (expr['ast'] ?? expr) as Record<string, unknown>;
      const subCollection = extractCollection(subAst);
      const subPipeline = buildSubqueryPipeline(subAst);

      const depId = `dep_${++_testDepCounter}`;
      deps.push({
        id: depId,
        type: 'subquery',
        collection: subCollection,
        pipeline: subPipeline,
        injectAs: 'not-exists',
      });

      return { _depPlaceholder: depId, op: 'not-exists' };
    }
  }

  // Recurse
  const result: Record<string, unknown> = { ...node };
  if (node['left']) result['left'] = walkAndExtract(node['left'] as Record<string, unknown>, deps);
  if (node['right']) result['right'] = walkAndExtract(node['right'] as Record<string, unknown>, deps);
  if (node['expr']) result['expr'] = walkAndExtract(node['expr'] as Record<string, unknown>, deps);

  return result;
}

