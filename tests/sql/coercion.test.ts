import { describe, it, expect } from 'vitest';
import { coerceValue, isAlmostObjectId } from '../../src/sql/coercion.js';

describe('SQL Mode 2 — Type Coercion', () => {
  describe('ObjectId detection', () => {
    it('should convert 24-char hex string to ObjectId marker', () => {
      const result = coerceValue('507f1f77bcf86cd799439011');
      expect(result).toEqual({ $oid: '507f1f77bcf86cd799439011' });
    });

    it('should NOT convert 23-char hex string (wrong length)', () => {
      const result = coerceValue('507f1f77bcf86cd79943901');
      // 23 chars — not ObjectId, falls through to other checks
      expect(result).not.toEqual(expect.objectContaining({ $oid: expect.anything() }));
    });

    it('should NOT convert 25-char hex string (wrong length)', () => {
      const result = coerceValue('507f1f77bcf86cd7994390111');
      expect(result).not.toEqual(expect.objectContaining({ $oid: expect.anything() }));
    });

    it('should NOT convert 24-char string with non-hex characters', () => {
      const result = coerceValue('507f1f77bcf86cd79943901z');
      expect(typeof result).toBe('string');
      expect(result).toBe('507f1f77bcf86cd79943901z');
    });

    it('should handle uppercase hex characters', () => {
      const result = coerceValue('507F1F77BCF86CD799439011');
      expect(result).toEqual({ $oid: '507F1F77BCF86CD799439011' });
    });

    it('should NOT convert non-string values', () => {
      expect(coerceValue(123)).toBe(123);
      expect(coerceValue(true)).toBe(true);
      expect(coerceValue(null)).toBe(null);
    });
  });

  describe('Date detection', () => {
    it('should convert ISO 8601 date string (YYYY-MM-DD) to Date', () => {
      const result = coerceValue('2026-01-15');
      expect(result).toBeInstanceOf(Date);
      expect((result as Date).getFullYear()).toBe(2026);
    });

    it('should convert ISO 8601 datetime string to Date', () => {
      const result = coerceValue('2026-01-15T10:30:00Z');
      expect(result).toBeInstanceOf(Date);
    });

    it('should NOT convert partial date strings', () => {
      const result = coerceValue('2026-01');
      expect(result).not.toBeInstanceOf(Date);
    });
  });

  describe('Boolean detection', () => {
    it('should convert "true" to boolean true', () => {
      expect(coerceValue('true')).toBe(true);
    });

    it('should convert "false" to boolean false', () => {
      expect(coerceValue('false')).toBe(false);
    });

    it('should be case insensitive ("TRUE", "False")', () => {
      expect(coerceValue('TRUE')).toBe(true);
      expect(coerceValue('False')).toBe(false);
    });
  });

  describe('Number detection', () => {
    it('should convert numeric string "25" to number 25', () => {
      expect(coerceValue('25')).toBe(25);
    });

    it('should convert float string "3.14" to number 3.14', () => {
      expect(coerceValue('3.14')).toBe(3.14);
    });

    it('should NOT convert empty string to number', () => {
      expect(coerceValue('')).toBe('');
    });

    it('should pass through values that are already numbers', () => {
      expect(coerceValue(42)).toBe(42);
      expect(coerceValue(0)).toBe(0);
    });
  });

  describe('Array detection', () => {
    it('should convert JSON array string "[1,2,3]" to array', () => {
      const result = coerceValue('[1,2,3]');
      expect(result).toEqual([1, 2, 3]);
    });

    it('should NOT convert malformed JSON', () => {
      const result = coerceValue('[1,2,');
      expect(typeof result).toBe('string');
    });
  });

  describe('coercion priority order', () => {
    it('should check ObjectId before Date (24-char hex is ObjectId, not date)', () => {
      const result = coerceValue('aabbccddeeff00112233aabb');
      expect(result).toEqual({ $oid: 'aabbccddeeff00112233aabb' });
    });

    it('should check Date before Boolean', () => {
      // A date string should be converted to Date, not treated as truthy
      const result = coerceValue('2026-03-15');
      expect(result).toBeInstanceOf(Date);
    });

    it('should fall through to string when no coercion matches', () => {
      expect(coerceValue('hello world')).toBe('hello world');
      expect(coerceValue('active')).toBe('active');
    });
  });

  describe('NULL handling', () => {
    it('should pass null values through without coercion', () => {
      expect(coerceValue(null)).toBe(null);
    });

    it('should pass undefined values through without coercion', () => {
      expect(coerceValue(undefined)).toBe(undefined);
    });
  });

  describe('isAlmostObjectId', () => {
    it('should return true for 24-char string with non-hex chars', () => {
      expect(isAlmostObjectId('507f1f77bcf86cd79943901z')).toBe(true);
    });

    it('should return false for valid 24-char hex', () => {
      expect(isAlmostObjectId('507f1f77bcf86cd799439011')).toBe(false);
    });

    it('should return false for wrong length', () => {
      expect(isAlmostObjectId('short')).toBe(false);
    });
  });
});
