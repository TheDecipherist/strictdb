import { describe, it, expect } from 'vitest';
import { bindParams } from '../../src/sql/parser.js';
import { StrictDBError } from '../../src/errors.js';

describe('SQL Mode 2 — Parameter Binding', () => {
  describe('MySQL style (? placeholders)', () => {
    it('should substitute ? placeholders with params in order', () => {
      const result = bindParams(
        'SELECT * FROM users WHERE name = ? LIMIT ?',
        ['Tim', 10],
      );
      expect(result).toBe("SELECT * FROM users WHERE name = 'Tim' LIMIT 10");
    });

    it('should handle multiple ? placeholders', () => {
      const result = bindParams(
        'SELECT * FROM users WHERE a = ? AND b = ? AND c = ? LIMIT ?',
        ['x', 'y', 'z', 50],
      );
      expect(result).toContain("a = 'x'");
      expect(result).toContain("b = 'y'");
      expect(result).toContain("c = 'z'");
      expect(result).toContain('LIMIT 50');
    });

    it('should handle string, number, and boolean param types', () => {
      const result = bindParams(
        'SELECT * FROM t WHERE a = ? AND b = ? AND c = ? LIMIT ?',
        ['hello', 42, true, 10],
      );
      expect(result).toContain("a = 'hello'");
      expect(result).toContain('b = 42');
      expect(result).toContain('c = TRUE');
    });

    it('should handle null param values', () => {
      const result = bindParams(
        'SELECT * FROM t WHERE a = ? LIMIT ?',
        [null, 10],
      );
      expect(result).toContain('a = NULL');
    });
  });

  describe('PostgreSQL style ($N placeholders)', () => {
    it('should substitute $1, $2, $3 with params by index', () => {
      const result = bindParams(
        'SELECT * FROM users WHERE name = $1 AND age > $2 LIMIT $3',
        ['Tim', 25, 10],
        'postgresql',
      );
      expect(result).toBe("SELECT * FROM users WHERE name = 'Tim' AND age > 25 LIMIT 10");
    });

    it('should handle $1 used multiple times in one query', () => {
      const result = bindParams(
        'SELECT * FROM users WHERE name = $1 OR alias = $1 LIMIT $2',
        ['Tim', 10],
        'postgresql',
      );
      expect(result).toContain("name = 'Tim'");
      expect(result).toContain("alias = 'Tim'");
      expect(result).toContain('LIMIT 10');
    });

    it('should require dialect: "postgresql" for $N params', () => {
      // With mysql dialect, $1 is not a placeholder — it passes through
      const result = bindParams(
        'SELECT * FROM users WHERE name = $1 LIMIT 10',
        undefined,
        'mysql',
      );
      expect(result).toContain('$1');
    });
  });

  describe('param mismatch', () => {
    it('should throw SQL_PARAM_MISMATCH when too few params provided', () => {
      expect(() =>
        bindParams('SELECT * FROM t WHERE a = ? AND b = ? LIMIT ?', ['only_one']),
      ).toThrow(StrictDBError);

      try {
        bindParams('SELECT * FROM t WHERE a = ? AND b = ? LIMIT ?', ['only_one']);
      } catch (err) {
        const e = err as StrictDBError;
        expect(e.code).toBe('SQL_PARAM_MISMATCH');
      }
    });

    it('should throw SQL_PARAM_MISMATCH when too many params provided', () => {
      expect(() =>
        bindParams('SELECT * FROM t WHERE a = ? LIMIT ?', ['a', 'b', 'c']),
      ).toThrow(StrictDBError);
    });

    it('should include placeholder count and param count in error message', () => {
      try {
        bindParams('SELECT * FROM t WHERE a = ? AND b = ? AND c = ? LIMIT ?', ['a', 'b']);
      } catch (err) {
        const e = err as StrictDBError;
        expect(e.message).toContain('4');
        expect(e.message).toContain('2');
      }
    });

    it('should include .fix field suggesting correct param count', () => {
      try {
        bindParams('SELECT * FROM t WHERE a = ? LIMIT ?', ['a', 'b', 'c']);
      } catch (err) {
        const e = err as StrictDBError;
        expect(e.fix).toContain('params array length');
      }
    });
  });

  describe('injection safety', () => {
    it('should safely bind string values without SQL injection risk', () => {
      const result = bindParams(
        "SELECT * FROM users WHERE name = ? LIMIT ?",
        ["Tim'; DROP TABLE users; --", 10],
      );
      expect(result).toContain("Tim''; DROP TABLE users; --");
      expect(result).not.toContain("Tim'; DROP");
    });

    it('should never concatenate params directly into SQL string', () => {
      const result = bindParams(
        'SELECT * FROM t WHERE a = ? LIMIT ?',
        ['test', 10],
      );
      // String params are always quoted
      expect(result).toContain("'test'");
    });
  });
});
