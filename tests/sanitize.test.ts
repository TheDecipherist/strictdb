/**
 * Sanitization Tests — Input validation for all backends
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerFields,
  clearFieldRegistry,
  validateFilterFields,
  validateElasticFields,
  validateIndexName,
  validateRegexComplexity,
  sanitizeFilter,
  applySanitizeRules,
} from '../src/sanitize.js';
import { StrictDBError } from '../src/errors.js';

beforeEach(() => {
  clearFieldRegistry();
});

describe('SQL field validation', () => {
  it('allows valid fields when schema registered', () => {
    registerFields('users', ['name', 'email', 'age', 'role']);
    expect(() => validateFilterFields('users', { name: 'Tim', age: 25 }, 'sql')).not.toThrow();
  });

  it('blocks unknown fields when schema registered', () => {
    registerFields('users', ['name', 'email']);
    expect(() => validateFilterFields('users', { password: '123' }, 'sql'))
      .toThrow(StrictDBError);
  });

  it('includes valid fields in error message', () => {
    registerFields('users', ['name', 'email']);
    try {
      validateFilterFields('users', { age: 25 }, 'sql');
      expect.fail('Should have thrown');
    } catch (e) {
      const err = e as StrictDBError;
      expect(err.fix).toContain('name, email');
    }
  });

  it('allows any fields when no schema registered', () => {
    expect(() => validateFilterFields('users', { anything: 'works' }, 'sql')).not.toThrow();
  });

  it('validates fields in $and arrays', () => {
    registerFields('users', ['name', 'email']);
    expect(() => validateFilterFields('users', { $and: [{ name: 'Tim' }, { password: '123' }] }, 'sql'))
      .toThrow(StrictDBError);
  });

  it('skips operator keys', () => {
    registerFields('users', ['name']);
    expect(() => validateFilterFields('users', { $and: [{ name: 'Tim' }] }, 'sql')).not.toThrow();
  });
});

describe('Elasticsearch field validation', () => {
  it('blocks ES internal fields', () => {
    expect(() => validateElasticFields('users', { _id: '123' })).toThrow(StrictDBError);
    expect(() => validateElasticFields('users', { _source: {} })).toThrow(StrictDBError);
    expect(() => validateElasticFields('users', { _score: 1 })).toThrow(StrictDBError);
  });

  it('allows normal fields', () => {
    expect(() => validateElasticFields('users', { name: 'Tim' })).not.toThrow();
  });

  it('validates against registered schema', () => {
    registerFields('users', ['name', 'email']);
    expect(() => validateElasticFields('users', { password: '123' })).toThrow(StrictDBError);
  });
});

describe('Index name validation', () => {
  it('blocks wildcard patterns', () => {
    expect(() => validateIndexName('users*')).toThrow(StrictDBError);
    expect(() => validateIndexName('users,orders')).toThrow(StrictDBError);
    expect(() => validateIndexName('users orders')).toThrow(StrictDBError);
  });

  it('blocks system indices', () => {
    expect(() => validateIndexName('.kibana')).toThrow(StrictDBError);
    expect(() => validateIndexName('-internal')).toThrow(StrictDBError);
  });

  it('allows normal index names', () => {
    expect(() => validateIndexName('users')).not.toThrow();
    expect(() => validateIndexName('my_index_v2')).not.toThrow();
  });
});

describe('Regex complexity validation', () => {
  it('blocks nested quantifiers', () => {
    expect(() => validateRegexComplexity('(a+)+')).toThrow(StrictDBError);
  });

  it('blocks very long patterns', () => {
    expect(() => validateRegexComplexity('a'.repeat(1001))).toThrow(StrictDBError);
  });

  it('allows normal patterns', () => {
    expect(() => validateRegexComplexity('^Tim')).not.toThrow();
    expect(() => validateRegexComplexity('[a-zA-Z]+')).not.toThrow();
  });
});

describe('sanitizeFilter', () => {
  it('skips MongoDB (handled internally)', () => {
    expect(() => sanitizeFilter('users', { anything: 'works' }, 'mongo')).not.toThrow();
  });

  it('validates SQL fields', () => {
    registerFields('users', ['name']);
    expect(() => sanitizeFilter('users', { password: '123' }, 'sql')).toThrow(StrictDBError);
  });

  it('validates ES fields', () => {
    expect(() => sanitizeFilter('users', { _id: '123' }, 'elastic')).toThrow(StrictDBError);
  });
});

// ─── Custom Sanitize Rules ──────────────────────────────────────────────────

describe('applySanitizeRules', () => {
  it('returns data unchanged when rules is empty', () => {
    const data = { name: 'Tim', age: 30 };
    const result = applySanitizeRules(data, 'users', []);
    expect(result).toEqual({ name: 'Tim', age: 30 });
  });

  it('applies transform to all fields when field is undefined', () => {
    const result = applySanitizeRules(
      { name: '  Tim  ', email: '  tim@test.com  ' },
      'users',
      [{ transform: (v) => typeof v === 'string' ? v.trim() : v }],
    );
    expect(result).toEqual({ name: 'Tim', email: 'tim@test.com' });
  });

  it('applies transform to all fields when field is "*"', () => {
    const result = applySanitizeRules(
      { name: '<b>Tim</b>', bio: '<i>Hello</i>' },
      'users',
      [{ field: '*', transform: (v) => typeof v === 'string' ? v.replace(/<[^>]*>/g, '') : v }],
    );
    expect(result).toEqual({ name: 'Tim', bio: 'Hello' });
  });

  it('applies transform to a single named field', () => {
    const result = applySanitizeRules(
      { email: 'TIM@TEST.COM', name: 'Tim' },
      'users',
      [{ field: 'email', transform: (v) => typeof v === 'string' ? v.toLowerCase() : v }],
    );
    expect(result).toEqual({ email: 'tim@test.com', name: 'Tim' });
  });

  it('applies transform to an array of named fields', () => {
    const result = applySanitizeRules(
      { email: 'TIM@TEST.COM', username: 'TIM', role: 'Admin' },
      'users',
      [{ field: ['email', 'username'], transform: (v) => typeof v === 'string' ? v.toLowerCase() : v }],
    );
    expect(result).toEqual({ email: 'tim@test.com', username: 'tim', role: 'Admin' });
  });

  it('does not mutate input data', () => {
    const data = { name: '  Tim  ' };
    applySanitizeRules(data, 'users', [{ transform: (v) => typeof v === 'string' ? v.trim() : v }]);
    expect(data.name).toBe('  Tim  ');
  });

  it('skips fields not present in data', () => {
    const result = applySanitizeRules(
      { name: 'Tim' },
      'users',
      [{ field: 'email', transform: () => 'should not appear' }],
    );
    expect(result).toEqual({ name: 'Tim' });
  });

  it('passes field name and collection to transform', () => {
    const calls: Array<{ field: string; collection: string }> = [];
    applySanitizeRules(
      { name: 'Tim' },
      'users',
      [{ transform: (v, field, collection) => { calls.push({ field, collection }); return v; } }],
    );
    expect(calls).toEqual([{ field: 'name', collection: 'users' }]);
  });
});
