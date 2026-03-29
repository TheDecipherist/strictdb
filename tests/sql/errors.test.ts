import { describe, it, expect } from 'vitest';
import { parseSql, bindParams } from '../../src/sql/parser.js';
import { buildExecutionPlan } from '../../src/sql/planner.js';
import { StrictDBError } from '../../src/errors.js';
import * as sqlErrors from '../../src/sql/errors.js';

/**
 * SQL Mode 2 — Error Tests
 *
 * Verifies: every SQL error code has .fix, .sql, .code fields.
 * All error factories produce non-retryable StrictDBError instances.
 */

describe('SQL Mode 2 — Errors', () => {
  describe('SQL_PARSE_ERROR', () => {
    it('should throw SQL_PARSE_ERROR for invalid SQL syntax', () => {
      expect(() => parseSql('THIS IS NOT VALID SQL!!!')).toThrow(StrictDBError);
    });

    it('should have code SQL_PARSE_ERROR', () => {
      let caught: unknown;
      try {
        parseSql('SELECT FROM WHERE BROKEN');
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(StrictDBError);
      expect((caught as StrictDBError).code).toBe('SQL_PARSE_ERROR');
    });

    it('should include .fix with syntax suggestion', () => {
      let caught: unknown;
      try {
        parseSql('INVALID SQL');
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(StrictDBError);
      const err = caught as StrictDBError;
      expect(err.fix).toBeTruthy();
      expect(err.fix).toContain('syntax');
    });

    it('should include .sql with original SQL string', () => {
      const badSql = 'BROKEN !! SYNTAX !!';
      let caught: unknown;
      try {
        parseSql(badSql);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(StrictDBError);
      expect((caught as unknown as Record<string, unknown>)['sql']).toBe(badSql);
    });

    it('should not be retryable', () => {
      let caught: unknown;
      try {
        parseSql('NOT SQL AT ALL');
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(StrictDBError);
      expect((caught as StrictDBError).retryable).toBe(false);
    });

    it('should include the parse detail in the error message when provided via factory', () => {
      const err = sqlErrors.parseError({ sql: 'BAD', detail: 'Unexpected token at line 1' });
      expect(err.message).toContain('Unexpected token at line 1');
    });
  });

  describe('SQL_PARAM_MISMATCH', () => {
    it('should throw SQL_PARAM_MISMATCH when param count exceeds placeholder count', () => {
      expect(() =>
        bindParams('SELECT * FROM users WHERE id = ?', [1, 2], 'mysql'),
      ).toThrow(StrictDBError);
    });

    it('should have code SQL_PARAM_MISMATCH', () => {
      let caught: unknown;
      try {
        bindParams('SELECT * FROM users WHERE id = ?', [1, 2], 'mysql');
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(StrictDBError);
      expect((caught as StrictDBError).code).toBe('SQL_PARAM_MISMATCH');
    });

    it('should include placeholder count in error message', () => {
      let caught: unknown;
      try {
        bindParams('SELECT * FROM users WHERE id = ?', [1, 2], 'mysql');
      } catch (e) {
        caught = e;
      }
      // message says "1 parameter placeholders but 2 values"
      expect((caught as StrictDBError).message).toContain('1');
    });

    it('should include actual param count in error message', () => {
      let caught: unknown;
      try {
        bindParams('SELECT * FROM t WHERE a = ? AND b = ?', [1], 'mysql');
      } catch (e) {
        caught = e;
      }
      // message says "2 parameter placeholders but 1 values"
      expect((caught as StrictDBError).message).toContain('2');
      expect((caught as StrictDBError).message).toContain('1');
    });

    it('should include .fix with guidance', () => {
      let caught: unknown;
      try {
        bindParams('SELECT * FROM users WHERE id = ?', [1, 2], 'mysql');
      } catch (e) {
        caught = e;
      }
      expect((caught as StrictDBError).fix).toContain('params');
    });

    it('should include original .sql in error', () => {
      const sql = 'SELECT * FROM users WHERE id = ?';
      let caught: unknown;
      try {
        bindParams(sql, [1, 2], 'mysql');
      } catch (e) {
        caught = e;
      }
      expect((caught as unknown as Record<string, unknown>)['sql']).toBe(sql);
    });

    it('should not be retryable', () => {
      let caught: unknown;
      try {
        bindParams('SELECT * FROM users WHERE id = ?', [1, 2], 'mysql');
      } catch (e) {
        caught = e;
      }
      expect((caught as StrictDBError).retryable).toBe(false);
    });

    it('paramMismatchError factory: should encode expected and actual counts in message', () => {
      const err = sqlErrors.paramMismatchError(3, 1, { sql: 'SELECT ?, ?, ?' });
      expect(err.code).toBe('SQL_PARAM_MISMATCH');
      expect(err.message).toContain('3');
      expect(err.message).toContain('1');
      expect(err.fix).toContain('params');
    });
  });

  describe('SQL_NULL_COMPARISON', () => {
    it('should throw SQL_NULL_COMPARISON for = NULL comparison', () => {
      const sql = 'SELECT * FROM users WHERE deleted_at = NULL LIMIT 10';
      const ast = parseSql(sql);
      expect(() => buildExecutionPlan(ast, sql)).toThrow(StrictDBError);
    });

    it('should have code SQL_NULL_COMPARISON', () => {
      const sql = 'SELECT * FROM users WHERE deleted_at = NULL LIMIT 10';
      const ast = parseSql(sql);
      let caught: unknown;
      try {
        buildExecutionPlan(ast, sql);
      } catch (e) {
        caught = e;
      }
      expect((caught as StrictDBError).code).toBe('SQL_NULL_COMPARISON');
    });

    it('should suggest IS NULL in .fix', () => {
      const sql = 'SELECT * FROM users WHERE deleted_at = NULL LIMIT 10';
      const ast = parseSql(sql);
      let caught: unknown;
      try {
        buildExecutionPlan(ast, sql);
      } catch (e) {
        caught = e;
      }
      expect((caught as StrictDBError).fix).toContain('IS NULL');
    });

    it('should not be retryable', () => {
      const sql = 'SELECT * FROM users WHERE deleted_at = NULL LIMIT 10';
      const ast = parseSql(sql);
      let caught: unknown;
      try {
        buildExecutionPlan(ast, sql);
      } catch (e) {
        caught = e;
      }
      expect((caught as StrictDBError).retryable).toBe(false);
    });

    it('nullComparisonError factory: should have correct code and fix', () => {
      const err = sqlErrors.nullComparisonError({ sql: "SELECT * FROM t WHERE x = NULL LIMIT 1" });
      expect(err.code).toBe('SQL_NULL_COMPARISON');
      expect(err.fix).toContain('IS NULL');
      expect((err as unknown as Record<string, unknown>)['sql']).toBe("SELECT * FROM t WHERE x = NULL LIMIT 1");
    });
  });

  describe('parseError factory', () => {
    it('should produce a StrictDBError instance', () => {
      const err = sqlErrors.parseError({ sql: 'BAD SQL' });
      expect(err).toBeInstanceOf(StrictDBError);
    });

    it('should have code SQL_PARSE_ERROR', () => {
      const err = sqlErrors.parseError({ sql: 'BAD SQL' });
      expect(err.code).toBe('SQL_PARSE_ERROR');
    });

    it('should have .fix with syntax guidance', () => {
      const err = sqlErrors.parseError({ sql: 'BAD SQL' });
      expect(err.fix).toBeTruthy();
      expect(typeof err.fix).toBe('string');
    });

    it('should attach .sql to the error', () => {
      const err = sqlErrors.parseError({ sql: 'SELECT BAD' });
      expect((err as unknown as Record<string, unknown>)['sql']).toBe('SELECT BAD');
    });

    it('should not be retryable', () => {
      const err = sqlErrors.parseError({ sql: 'BAD' });
      expect(err.retryable).toBe(false);
    });
  });

  describe('unsupportedError factory', () => {
    it('should produce a StrictDBError with code SQL_UNSUPPORTED', () => {
      const err = sqlErrors.unsupportedError('MERGE', { sql: 'MERGE INTO t USING s ON ...' });
      expect(err).toBeInstanceOf(StrictDBError);
      expect(err.code).toBe('SQL_UNSUPPORTED');
    });

    it('should include the unsupported construct name in the message', () => {
      const err = sqlErrors.unsupportedError('MERGE', { sql: 'MERGE ...' });
      expect(err.message).toContain('MERGE');
    });

    it('should suggest Mode 1 / db.queryMany() alternative in .fix', () => {
      const err = sqlErrors.unsupportedError('PIVOT', { sql: 'SELECT PIVOT ...' });
      expect(err.fix).toContain('queryMany');
    });

    it('should attach .sql to the error', () => {
      const sql = 'MERGE INTO t USING s ON ...';
      const err = sqlErrors.unsupportedError('MERGE', { sql });
      expect((err as unknown as Record<string, unknown>)['sql']).toBe(sql);
    });

    it('should not be retryable', () => {
      const err = sqlErrors.unsupportedError('PIVOT', { sql: 'SELECT PIVOT ...' });
      expect(err.retryable).toBe(false);
    });
  });

  describe('modeUnavailableError factory', () => {
    it('should produce a StrictDBError with code SQL_MODE_UNAVAILABLE', () => {
      const err = sqlErrors.modeUnavailableError('elasticsearch', { sql: 'SELECT 1' });
      expect(err).toBeInstanceOf(StrictDBError);
      expect(err.code).toBe('SQL_MODE_UNAVAILABLE');
    });

    it('should mention the backend name in .fix', () => {
      const err = sqlErrors.modeUnavailableError('postgresql', { sql: 'SELECT 1' });
      expect(err.fix).toContain('postgresql');
    });

    it('should mention { raw: true } as an alternative in .fix', () => {
      const err = sqlErrors.modeUnavailableError('elasticsearch', { sql: 'SELECT 1' });
      expect(err.fix).toContain('raw');
    });

    it('should attach .sql', () => {
      const sql = 'SELECT 1 FROM dual';
      const err = sqlErrors.modeUnavailableError('oracle', { sql });
      expect((err as unknown as Record<string, unknown>)['sql']).toBe(sql);
    });

    it('should not be retryable', () => {
      const err = sqlErrors.modeUnavailableError('elasticsearch', { sql: 'SELECT 1' });
      expect(err.retryable).toBe(false);
    });
  });

  describe('rawUnavailableError factory', () => {
    it('should produce a StrictDBError with code SQL_RAW_UNAVAILABLE', () => {
      const err = sqlErrors.rawUnavailableError({ sql: 'SELECT 1' });
      expect(err).toBeInstanceOf(StrictDBError);
      expect(err.code).toBe('SQL_RAW_UNAVAILABLE');
    });

    it('should instruct user to remove { raw: true } in .fix', () => {
      const err = sqlErrors.rawUnavailableError({ sql: 'SELECT 1' });
      expect(err.fix).toContain('raw');
    });

    it('should attach .sql', () => {
      const sql = 'SELECT * FROM users LIMIT 10';
      const err = sqlErrors.rawUnavailableError({ sql });
      expect((err as unknown as Record<string, unknown>)['sql']).toBe(sql);
    });

    it('should not be retryable', () => {
      const err = sqlErrors.rawUnavailableError({ sql: 'SELECT 1' });
      expect(err.retryable).toBe(false);
    });
  });

  describe('suggestRawError factory', () => {
    it('should produce a StrictDBError with code SQL_SUGGEST_RAW', () => {
      const err = sqlErrors.suggestRawError('postgresql', { sql: 'SELECT 1' });
      expect(err).toBeInstanceOf(StrictDBError);
      expect(err.code).toBe('SQL_SUGGEST_RAW');
    });

    it('should mention { raw: true } as the suggested fix', () => {
      const err = sqlErrors.suggestRawError('postgresql', { sql: 'SELECT 1' });
      expect(err.fix).toContain('raw');
    });

    it('should mention the backend name in .fix', () => {
      const err = sqlErrors.suggestRawError('mysql', { sql: 'SELECT 1' });
      expect(err.fix).toContain('mysql');
    });

    it('should attach .sql', () => {
      const sql = 'SELECT NOW()';
      const err = sqlErrors.suggestRawError('postgresql', { sql });
      expect((err as unknown as Record<string, unknown>)['sql']).toBe(sql);
    });

    it('should not be retryable', () => {
      const err = sqlErrors.suggestRawError('postgresql', { sql: 'SELECT 1' });
      expect(err.retryable).toBe(false);
    });
  });

  describe('all errors have required fields', () => {
    it('every SQL error factory should produce an error with code, fix, and sql fields', () => {
      const sql = 'SELECT 1';
      const errors = [
        sqlErrors.parseError({ sql, detail: 'test' }),
        sqlErrors.unsupportedError('MERGE', { sql }),
        sqlErrors.modeUnavailableError('elasticsearch', { sql }),
        sqlErrors.rawUnavailableError({ sql }),
        sqlErrors.suggestRawError('postgresql', { sql }),
        sqlErrors.nullComparisonError({ sql }),
        sqlErrors.paramMismatchError(2, 1, { sql }),
      ];

      for (const err of errors) {
        expect(err).toBeInstanceOf(StrictDBError);
        expect(typeof err.code).toBe('string');
        expect(err.code.length).toBeGreaterThan(0);
        expect(typeof err.fix).toBe('string');
        expect(err.fix.length).toBeGreaterThan(0);
        expect((err as unknown as Record<string, unknown>)['sql']).toBe(sql);
      }
    });

    it('no SQL error should be retryable', () => {
      const sql = 'SELECT 1';
      const errors = [
        sqlErrors.parseError({ sql }),
        sqlErrors.unsupportedError('MERGE', { sql }),
        sqlErrors.modeUnavailableError('elasticsearch', { sql }),
        sqlErrors.rawUnavailableError({ sql }),
        sqlErrors.suggestRawError('postgresql', { sql }),
        sqlErrors.nullComparisonError({ sql }),
        sqlErrors.paramMismatchError(2, 1, { sql }),
      ];

      for (const err of errors) {
        expect(err.retryable).toBe(false);
      }
    });

    it('all errors should be instances of StrictDBError', () => {
      const sql = 'SELECT 1';
      const errors = [
        sqlErrors.parseError({ sql }),
        sqlErrors.unsupportedError('MERGE', { sql }),
        sqlErrors.modeUnavailableError('elasticsearch', { sql }),
        sqlErrors.rawUnavailableError({ sql }),
        sqlErrors.suggestRawError('postgresql', { sql }),
        sqlErrors.nullComparisonError({ sql }),
        sqlErrors.paramMismatchError(2, 1, { sql }),
      ];

      for (const err of errors) {
        expect(err).toBeInstanceOf(StrictDBError);
        expect(err.name).toBe('StrictDBError');
      }
    });

    it('all errors should have distinct codes', () => {
      const sql = 'SELECT 1';
      const errors = [
        sqlErrors.parseError({ sql }),
        sqlErrors.unsupportedError('X', { sql }),
        sqlErrors.modeUnavailableError('pg', { sql }),
        sqlErrors.rawUnavailableError({ sql }),
        sqlErrors.suggestRawError('pg', { sql }),
        sqlErrors.nullComparisonError({ sql }),
        sqlErrors.paramMismatchError(1, 0, { sql }),
      ];

      const codes = errors.map(e => e.code);
      const unique = new Set(codes);
      expect(unique.size).toBe(codes.length);
    });

    it('all errors should have a non-empty message', () => {
      const sql = 'SELECT 1';
      const errors = [
        sqlErrors.parseError({ sql }),
        sqlErrors.unsupportedError('MERGE', { sql }),
        sqlErrors.modeUnavailableError('elasticsearch', { sql }),
        sqlErrors.rawUnavailableError({ sql }),
        sqlErrors.suggestRawError('postgresql', { sql }),
        sqlErrors.nullComparisonError({ sql }),
        sqlErrors.paramMismatchError(2, 1, { sql }),
      ];

      for (const err of errors) {
        expect(typeof err.message).toBe('string');
        expect(err.message.length).toBeGreaterThan(0);
      }
    });
  });
});
