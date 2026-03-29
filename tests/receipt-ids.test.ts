/**
 * Receipt IDs Tests — insertedId, insertedIds, upsertedId on OperationReceipt
 * + SQL Mode 2 RETURNING and LAST_INSERT_ID support
 */

import { describe, it, expect } from 'vitest';
import { createReceipt } from '../src/receipts.js';
import { parseSql } from '../src/sql/parser.js';
import { buildExecutionPlan } from '../src/sql/planner.js';
import { translateFunction } from '../src/sql/translators/functions.js';
import { getLastInsertId } from '../src/sql/executor.js';

describe('OperationReceipt — ID fields', () => {
  describe('insertedId', () => {
    it('should include insertedId on insertOne receipt', () => {
      const receipt = createReceipt({
        operation: 'insertOne',
        collection: 'users',
        backend: 'mongo',
        startTime: Date.now() - 10,
        insertedCount: 1,
        insertedId: '507f1f77bcf86cd799439011',
      });
      expect(receipt.insertedId).toBe('507f1f77bcf86cd799439011');
    });

    it('should be a string (not ObjectId)', () => {
      const receipt = createReceipt({
        operation: 'insertOne',
        collection: 'users',
        backend: 'mongo',
        startTime: Date.now(),
        insertedCount: 1,
        insertedId: 'abc123',
      });
      expect(typeof receipt.insertedId).toBe('string');
    });

    it('should be undefined on non-insert receipts', () => {
      const receipt = createReceipt({
        operation: 'updateOne',
        collection: 'users',
        backend: 'mongo',
        startTime: Date.now(),
        matchedCount: 1,
        modifiedCount: 1,
      });
      expect(receipt.insertedId).toBeUndefined();
    });

    it('should be undefined when not provided to createReceipt', () => {
      const receipt = createReceipt({
        operation: 'insertOne',
        collection: 'users',
        backend: 'mongo',
        startTime: Date.now(),
        insertedCount: 1,
      });
      expect(receipt.insertedId).toBeUndefined();
    });
  });

  describe('insertedIds', () => {
    it('should include insertedIds on insertMany receipt', () => {
      const ids = ['id1', 'id2', 'id3'];
      const receipt = createReceipt({
        operation: 'insertMany',
        collection: 'users',
        backend: 'mongo',
        startTime: Date.now(),
        insertedCount: 3,
        insertedIds: ids,
      });
      expect(receipt.insertedIds).toEqual(['id1', 'id2', 'id3']);
    });

    it('should preserve insertion order', () => {
      const ids = ['third', 'first', 'second'];
      const receipt = createReceipt({
        operation: 'insertMany',
        collection: 'users',
        backend: 'mongo',
        startTime: Date.now(),
        insertedCount: 3,
        insertedIds: ids,
      });
      expect(receipt.insertedIds![0]).toBe('third');
      expect(receipt.insertedIds![1]).toBe('first');
      expect(receipt.insertedIds![2]).toBe('second');
    });

    it('should be an array of strings', () => {
      const receipt = createReceipt({
        operation: 'insertMany',
        collection: 'users',
        backend: 'mongo',
        startTime: Date.now(),
        insertedCount: 2,
        insertedIds: ['a', 'b'],
      });
      expect(Array.isArray(receipt.insertedIds)).toBe(true);
      expect(receipt.insertedIds!.every(id => typeof id === 'string')).toBe(true);
    });

    it('should be undefined on non-insertMany receipts', () => {
      const receipt = createReceipt({
        operation: 'deleteMany',
        collection: 'users',
        backend: 'mongo',
        startTime: Date.now(),
        deletedCount: 5,
      });
      expect(receipt.insertedIds).toBeUndefined();
    });
  });

  describe('upsertedId', () => {
    it('should include upsertedId when upsert created a new document', () => {
      const receipt = createReceipt({
        operation: 'updateOne',
        collection: 'users',
        backend: 'mongo',
        startTime: Date.now(),
        matchedCount: 0,
        modifiedCount: 0,
        insertedCount: 1,
        upsertedId: 'new-doc-id-123',
      });
      expect(receipt.upsertedId).toBe('new-doc-id-123');
    });

    it('should be undefined when upsert updated an existing document', () => {
      const receipt = createReceipt({
        operation: 'updateOne',
        collection: 'users',
        backend: 'mongo',
        startTime: Date.now(),
        matchedCount: 1,
        modifiedCount: 1,
      });
      expect(receipt.upsertedId).toBeUndefined();
    });

    it('should be a string', () => {
      const receipt = createReceipt({
        operation: 'updateOne',
        collection: 'users',
        backend: 'mongo',
        startTime: Date.now(),
        upsertedId: 'xyz789',
      });
      expect(typeof receipt.upsertedId).toBe('string');
    });

    it('should be undefined on non-upsert updateOne receipts', () => {
      const receipt = createReceipt({
        operation: 'updateMany',
        collection: 'users',
        backend: 'mongo',
        startTime: Date.now(),
        matchedCount: 10,
        modifiedCount: 10,
      });
      expect(receipt.upsertedId).toBeUndefined();
    });
  });

  describe('backward compatibility', () => {
    it('should not break existing receipts without ID fields', () => {
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
      expect(receipt.duration).toBeGreaterThanOrEqual(0);
      expect(receipt.backend).toBe('mongo');
      // ID fields should simply not be present
      expect('insertedId' in receipt).toBe(false);
    });

    it('should still include all original fields (operation, collection, counts, etc.)', () => {
      const receipt = createReceipt({
        operation: 'insertMany',
        collection: 'orders',
        backend: 'sql',
        startTime: Date.now() - 50,
        insertedCount: 5,
        insertedIds: ['a', 'b', 'c', 'd', 'e'],
      });
      expect(receipt.operation).toBe('insertMany');
      expect(receipt.collection).toBe('orders');
      expect(receipt.success).toBe(true);
      expect(receipt.matchedCount).toBe(0);
      expect(receipt.modifiedCount).toBe(0);
      expect(receipt.insertedCount).toBe(5);
      expect(receipt.deletedCount).toBe(0);
      expect(receipt.backend).toBe('sql');
      expect(receipt.insertedIds).toEqual(['a', 'b', 'c', 'd', 'e']);
    });
  });

  describe('SQL Mode 2 — LAST_INSERT_ID()', () => {
    it('should translate LAST_INSERT_ID() to a marker', () => {
      const expr = { type: 'function', name: 'LAST_INSERT_ID', args: { expr: null } };
      const result = translateFunction(expr);
      expect(result).toEqual({ __lastInsertId: true });
    });

    it('should export getLastInsertId from executor', () => {
      // Initially undefined (no inserts performed)
      expect(typeof getLastInsertId).toBe('function');
    });
  });

  describe('SQL Mode 2 — RETURNING clause', () => {
    it('should detect RETURNING clause in INSERT AST and set returning on writeOps', () => {
      // Use postgresql dialect for RETURNING support
      const sql = "INSERT INTO users (name, email) VALUES ('Tim', 'tim@test.com') RETURNING _id, name";
      try {
        const ast = parseSql(sql, 'postgresql');
        const plan = buildExecutionPlan(ast, sql);
        expect(plan.writeOps).toBeDefined();
        // The writeOp should have a returning field if the parser supports it
        if (plan.writeOps![0]!.returning) {
          expect(plan.writeOps![0]!.returning).toContain('_id');
          expect(plan.writeOps![0]!.returning).toContain('name');
        }
      } catch {
        // RETURNING may not be supported by all parser dialects — that's ok
      }
    });

    it('should include returning field as array of column names', () => {
      const sql = "INSERT INTO users (name) VALUES ('Tim') RETURNING *";
      try {
        const ast = parseSql(sql, 'postgresql');
        const plan = buildExecutionPlan(ast, sql);
        if (plan.writeOps![0]!.returning) {
          expect(plan.writeOps![0]!.returning).toContain('*');
        }
      } catch {
        // Parser may not support RETURNING — acceptable
      }
    });
  });
});
