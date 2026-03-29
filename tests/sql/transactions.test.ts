import { describe, it, expect } from 'vitest';
import { isTransactionBlock, splitStatements } from '../../src/sql/parser.js';
import { parseTransactionBlock } from '../../src/sql/transactions.js';

/**
 * SQL Mode 2 — Transaction Tests
 *
 * Verifies: isTransactionBlock, splitStatements, parseTransactionBlock.
 * No database connections. Tests BEGIN detection, semicolon splitting,
 * and per-statement type detection.
 */

describe('SQL Mode 2 — Transactions', () => {
  describe('isTransactionBlock', () => {
    it('should return true for a string starting with BEGIN', () => {
      expect(isTransactionBlock('BEGIN')).toBe(true);
    });

    it('should return true for BEGIN followed by statements', () => {
      const sql = 'BEGIN; INSERT INTO users (name) VALUES ("Alice"); COMMIT';
      expect(isTransactionBlock(sql)).toBe(true);
    });

    it('should return true for START TRANSACTION', () => {
      expect(isTransactionBlock('START TRANSACTION')).toBe(true);
    });

    it('should return true case-insensitively', () => {
      expect(isTransactionBlock('begin')).toBe(true);
      expect(isTransactionBlock('Begin')).toBe(true);
    });

    it('should return false for a plain SELECT', () => {
      expect(isTransactionBlock('SELECT * FROM users LIMIT 10')).toBe(false);
    });

    it('should return false for an INSERT that does not begin with BEGIN', () => {
      expect(isTransactionBlock('INSERT INTO users (name) VALUES ("Bob")')).toBe(false);
    });
  });

  describe('splitStatements', () => {
    it('should split a single statement with no semicolon into one entry', () => {
      const sql = 'SELECT * FROM users LIMIT 10';
      const result = splitStatements(sql);
      expect(result.length).toBe(1);
      expect(result[0]).toBe('SELECT * FROM users LIMIT 10');
    });

    it('should split multiple statements by semicolons', () => {
      const sql = 'INSERT INTO a (x) VALUES (1); INSERT INTO b (y) VALUES (2)';
      const result = splitStatements(sql);
      expect(result.length).toBe(2);
    });

    it('should trim whitespace from each statement', () => {
      const sql = '  SELECT 1  ;  SELECT 2  ';
      const result = splitStatements(sql);
      expect(result.every(s => s === s.trim())).toBe(true);
    });

    it('should filter out empty statements (trailing semicolons)', () => {
      const sql = 'SELECT 1; SELECT 2;';
      const result = splitStatements(sql);
      expect(result.every(s => s.length > 0)).toBe(true);
    });

    it('should handle a full transaction block by returning all non-empty parts', () => {
      const sql = 'BEGIN; INSERT INTO users (name) VALUES ("Alice"); UPDATE users SET active = 1 WHERE name = "Alice"; COMMIT';
      const result = splitStatements(sql);
      expect(result.length).toBe(4);
    });
  });

  describe('parseTransactionBlock', () => {
    it('should skip BEGIN and COMMIT, returning only data statements', () => {
      const sql = 'BEGIN; INSERT INTO orders (item) VALUES ("book"); COMMIT';
      const stmts = parseTransactionBlock(sql);
      // Only the INSERT should be returned
      expect(stmts.length).toBe(1);
    });

    it('should skip ROLLBACK as a control statement', () => {
      const sql = 'BEGIN; UPDATE accounts SET balance = 0; ROLLBACK';
      const stmts = parseTransactionBlock(sql);
      expect(stmts.length).toBe(1);
    });

    it('should detect INSERT statement type', () => {
      const sql = 'BEGIN; INSERT INTO users (name) VALUES ("Alice"); COMMIT';
      const stmts = parseTransactionBlock(sql);
      expect(stmts[0]?.type).toBe('insert');
    });

    it('should detect UPDATE statement type', () => {
      const sql = 'BEGIN; UPDATE users SET active = 1 WHERE id = 1; COMMIT';
      const stmts = parseTransactionBlock(sql);
      expect(stmts[0]?.type).toBe('update');
    });

    it('should detect DELETE statement type', () => {
      const sql = 'BEGIN; DELETE FROM users WHERE id = 1; COMMIT';
      const stmts = parseTransactionBlock(sql);
      expect(stmts[0]?.type).toBe('delete');
    });

    it('should detect SELECT statement type', () => {
      const sql = 'BEGIN; SELECT id FROM users WHERE name = "Alice"; COMMIT';
      const stmts = parseTransactionBlock(sql);
      expect(stmts[0]?.type).toBe('select');
    });

    it('should preserve the original sql string for each statement', () => {
      const sql = 'BEGIN; INSERT INTO logs (msg) VALUES ("test"); COMMIT';
      const stmts = parseTransactionBlock(sql);
      expect(typeof stmts[0]?.sql).toBe('string');
      expect(stmts[0]?.sql.length).toBeGreaterThan(0);
    });

    it('should handle mixed INSERT + UPDATE in one transaction', () => {
      const sql = [
        'BEGIN',
        'INSERT INTO inventory (item, qty) VALUES ("widget", 100)',
        'UPDATE pricing SET price = 9.99 WHERE item = "widget"',
        'COMMIT',
      ].join('; ');

      const stmts = parseTransactionBlock(sql);
      expect(stmts.length).toBe(2);
      expect(stmts[0]?.type).toBe('insert');
      expect(stmts[1]?.type).toBe('update');
    });

    it('should return empty array for a block containing only BEGIN/COMMIT', () => {
      const sql = 'BEGIN; COMMIT';
      const stmts = parseTransactionBlock(sql);
      expect(stmts.length).toBe(0);
    });

    it('should accept postgresql dialect parameter without error', () => {
      const sql = 'BEGIN; INSERT INTO t (c) VALUES (1); COMMIT';
      expect(() => parseTransactionBlock(sql, 'postgresql')).not.toThrow();
    });
  });
});
