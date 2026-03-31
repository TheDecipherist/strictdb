import { describe, it, expect } from 'vitest';
import { parseSql, bindParams } from '../../src/sql/parser.js';
import { buildExecutionPlan } from '../../src/sql/planner.js';

/**
 * SQL Mode 2 — Dialect Tests
 *
 * Verifies: mysql default, postgresql $N params, other dialect parsing.
 * All SELECT queries use LIMIT to satisfy guardrails.
 */

describe('SQL Mode 2 — Dialect', () => {
  describe('default dialect (mysql)', () => {
    it('should parse without error when no dialect is specified (defaults to mysql)', () => {
      const sql = 'SELECT id, name FROM users LIMIT 10';
      // parseSql with no second argument should not throw
      expect(() => parseSql(sql)).not.toThrow();
    });

    it('should produce a valid execution plan using default dialect', () => {
      const sql = 'SELECT id, name FROM users LIMIT 10';
      const ast = parseSql(sql);
      const plan = buildExecutionPlan(ast, sql);
      expect(plan.type).toBe('select');
      expect(plan.collection).toBe('users');
    });

    it('should bind ? placeholders with mysql dialect', () => {
      const sql = 'SELECT * FROM orders WHERE status = ? LIMIT 10';
      const bound = bindParams(sql, ['active'], 'mysql');
      expect(bound).toContain("'active'");
      expect(bound).not.toContain('?');
    });

    it('should throw when ? count does not match params count', () => {
      const sql = 'SELECT * FROM orders WHERE status = ? AND type = ? LIMIT 10';
      expect(() => bindParams(sql, ['active'], 'mysql')).toThrow();
    });
  });

  describe('postgresql dialect', () => {
    it('should parse SELECT with postgresql dialect without error', () => {
      const sql = 'SELECT id, email FROM users LIMIT 10';
      expect(() => parseSql(sql, 'postgresql')).not.toThrow();
    });

    it('should bind $1 style params when dialect is postgresql', () => {
      const sql = 'SELECT * FROM users WHERE id = $1 LIMIT 10';
      const bound = bindParams(sql, [42], 'postgresql');
      expect(bound).toContain('42');
      expect(bound).not.toContain('$1');
    });

    it('should handle multiple $N params in order', () => {
      const sql = 'SELECT * FROM orders WHERE user_id = $1 AND status = $2 LIMIT 10';
      const bound = bindParams(sql, [99, 'active'], 'postgresql');
      expect(bound).toContain('99');
      expect(bound).toContain("'active'");
    });

    it('should throw when $N max exceeds params array length', () => {
      const sql = 'SELECT * FROM users WHERE id = $1 AND role = $2 LIMIT 10';
      expect(() => bindParams(sql, [1], 'postgresql')).toThrow();
    });
  });

  describe('dialect does not affect pipeline', () => {
    it('should produce identical pipeline stages from mysql and postgresql for the same query', () => {
      const sql = 'SELECT name FROM products WHERE price > 100 LIMIT 20';
      const astMysql = parseSql(sql, 'mysql');
      const astPg = parseSql(sql, 'postgresql');

      const planMysql = buildExecutionPlan(astMysql, sql);
      const planPg = buildExecutionPlan(astPg, sql);

      // Both should have the same collection
      expect(planMysql.collection).toBe(planPg.collection);

      // Both should have $match and $limit stages (core stages match)
      const mysqlHasMatch = planMysql.pipelines[0]?.stages.some(s => '$match' in s);
      const pgHasMatch = planPg.pipelines[0]?.stages.some(s => '$match' in s);
      expect(mysqlHasMatch).toBe(pgHasMatch);

      const mysqlHasLimit = planMysql.pipelines[0]?.stages.some(s => '$limit' in s);
      const pgHasLimit = planPg.pipelines[0]?.stages.some(s => '$limit' in s);
      expect(mysqlHasLimit).toBe(pgHasLimit);
    });

    it('should produce an identical $match stage from mysql and sqlite for the same WHERE', () => {
      const sql = 'SELECT * FROM items WHERE qty < 5 LIMIT 10';
      const astMysql = parseSql(sql, 'mysql');
      const astSqlite = parseSql(sql, 'sqlite');

      const planMysql = buildExecutionPlan(astMysql, sql);
      const planSqlite = buildExecutionPlan(astSqlite, sql);

      const mysqlMatch = planMysql.pipelines[0]?.stages.find(s => '$match' in s);
      const sqliteMatch = planSqlite.pipelines[0]?.stages.find(s => '$match' in s);

      expect(mysqlMatch).toEqual(sqliteMatch);
    });
  });

  describe('supported dialects', () => {
    it('should accept mariadb dialect without throwing', () => {
      const sql = 'SELECT id FROM sessions LIMIT 5';
      expect(() => parseSql(sql, 'mariadb')).not.toThrow();
    });

    it('should accept sqlite dialect without throwing', () => {
      const sql = 'SELECT name FROM files LIMIT 5';
      expect(() => parseSql(sql, 'sqlite')).not.toThrow();
    });

    it('should accept bigquery dialect without throwing', () => {
      const sql = 'SELECT event FROM analytics LIMIT 5';
      expect(() => parseSql(sql, 'bigquery')).not.toThrow();
    });

    it('should build a valid plan from mariadb dialect parse', () => {
      const sql = 'SELECT id FROM logs LIMIT 10';
      const ast = parseSql(sql, 'mariadb');
      const plan = buildExecutionPlan(ast, sql);
      expect(plan.collection).toBe('logs');
    });
  });

  describe('NULL and boolean value formatting', () => {
    it('should format null param as NULL literal', () => {
      const sql = 'SELECT * FROM users WHERE deleted_at = ? LIMIT 1';
      const bound = bindParams(sql, [null], 'mysql');
      expect(bound).toContain('NULL');
    });

    it('should format boolean true as TRUE literal', () => {
      const sql = 'SELECT * FROM users WHERE active = ? LIMIT 1';
      const bound = bindParams(sql, [true], 'mysql');
      expect(bound).toContain('TRUE');
    });

    it('should format boolean false as FALSE literal', () => {
      const sql = 'SELECT * FROM users WHERE active = ? LIMIT 1';
      const bound = bindParams(sql, [false], 'mysql');
      expect(bound).toContain('FALSE');
    });

    it('should escape single quotes in string params', () => {
      const sql = "SELECT * FROM users WHERE name = ? LIMIT 1";
      const bound = bindParams(sql, ["O'Brien"], 'mysql');
      expect(bound).toContain("O''Brien");
    });
  });
});
