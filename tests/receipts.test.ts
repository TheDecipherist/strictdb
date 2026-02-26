/**
 * Receipt Tests — Structured operation receipts
 */

import { describe, it, expect } from 'vitest';
import { createReceipt } from '../src/receipts.js';

describe('createReceipt', () => {
  it('creates insert receipt', () => {
    const receipt = createReceipt({
      operation: 'insertOne',
      collection: 'users',
      backend: 'mongo',
      startTime: Date.now() - 12,
      insertedCount: 1,
    });

    expect(receipt.operation).toBe('insertOne');
    expect(receipt.collection).toBe('users');
    expect(receipt.success).toBe(true);
    expect(receipt.insertedCount).toBe(1);
    expect(receipt.matchedCount).toBe(0);
    expect(receipt.modifiedCount).toBe(0);
    expect(receipt.deletedCount).toBe(0);
    expect(receipt.backend).toBe('mongo');
    expect(receipt.duration).toBeGreaterThanOrEqual(0);
  });

  it('creates update receipt', () => {
    const receipt = createReceipt({
      operation: 'updateMany',
      collection: 'users',
      backend: 'sql',
      startTime: Date.now() - 50,
      matchedCount: 100,
      modifiedCount: 42,
    });

    expect(receipt.operation).toBe('updateMany');
    expect(receipt.matchedCount).toBe(100);
    expect(receipt.modifiedCount).toBe(42);
    expect(receipt.backend).toBe('sql');
  });

  it('creates delete receipt', () => {
    const receipt = createReceipt({
      operation: 'deleteMany',
      collection: 'sessions',
      backend: 'elastic',
      startTime: Date.now() - 30,
      deletedCount: 500,
    });

    expect(receipt.deletedCount).toBe(500);
    expect(receipt.backend).toBe('elastic');
  });

  it('creates batch receipt', () => {
    const receipt = createReceipt({
      operation: 'batch',
      collection: 'batch',
      backend: 'mongo',
      startTime: Date.now() - 100,
      insertedCount: 5,
      modifiedCount: 3,
      deletedCount: 2,
    });

    expect(receipt.operation).toBe('batch');
    expect(receipt.insertedCount).toBe(5);
    expect(receipt.modifiedCount).toBe(3);
    expect(receipt.deletedCount).toBe(2);
  });

  it('allows explicit success: false', () => {
    const receipt = createReceipt({
      operation: 'insertOne',
      collection: 'users',
      backend: 'sql',
      startTime: Date.now(),
      success: false,
    });

    expect(receipt.success).toBe(false);
  });
});
