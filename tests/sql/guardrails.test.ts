import { describe, it, expect } from 'vitest';
import { parseSql } from '../../src/sql/parser.js';
import { buildExecutionPlan } from '../../src/sql/planner.js';
import { checkSqlGuardrails, checkNullComparisons } from '../../src/sql/guardrails.js';
import { StrictDBError } from '../../src/errors.js';

/**
 * SQL Mode 2 — SQL-Specific Guardrail Tests
 *
 * Verifies: DELETE without WHERE blocked, SELECT without LIMIT blocked,
 * UPDATE without WHERE blocked, = NULL blocked, safe variants pass through.
 */

describe('SQL Mode 2 — Guardrails', () => {
  describe('DELETE without WHERE', () => {
    it('should throw GUARDRAIL_BLOCKED for DELETE FROM users (no WHERE)', () => {
      const sql = 'DELETE FROM users';
      const ast = parseSql(sql);
      expect(() => buildExecutionPlan(ast, sql)).toThrow(StrictDBError);
    });

    it('should include GUARDRAIL_BLOCKED error code', () => {
      const sql = 'DELETE FROM users';
      const ast = parseSql(sql);
      let caught: unknown;
      try {
        buildExecutionPlan(ast, sql);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(StrictDBError);
      expect((caught as StrictDBError).code).toBe('GUARDRAIL_BLOCKED');
    });

    it('should include fix suggesting WHERE clause in .fix', () => {
      const sql = 'DELETE FROM users';
      const ast = parseSql(sql);
      let caught: unknown;
      try {
        buildExecutionPlan(ast, sql);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(StrictDBError);
      const err = caught as StrictDBError;
      expect(err.fix).toContain('WHERE');
    });

    it('should include original SQL in error .sql field', () => {
      const sql = 'DELETE FROM users';
      const ast = parseSql(sql);
      let caught: unknown;
      try {
        buildExecutionPlan(ast, sql);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(StrictDBError);
      expect((caught as unknown as Record<string, unknown>)['sql']).toBe(sql);
    });

    it('should include the table name in the error message', () => {
      const sql = 'DELETE FROM orders';
      const ast = parseSql(sql);
      let caught: unknown;
      try {
        buildExecutionPlan(ast, sql);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(StrictDBError);
      expect((caught as StrictDBError).message).toContain('orders');
    });

    it('should allow DELETE with WHERE clause — no throw', () => {
      const sql = "DELETE FROM users WHERE id = '123'";
      const ast = parseSql(sql);
      expect(() => buildExecutionPlan(ast, sql)).not.toThrow();
    });

    it('should allow DELETE with a complex WHERE condition', () => {
      const sql = "DELETE FROM sessions WHERE status = 'expired' AND created_at < '2024-01-01'";
      const ast = parseSql(sql);
      expect(() => buildExecutionPlan(ast, sql)).not.toThrow();
    });
  });

  describe('SELECT without LIMIT', () => {
    it('should throw GUARDRAIL_BLOCKED for SELECT * FROM users (no LIMIT)', () => {
      const sql = 'SELECT * FROM users';
      const ast = parseSql(sql);
      expect(() => buildExecutionPlan(ast, sql)).toThrow(StrictDBError);
    });

    it('should include GUARDRAIL_BLOCKED error code for unbounded SELECT', () => {
      const sql = 'SELECT * FROM users';
      const ast = parseSql(sql);
      let caught: unknown;
      try {
        buildExecutionPlan(ast, sql);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(StrictDBError);
      expect((caught as StrictDBError).code).toBe('GUARDRAIL_BLOCKED');
    });

    it('should include fix suggesting LIMIT clause in .fix', () => {
      const sql = 'SELECT * FROM users';
      const ast = parseSql(sql);
      let caught: unknown;
      try {
        buildExecutionPlan(ast, sql);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(StrictDBError);
      expect((caught as StrictDBError).fix).toContain('LIMIT');
    });

    it('should allow SELECT with LIMIT — no throw', () => {
      const sql = 'SELECT * FROM users LIMIT 100';
      const ast = parseSql(sql);
      expect(() => buildExecutionPlan(ast, sql)).not.toThrow();
    });

    it('should allow SELECT with LIMIT 1', () => {
      const sql = 'SELECT * FROM products LIMIT 1';
      const ast = parseSql(sql);
      expect(() => buildExecutionPlan(ast, sql)).not.toThrow();
    });

    it('should allow COUNT(*) without LIMIT — aggregate queries are exempt', () => {
      const sql = 'SELECT COUNT(*) FROM users';
      const ast = parseSql(sql);
      expect(() => buildExecutionPlan(ast, sql)).not.toThrow();
    });

    it('should allow SUM aggregate without LIMIT', () => {
      const sql = 'SELECT SUM(amount) FROM orders';
      const ast = parseSql(sql);
      expect(() => buildExecutionPlan(ast, sql)).not.toThrow();
    });

    it('should allow AVG aggregate without LIMIT', () => {
      const sql = 'SELECT AVG(score) FROM results';
      const ast = parseSql(sql);
      expect(() => buildExecutionPlan(ast, sql)).not.toThrow();
    });
  });

  describe('UPDATE without WHERE', () => {
    it("should throw GUARDRAIL_BLOCKED for UPDATE users SET status = 'active' (no WHERE)", () => {
      const sql = "UPDATE users SET status = 'active'";
      const ast = parseSql(sql);
      expect(() => buildExecutionPlan(ast, sql)).toThrow(StrictDBError);
    });

    it('should include GUARDRAIL_BLOCKED error code for unbounded UPDATE', () => {
      const sql = "UPDATE users SET status = 'inactive'";
      const ast = parseSql(sql);
      let caught: unknown;
      try {
        buildExecutionPlan(ast, sql);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(StrictDBError);
      expect((caught as StrictDBError).code).toBe('GUARDRAIL_BLOCKED');
    });

    it('should include fix suggesting WHERE clause for unbounded UPDATE', () => {
      const sql = "UPDATE users SET score = 0";
      const ast = parseSql(sql);
      let caught: unknown;
      try {
        buildExecutionPlan(ast, sql);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(StrictDBError);
      expect((caught as StrictDBError).fix).toContain('WHERE');
    });

    it('should allow UPDATE with WHERE clause — no throw', () => {
      const sql = "UPDATE users SET status = 'active' WHERE id = '123'";
      const ast = parseSql(sql);
      expect(() => buildExecutionPlan(ast, sql)).not.toThrow();
    });
  });

  describe('NULL comparison (= NULL / != NULL)', () => {
    it('should throw SQL_NULL_COMPARISON for WHERE field = NULL', () => {
      const sql = 'SELECT * FROM users WHERE deleted_at = NULL LIMIT 10';
      const ast = parseSql(sql);
      expect(() => buildExecutionPlan(ast, sql)).toThrow(StrictDBError);
    });

    it('should have SQL_NULL_COMPARISON error code for = NULL', () => {
      const sql = 'SELECT * FROM users WHERE deleted_at = NULL LIMIT 10';
      const ast = parseSql(sql);
      let caught: unknown;
      try {
        buildExecutionPlan(ast, sql);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(StrictDBError);
      expect((caught as StrictDBError).code).toBe('SQL_NULL_COMPARISON');
    });

    it('should throw SQL_NULL_COMPARISON for WHERE field != NULL', () => {
      const sql = 'SELECT * FROM users WHERE status != NULL LIMIT 10';
      const ast = parseSql(sql);
      expect(() => buildExecutionPlan(ast, sql)).toThrow(StrictDBError);
    });

    it('should have SQL_NULL_COMPARISON error code for != NULL', () => {
      const sql = 'SELECT * FROM users WHERE status != NULL LIMIT 10';
      const ast = parseSql(sql);
      let caught: unknown;
      try {
        buildExecutionPlan(ast, sql);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(StrictDBError);
      expect((caught as StrictDBError).code).toBe('SQL_NULL_COMPARISON');
    });

    it('should include fix suggesting IS NULL / IS NOT NULL', () => {
      const sql = 'SELECT * FROM users WHERE deleted_at = NULL LIMIT 10';
      const ast = parseSql(sql);
      let caught: unknown;
      try {
        buildExecutionPlan(ast, sql);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(StrictDBError);
      const fix = (caught as StrictDBError).fix;
      expect(fix).toContain('IS NULL');
    });

    it('should include original SQL in .sql field for null comparison error', () => {
      const sql = 'SELECT * FROM users WHERE deleted_at = NULL LIMIT 10';
      const ast = parseSql(sql);
      let caught: unknown;
      try {
        buildExecutionPlan(ast, sql);
      } catch (e) {
        caught = e;
      }
      expect((caught as unknown as Record<string, unknown>)['sql']).toBe(sql);
    });

    it('should allow WHERE field IS NULL — no throw', () => {
      const sql = 'SELECT * FROM users WHERE deleted_at IS NULL LIMIT 10';
      const ast = parseSql(sql);
      expect(() => buildExecutionPlan(ast, sql)).not.toThrow();
    });

    it('should allow WHERE field IS NOT NULL — no throw', () => {
      const sql = 'SELECT * FROM users WHERE deleted_at IS NOT NULL LIMIT 10';
      const ast = parseSql(sql);
      expect(() => buildExecutionPlan(ast, sql)).not.toThrow();
    });

    it('should not throw for valid equality comparison (not NULL)', () => {
      const sql = "SELECT * FROM users WHERE status = 'active' LIMIT 10";
      const ast = parseSql(sql);
      expect(() => buildExecutionPlan(ast, sql)).not.toThrow();
    });
  });

  describe('checkSqlGuardrails direct', () => {
    it('should not throw for a valid SELECT AST with limit', () => {
      const ast = {
        type: 'select',
        where: null,
        limit: { value: [{ type: 'number', value: 10 }] },
        from: [{ table: 'users' }],
        columns: '*',
      };
      expect(() => checkSqlGuardrails(ast, 'SELECT * FROM users LIMIT 10')).not.toThrow();
    });

    it('should throw for a DELETE AST with no where', () => {
      const ast = {
        type: 'delete',
        where: null,
        table: [{ table: 'users' }],
      };
      expect(() => checkSqlGuardrails(ast, 'DELETE FROM users')).toThrow(StrictDBError);
    });
  });

  describe('checkNullComparisons direct', () => {
    it('should throw for an = NULL binary expression node', () => {
      const whereNode = {
        type: 'binary_expr',
        operator: '=',
        left: { type: 'column_ref', column: 'deleted_at' },
        right: { type: 'null', value: null },
      };
      expect(() =>
        checkNullComparisons(whereNode, 'SELECT * FROM users WHERE deleted_at = NULL LIMIT 1'),
      ).toThrow(StrictDBError);
    });

    it('should not throw for an IS NULL binary expression node', () => {
      const whereNode = {
        type: 'binary_expr',
        operator: 'IS',
        left: { type: 'column_ref', column: 'deleted_at' },
        right: { type: 'null', value: null },
      };
      expect(() =>
        checkNullComparisons(whereNode, 'SELECT * FROM users WHERE deleted_at IS NULL LIMIT 1'),
      ).not.toThrow();
    });

    it('should not throw for a non-null comparison', () => {
      const whereNode = {
        type: 'binary_expr',
        operator: '=',
        left: { type: 'column_ref', column: 'status' },
        right: { type: 'single_quote_string', value: 'active' },
      };
      expect(() =>
        checkNullComparisons(whereNode, "SELECT * FROM users WHERE status = 'active' LIMIT 1"),
      ).not.toThrow();
    });
  });
});
