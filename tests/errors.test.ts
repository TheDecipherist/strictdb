/**
 * Error System Tests — Normalization + Self-Correcting Messages
 */

import { describe, it, expect } from 'vitest';
import {
  StrictDBError,
  mapMongoError,
  mapSqlError,
  mapElasticError,
  mapNativeError,
  unknownMethodError,
  unknownOperatorError,
  collectionNotFoundError,
} from '../src/errors.js';

describe('StrictDBError', () => {
  it('creates error with all fields', () => {
    const err = new StrictDBError({
      code: 'DUPLICATE_KEY',
      message: 'Duplicate key',
      fix: 'Use updateOne instead',
      backend: 'mongo',
      collection: 'users',
      operation: 'insertOne',
    });

    expect(err.code).toBe('DUPLICATE_KEY');
    expect(err.backend).toBe('mongo');
    expect(err.collection).toBe('users');
    expect(err.operation).toBe('insertOne');
    expect(err.retryable).toBe(false);
    expect(err.fix).toBe('Use updateOne instead');
    expect(err.message).toContain('Duplicate key');
    expect(err.message).toContain('Fix:');
    expect(err.timestamp).toBeInstanceOf(Date);
    expect(err.name).toBe('StrictDBError');
  });

  it('defaults retryable to false', () => {
    const err = new StrictDBError({ code: 'INTERNAL_ERROR', message: 'test', fix: 'fix', backend: 'sql' });
    expect(err.retryable).toBe(false);
  });

  it('accepts retryable: true', () => {
    const err = new StrictDBError({ code: 'CONNECTION_LOST', message: 'test', fix: 'fix', backend: 'mongo', retryable: true });
    expect(err.retryable).toBe(true);
  });
});

describe('mapMongoError', () => {
  it('maps E11000 to DUPLICATE_KEY', () => {
    const err = mapMongoError({ code: 11000, message: 'E11000 duplicate key error index: users.email_1' }, 'users', 'insertOne');
    expect(err.code).toBe('DUPLICATE_KEY');
    expect(err.retryable).toBe(false);
    expect(err.fix).toContain('updateOne');
  });

  it('maps topology closed to CONNECTION_LOST', () => {
    const err = mapMongoError({ message: 'topology was destroyed' }, 'users');
    expect(err.code).toBe('CONNECTION_LOST');
    expect(err.retryable).toBe(true);
  });

  it('maps auth failure to AUTHENTICATION_FAILED', () => {
    const err = mapMongoError({ code: 18, message: 'Authentication failed' });
    expect(err.code).toBe('AUTHENTICATION_FAILED');
    expect(err.retryable).toBe(false);
  });

  it('maps ECONNREFUSED to CONNECTION_FAILED', () => {
    const err = mapMongoError({ message: 'connect ECONNREFUSED' });
    expect(err.code).toBe('CONNECTION_FAILED');
    expect(err.retryable).toBe(true);
  });

  it('maps timeout to TIMEOUT', () => {
    const err = mapMongoError({ message: 'operation timed out' }, 'users');
    expect(err.code).toBe('TIMEOUT');
    expect(err.retryable).toBe(true);
  });

  it('falls back to INTERNAL_ERROR', () => {
    const err = mapMongoError({ message: 'something weird' });
    expect(err.code).toBe('INTERNAL_ERROR');
  });
});

describe('mapSqlError', () => {
  it('maps PG 23505 to DUPLICATE_KEY', () => {
    const err = mapSqlError({ code: '23505', message: 'unique violation' }, 'users');
    expect(err.code).toBe('DUPLICATE_KEY');
  });

  it('maps MySQL ER_DUP_ENTRY to DUPLICATE_KEY', () => {
    const err = mapSqlError({ code: 'ER_DUP_ENTRY', message: 'Duplicate entry' }, 'users');
    expect(err.code).toBe('DUPLICATE_KEY');
  });

  it('maps SQLite UNIQUE constraint to DUPLICATE_KEY', () => {
    const err = mapSqlError({ message: 'UNIQUE constraint failed: users.email' }, 'users');
    expect(err.code).toBe('DUPLICATE_KEY');
  });

  it('maps ECONNREFUSED to CONNECTION_FAILED', () => {
    const err = mapSqlError({ code: 'ECONNREFUSED', message: 'Connection refused' });
    expect(err.code).toBe('CONNECTION_FAILED');
    expect(err.retryable).toBe(true);
  });

  it('maps PG 57014 to TIMEOUT', () => {
    const err = mapSqlError({ code: '57014', message: 'canceling statement due to statement timeout' });
    expect(err.code).toBe('TIMEOUT');
  });

  it('maps auth failure to AUTHENTICATION_FAILED', () => {
    const err = mapSqlError({ code: '28P01', message: 'password authentication failed' });
    expect(err.code).toBe('AUTHENTICATION_FAILED');
  });

  it('maps table not found to COLLECTION_NOT_FOUND', () => {
    const err = mapSqlError({ code: '42P01', message: 'relation "users" does not exist' }, 'users');
    expect(err.code).toBe('COLLECTION_NOT_FOUND');
    expect(err.fix).toContain('ensureCollections');
  });
});

describe('mapElasticError', () => {
  it('maps 409 to DUPLICATE_KEY', () => {
    const err = mapElasticError({ statusCode: 409, message: 'version conflict' }, 'users');
    expect(err.code).toBe('DUPLICATE_KEY');
  });

  it('maps 401 to AUTHENTICATION_FAILED', () => {
    const err = mapElasticError({ statusCode: 401, message: 'Unauthorized' });
    expect(err.code).toBe('AUTHENTICATION_FAILED');
  });

  it('maps 403 to AUTHENTICATION_FAILED', () => {
    const err = mapElasticError({ statusCode: 403, message: 'Forbidden' });
    expect(err.code).toBe('AUTHENTICATION_FAILED');
  });

  it('maps 404 to COLLECTION_NOT_FOUND', () => {
    const err = mapElasticError({ statusCode: 404, message: 'index not found' }, 'users');
    expect(err.code).toBe('COLLECTION_NOT_FOUND');
  });

  it('maps ConnectionError to CONNECTION_FAILED', () => {
    const err = mapElasticError({ message: 'ConnectionError: connect ECONNREFUSED' });
    expect(err.code).toBe('CONNECTION_FAILED');
    expect(err.retryable).toBe(true);
  });

  it('maps TimeoutError to TIMEOUT', () => {
    const err = mapElasticError({ message: 'TimeoutError: Request timed out' });
    expect(err.code).toBe('TIMEOUT');
    expect(err.retryable).toBe(true);
  });
});

describe('mapNativeError', () => {
  it('returns StrictDBError as-is', () => {
    const original = new StrictDBError({ code: 'DUPLICATE_KEY', message: 'dup', fix: 'fix', backend: 'mongo' });
    const result = mapNativeError('mongo', original);
    expect(result).toBe(original);
  });

  it('delegates to backend-specific mapper', () => {
    const result = mapNativeError('sql', { code: '23505', message: 'unique violation' }, 'users');
    expect(result.code).toBe('DUPLICATE_KEY');
    expect(result.backend).toBe('sql');
  });
});

describe('Self-correcting helpers', () => {
  it('suggests queryMany for find()', () => {
    const err = unknownMethodError('find');
    expect(err.code).toBe('UNSUPPORTED_OPERATION');
    expect(err.fix).toContain('queryMany');
  });

  it('suggests queryOne for findOne()', () => {
    const err = unknownMethodError('findOne');
    expect(err.fix).toContain('queryOne');
  });

  it('suggests batch for bulkWrite()', () => {
    const err = unknownMethodError('bulkWrite');
    expect(err.fix).toContain('batch');
  });

  it('suggests correct filter syntax for $match', () => {
    const err = unknownOperatorError('$match');
    expect(err.fix).toContain('filter syntax');
    expect(err.fix).toContain('$match is a MongoDB aggregation concept');
  });

  it('suggests typo correction for collection names', () => {
    const err = collectionNotFoundError('usres', ['users', 'orders', 'products']);
    expect(err.fix).toContain('Did you mean "users"');
  });

  it('lists registered collections when no match', () => {
    const err = collectionNotFoundError('xyz', ['users', 'orders']);
    expect(err.fix).toContain('users, orders');
  });
});
