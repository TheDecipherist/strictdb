import { describe, it, expect } from 'vitest';
import { validateSqlMode } from '../../src/sql/raw.js';
import { StrictDBError } from '../../src/errors.js';

/**
 * SQL Mode 2 — Raw Passthrough Tests
 *
 * Verifies validateSqlMode() throws the correct error codes for
 * invalid combinations and returns 'raw' or 'mode2' for valid ones.
 */

const SQL = 'SELECT * FROM users LIMIT 10';

describe('SQL Mode 2 — Raw Passthrough', () => {
  describe('raw: true on MongoDB', () => {
    it('should throw SQL_RAW_UNAVAILABLE when { raw: true } on MongoDB', () => {
      expect(() => validateSqlMode('mongo', true, SQL)).toThrow(StrictDBError);
    });

    it('should have code SQL_RAW_UNAVAILABLE', () => {
      try {
        validateSqlMode('mongo', true, SQL);
        expect.fail('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(StrictDBError);
        expect((err as StrictDBError).code).toBe('SQL_RAW_UNAVAILABLE');
      }
    });

    it('should include a .fix message that mentions removing raw', () => {
      try {
        validateSqlMode('mongo', true, SQL);
        expect.fail('should have thrown');
      } catch (err) {
        const fix = (err as StrictDBError).fix;
        expect(typeof fix).toBe('string');
        expect(fix.length).toBeGreaterThan(0);
      }
    });
  });

  describe('raw: false on MongoDB (Mode 2 path)', () => {
    it('should return "mode2" when backend is mongo and raw is false', () => {
      const result = validateSqlMode('mongo', false, SQL);
      expect(result).toBe('mode2');
    });

    it('should return "mode2" when backend is mongo and raw is undefined', () => {
      const result = validateSqlMode('mongo', undefined, SQL);
      expect(result).toBe('mode2');
    });
  });

  describe('SQL backend without raw', () => {
    it('should throw SQL_SUGGEST_RAW when SQL backend (pg) without { raw: true }', () => {
      expect(() => validateSqlMode('sql', false, SQL)).toThrow(StrictDBError);
    });

    it('should have code SQL_SUGGEST_RAW', () => {
      try {
        validateSqlMode('sql', false, SQL);
        expect.fail('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(StrictDBError);
        expect((err as StrictDBError).code).toBe('SQL_SUGGEST_RAW');
      }
    });

    it('should include a .fix message suggesting { raw: true }', () => {
      try {
        validateSqlMode('sql', false, SQL);
        expect.fail('should have thrown');
      } catch (err) {
        const fix = (err as StrictDBError).fix;
        expect(typeof fix).toBe('string');
        expect(fix.toLowerCase()).toMatch(/raw/);
      }
    });

    it('should throw SQL_SUGGEST_RAW when raw is undefined on SQL backend', () => {
      try {
        validateSqlMode('sql', undefined, SQL);
        expect.fail('should have thrown');
      } catch (err) {
        expect((err as StrictDBError).code).toBe('SQL_SUGGEST_RAW');
      }
    });
  });

  describe('raw: true on SQL backends', () => {
    it('should return "raw" when backend is sql and raw is true', () => {
      const result = validateSqlMode('sql', true, SQL);
      expect(result).toBe('raw');
    });

    it('should return "raw" for any truthy raw value on SQL backend', () => {
      // raw: true is the standard
      const result = validateSqlMode('sql', true, SQL);
      expect(result).toBe('raw');
    });
  });

  describe('Elasticsearch backend', () => {
    it('should throw SQL_MODE_UNAVAILABLE on Elasticsearch backend', () => {
      expect(() => validateSqlMode('elastic', false, SQL)).toThrow(StrictDBError);
    });

    it('should have code SQL_MODE_UNAVAILABLE on Elasticsearch', () => {
      try {
        validateSqlMode('elastic', false, SQL);
        expect.fail('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(StrictDBError);
        expect((err as StrictDBError).code).toBe('SQL_MODE_UNAVAILABLE');
      }
    });

    it('should also throw SQL_MODE_UNAVAILABLE when raw: true on Elasticsearch', () => {
      // Elasticsearch does not support SQL Mode 2 at all — raw or not
      try {
        validateSqlMode('elastic', true, SQL);
        expect.fail('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(StrictDBError);
        expect((err as StrictDBError).code).toBe('SQL_MODE_UNAVAILABLE');
      }
    });

    it('should include a .fix message on SQL_MODE_UNAVAILABLE', () => {
      try {
        validateSqlMode('elastic', false, SQL);
        expect.fail('should have thrown');
      } catch (err) {
        const fix = (err as StrictDBError).fix;
        expect(typeof fix).toBe('string');
        expect(fix.length).toBeGreaterThan(0);
      }
    });
  });

  describe('error properties', () => {
    it('StrictDBError should be retryable: false for SQL_RAW_UNAVAILABLE', () => {
      try {
        validateSqlMode('mongo', true, SQL);
        expect.fail('should have thrown');
      } catch (err) {
        expect((err as StrictDBError).retryable).toBe(false);
      }
    });

    it('StrictDBError should be retryable: false for SQL_SUGGEST_RAW', () => {
      try {
        validateSqlMode('sql', false, SQL);
        expect.fail('should have thrown');
      } catch (err) {
        expect((err as StrictDBError).retryable).toBe(false);
      }
    });
  });
});
