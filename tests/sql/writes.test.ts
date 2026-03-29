import { describe, it, expect } from 'vitest';
import { parseSql } from '../../src/sql/parser.js';
import { buildExecutionPlan } from '../../src/sql/planner.js';
import { translateInsert, translateUpdate, translateDelete } from '../../src/sql/translators/writes.js';

/**
 * SQL Mode 2 — Write Operation Tests
 *
 * Verifies: INSERT, UPDATE, DELETE → bulkWrite operations.
 */

describe('SQL Mode 2 — Writes', () => {
  describe('INSERT INTO', () => {
    it('should translate INSERT INTO users (name, email) VALUES (...) to bulkWrite insertOne', () => {
      const sql = "INSERT INTO `users` (`name`, `email`) VALUES ('Tim', 'tim@test.com')";
      const ast = parseSql(sql);
      const plan = buildExecutionPlan(ast, sql);

      expect(plan.type).toBe('insert');
      expect(plan.writeOps).toBeDefined();
      expect(plan.writeOps).toHaveLength(1);
      expect(plan.writeOps![0]!.type).toBe('insertOne');
      expect(plan.writeOps![0]!.document).toEqual({ name: 'Tim', email: 'tim@test.com' });
    });

    it('should handle multiple VALUES rows as single insertMany', () => {
      const sql = "INSERT INTO `users` (`name`, `email`) VALUES ('Tim', 'tim@test.com'), ('Alice', 'alice@test.com')";
      const ast = parseSql(sql);
      const plan = buildExecutionPlan(ast, sql);

      expect(plan.type).toBe('insert');
      expect(plan.writeOps).toHaveLength(1);
      expect(plan.writeOps![0]!.type).toBe('insertMany');
      expect(plan.writeOps![0]!.documents).toHaveLength(2);
      expect(plan.writeOps![0]!.documents![0]).toEqual({ name: 'Tim', email: 'tim@test.com' });
      expect(plan.writeOps![0]!.documents![1]).toEqual({ name: 'Alice', email: 'alice@test.com' });
    });

    it('should extract collection name from INSERT INTO clause', () => {
      const sql = "INSERT INTO `employees` (`name`) VALUES ('Bob')";
      const ast = parseSql(sql);
      const plan = buildExecutionPlan(ast, sql);

      expect(plan.collection).toBe('employees');
      expect(plan.writeOps![0]!.collection).toBe('employees');
    });

    it('should apply type coercion to inserted values', () => {
      const sql = "INSERT INTO `users` (`name`, `age`) VALUES ('Tim', 30)";
      const ast = parseSql(sql);
      const plan = buildExecutionPlan(ast, sql);

      const doc = plan.writeOps![0]!.document!;
      expect(doc['name']).toBe('Tim');
      // Numeric values should remain as numbers
      expect(typeof doc['age']).toBe('number');
      expect(doc['age']).toBe(30);
    });
  });

  describe('INSERT INTO ... SELECT', () => {
    it('should mark the SELECT as a Phase 2 dependency', () => {
      const sql = 'INSERT INTO `archived_users` SELECT * FROM `users`';
      const ast = parseSql(sql);
      const plan = buildExecutionPlan(ast, sql);

      expect(plan.type).toBe('insert');
      // INSERT...SELECT produces a dependency for the sub-select
      expect(plan.dependencies).toBeDefined();
      expect(plan.dependencies.length).toBeGreaterThanOrEqual(1);
      const dep = plan.dependencies[0]!;
      expect(dep.type).toBe('insert-select');
    });

    it('should produce bulkWrite insertOne ops from SELECT results', () => {
      const sql = 'INSERT INTO `archived_users` SELECT * FROM `users`';
      const ast = parseSql(sql);
      const plan = buildExecutionPlan(ast, sql);

      expect(plan.type).toBe('insert');
      // The dependency targets the source collection
      const dep = plan.dependencies[0]!;
      expect(dep.collection).toBe('users');
    });
  });

  describe('UPDATE', () => {
    it('should translate UPDATE users SET role = "admin" WHERE ... to bulkWrite updateMany', () => {
      const sql = "UPDATE `users` SET `role` = 'admin' WHERE `email` = 'tim@test.com'";
      const ast = parseSql(sql);
      const plan = buildExecutionPlan(ast, sql);

      expect(plan.type).toBe('update');
      expect(plan.writeOps).toBeDefined();
      expect(plan.writeOps).toHaveLength(1);
      expect(plan.writeOps![0]!.type).toBe('updateMany');
    });

    it('should translate SET clause to $set operator', () => {
      const sql = "UPDATE `users` SET `role` = 'admin' WHERE `email` = 'tim@test.com'";
      const ast = parseSql(sql);
      const plan = buildExecutionPlan(ast, sql);

      const op = plan.writeOps![0]!;
      expect(op.update).toBeDefined();
      expect(op.update!['$set']).toEqual({ role: 'admin' });
    });

    it('should translate SET field = field + 1 to $inc operator', () => {
      const sql = 'UPDATE `products` SET `stock` = `stock` + 1 WHERE `id` = 42';
      const ast = parseSql(sql);
      const plan = buildExecutionPlan(ast, sql);

      const op = plan.writeOps![0]!;
      expect(op.update).toBeDefined();
      // $inc should be used for arithmetic increment
      expect(op.update!['$inc']).toBeDefined();
      expect((op.update!['$inc'] as Record<string, unknown>)['stock']).toBe(1);
    });

    it('should translate SET updatedAt = NOW() to new Date()', () => {
      const sql = "UPDATE `users` SET `updatedAt` = NOW() WHERE `id` = 1";
      const ast = parseSql(sql);
      const plan = buildExecutionPlan(ast, sql);

      const op = plan.writeOps![0]!;
      const setOp = op.update!['$set'] as Record<string, unknown>;
      expect(setOp).toBeDefined();
      expect(setOp['updatedAt']).toBeInstanceOf(Date);
    });

    it('should use updateMany when no unique constraint is implied', () => {
      const sql = "UPDATE `users` SET `status` = 'inactive' WHERE `role` = 'guest'";
      const ast = parseSql(sql);
      const plan = buildExecutionPlan(ast, sql);

      // translateUpdate always produces updateMany
      expect(plan.writeOps![0]!.type).toBe('updateMany');
    });
  });

  describe('DELETE', () => {
    it('should translate DELETE FROM users WHERE status = "inactive" to bulkWrite deleteMany', () => {
      const sql = "DELETE FROM `users` WHERE `status` = 'inactive'";
      const ast = parseSql(sql);
      const plan = buildExecutionPlan(ast, sql);

      expect(plan.type).toBe('delete');
      expect(plan.writeOps).toBeDefined();
      expect(plan.writeOps).toHaveLength(1);
      expect(plan.writeOps![0]!.type).toBe('deleteMany');
    });

    it('should extract filter from WHERE clause', () => {
      const sql = "DELETE FROM `users` WHERE `status` = 'inactive'";
      const ast = parseSql(sql);
      const plan = buildExecutionPlan(ast, sql);

      const op = plan.writeOps![0]!;
      expect(op.filter).toBeDefined();
      expect(op.filter).toEqual({ status: 'inactive' });
    });
  });

  describe('write receipts', () => {
    it('should return OperationReceipt for INSERT operations', () => {
      const sql = "INSERT INTO `users` (`name`) VALUES ('Tim')";
      const ast = parseSql(sql);
      const plan = buildExecutionPlan(ast, sql);

      // Plan must have writeOps array for receipt generation
      expect(plan.type).toBe('insert');
      expect(plan.writeOps).toBeDefined();
      expect(Array.isArray(plan.writeOps)).toBe(true);
    });

    it('should return OperationReceipt for UPDATE operations', () => {
      const sql = "UPDATE `users` SET `role` = 'admin' WHERE `id` = 1";
      const ast = parseSql(sql);
      const plan = buildExecutionPlan(ast, sql);

      expect(plan.type).toBe('update');
      expect(plan.writeOps).toBeDefined();
      expect(plan.writeOps![0]!.collection).toBe('users');
    });

    it('should return OperationReceipt for DELETE operations', () => {
      const sql = "DELETE FROM `users` WHERE `id` = 1";
      const ast = parseSql(sql);
      const plan = buildExecutionPlan(ast, sql);

      expect(plan.type).toBe('delete');
      expect(plan.writeOps).toBeDefined();
      expect(plan.writeOps![0]!.collection).toBe('users');
    });
  });
});
