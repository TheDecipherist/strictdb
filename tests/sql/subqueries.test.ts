import { describe, it, expect, beforeEach } from 'vitest';
import { extractSubqueryDeps, resetDepCounter } from '../../src/sql/translators/subqueries.js';

/**
 * SQL Mode 2 — Subquery Tests
 *
 * Tests extractSubqueryDeps() directly with mock AST WHERE nodes.
 * No database connections. Tests IN, NOT IN, and EXISTS patterns.
 */

// Minimal subquery AST that mimics node-sql-parser output
function makeSubqueryAst(table: string): Record<string, unknown> {
  return {
    type: 'select',
    columns: [{ expr: { type: 'column_ref', column: 'id' }, as: null }],
    from: [{ table, as: null }],
    where: null,
    groupby: null,
    orderby: null,
    limit: null,
  };
}

// Build an IN/NOT IN binary_expr WHERE node
function makeInNode(
  leftCol: string,
  operator: 'IN' | 'NOT IN',
  subAst: Record<string, unknown>,
): Record<string, unknown> {
  return {
    type: 'binary_expr',
    operator,
    left: { type: 'column_ref', table: null, column: leftCol },
    right: subAst,
  };
}

// Build an EXISTS unary_expr WHERE node
function makeExistsNode(subAst: Record<string, unknown>): Record<string, unknown> {
  return {
    type: 'unary_expr',
    operator: 'EXISTS',
    expr: subAst,
  };
}

describe('SQL Mode 2 — Subqueries', () => {
  beforeEach(() => {
    resetDepCounter();
  });

  describe('IN (SELECT ...)', () => {
    it('should mark subquery as Phase 2 dependency with injectAs: "in"', () => {
      const subAst = makeSubqueryAst('orders');
      const whereNode = makeInNode('user_id', 'IN', subAst);

      const { deps } = extractSubqueryDeps(whereNode);

      expect(deps.length).toBe(1);
      expect(deps[0]?.type).toBe('subquery');
      expect(deps[0]?.injectAs).toBe('in');
      expect(deps[0]?.collection).toBe('orders');
    });

    it('should set targetField to the left-side column name', () => {
      const subAst = makeSubqueryAst('orders');
      const whereNode = makeInNode('user_id', 'IN', subAst);

      const { deps } = extractSubqueryDeps(whereNode);

      expect(deps[0]?.targetField).toBe('user_id');
    });

    it('should assign a unique dep id to each subquery', () => {
      const subAst1 = makeSubqueryAst('orders');
      const subAst2 = makeSubqueryAst('reviews');
      const andNode: Record<string, unknown> = {
        type: 'binary_expr',
        operator: 'AND',
        left: makeInNode('user_id', 'IN', subAst1),
        right: makeInNode('product_id', 'IN', subAst2),
      };

      const { deps } = extractSubqueryDeps(andNode);

      expect(deps.length).toBe(2);
      expect(deps[0]?.id).not.toBe(deps[1]?.id);
    });

    it('should include a pipeline on the dependency', () => {
      const subAst = makeSubqueryAst('orders');
      const whereNode = makeInNode('user_id', 'IN', subAst);

      const { deps } = extractSubqueryDeps(whereNode);

      expect(Array.isArray(deps[0]?.pipeline)).toBe(true);
    });

    it('should return a modified WHERE with a _depPlaceholder', () => {
      const subAst = makeSubqueryAst('orders');
      const whereNode = makeInNode('user_id', 'IN', subAst);

      const { modifiedWhere } = extractSubqueryDeps(whereNode);

      const modified = modifiedWhere as Record<string, unknown>;
      expect(modified['_depPlaceholder']).toBeDefined();
      expect(modified['op']).toBe('$in');
    });
  });

  describe('NOT IN (SELECT ...)', () => {
    it('should inject resolved values as $nin with injectAs: "nin"', () => {
      const subAst = makeSubqueryAst('banned_users');
      const whereNode = makeInNode('user_id', 'NOT IN', subAst);

      const { deps } = extractSubqueryDeps(whereNode);

      expect(deps.length).toBe(1);
      expect(deps[0]?.injectAs).toBe('nin');
    });

    it('should set correct op in the modified WHERE placeholder for NOT IN', () => {
      const subAst = makeSubqueryAst('banned_users');
      const whereNode = makeInNode('user_id', 'NOT IN', subAst);

      const { modifiedWhere } = extractSubqueryDeps(whereNode);

      const modified = modifiedWhere as Record<string, unknown>;
      expect(modified['op']).toBe('$nin');
    });
  });

  describe('EXISTS (SELECT ...)', () => {
    it('should mark EXISTS subquery as Phase 2 dependency with injectAs: "exists"', () => {
      const subAst = makeSubqueryAst('subscriptions');
      const whereNode = makeExistsNode(subAst);

      const { deps } = extractSubqueryDeps(whereNode);

      expect(deps.length).toBe(1);
      expect(deps[0]?.type).toBe('subquery');
      expect(deps[0]?.injectAs).toBe('exists');
    });

    it('should set op to "exists" in the modified WHERE placeholder', () => {
      const subAst = makeSubqueryAst('subscriptions');
      const whereNode = makeExistsNode(subAst);

      const { modifiedWhere } = extractSubqueryDeps(whereNode);

      const modified = modifiedWhere as Record<string, unknown>;
      expect(modified['op']).toBe('exists');
    });

    it('should not set targetField for EXISTS (no left column)', () => {
      const subAst = makeSubqueryAst('subscriptions');
      const whereNode = makeExistsNode(subAst);

      const { deps } = extractSubqueryDeps(whereNode);

      // EXISTS has no target field
      expect(deps[0]?.targetField).toBeUndefined();
    });
  });

  describe('null / undefined WHERE', () => {
    it('should return empty deps for null WHERE', () => {
      const { deps, modifiedWhere } = extractSubqueryDeps(null);
      expect(deps).toEqual([]);
      expect(modifiedWhere).toBeNull();
    });

    it('should return empty deps for undefined WHERE', () => {
      const { deps } = extractSubqueryDeps(undefined);
      expect(deps).toEqual([]);
    });
  });

  describe('scalar subquery (WHERE field > (SELECT AGG(...)))', () => {
    it('should detect scalar subquery on right side of > comparison', () => {
      const subAst = makeSubqueryAst('orders');
      const whereNode: Record<string, unknown> = {
        type: 'binary_expr',
        operator: '>',
        left: { type: 'column_ref', table: null, column: 'age' },
        right: { type: 'expr_list', value: [{ ast: subAst }] },
      };

      const { deps } = extractSubqueryDeps(whereNode);
      expect(deps.length).toBe(1);
      expect(deps[0]?.injectAs).toBe('scalar');
      expect(deps[0]?.targetField).toBe('age');
    });

    it('should detect scalar subquery for < operator', () => {
      const subAst = makeSubqueryAst('products');
      const whereNode: Record<string, unknown> = {
        type: 'binary_expr',
        operator: '<',
        left: { type: 'column_ref', table: null, column: 'price' },
        right: { type: 'expr_list', value: [{ ast: subAst }] },
      };

      const { deps } = extractSubqueryDeps(whereNode);
      expect(deps.length).toBe(1);
      expect(deps[0]?.injectAs).toBe('scalar');
    });

    it('should detect scalar subquery for = operator', () => {
      const subAst = makeSubqueryAst('settings');
      const whereNode: Record<string, unknown> = {
        type: 'binary_expr',
        operator: '=',
        left: { type: 'column_ref', table: null, column: 'threshold' },
        right: { type: 'expr_list', value: [{ ast: subAst }] },
      };

      const { deps } = extractSubqueryDeps(whereNode);
      expect(deps.length).toBe(1);
      expect(deps[0]?.injectAs).toBe('scalar');
    });

    it('should set scalarOp: true in the modified WHERE placeholder', () => {
      const subAst = makeSubqueryAst('orders');
      const whereNode: Record<string, unknown> = {
        type: 'binary_expr',
        operator: '>=',
        left: { type: 'column_ref', table: null, column: 'score' },
        right: { type: 'expr_list', value: [{ ast: subAst }] },
      };

      const { modifiedWhere } = extractSubqueryDeps(whereNode);
      const modified = modifiedWhere as Record<string, unknown>;
      expect(modified['scalarOp']).toBe(true);
    });

    it('should NOT treat a plain value comparison as scalar subquery', () => {
      const whereNode: Record<string, unknown> = {
        type: 'binary_expr',
        operator: '>',
        left: { type: 'column_ref', table: null, column: 'age' },
        right: { type: 'number', value: 25 },
      };

      const { deps } = extractSubqueryDeps(whereNode);
      expect(deps).toEqual([]);
    });
  });

  describe('plain WHERE (no subquery)', () => {
    it('should return no deps for a plain comparison node', () => {
      const plainWhere: Record<string, unknown> = {
        type: 'binary_expr',
        operator: '=',
        left: { type: 'column_ref', column: 'status' },
        right: { type: 'single_quote_string', value: 'active' },
      };

      const { deps } = extractSubqueryDeps(plainWhere);
      expect(deps).toEqual([]);
    });
  });
});
