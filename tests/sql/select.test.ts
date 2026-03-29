import { describe, it, expect } from 'vitest';
import { parseSql } from '../../src/sql/parser.js';
import { buildExecutionPlan } from '../../src/sql/planner.js';
import {
  translateWhere,
  likeToRegex,
  extractCollection,
} from '../../src/sql/translators/select.js';

/**
 * SQL Mode 2 — SELECT Translation Tests
 *
 * Verifies: SELECT, FROM, WHERE, ORDER BY, LIMIT, OFFSET, DISTINCT, aliases, projections.
 * All tests verify the MongoDB aggregate pipeline stages produced from SQL input.
 */

describe('SQL Mode 2 — SELECT', () => {
  describe('basic SELECT', () => {
    it('should translate SELECT * FROM users LIMIT 10 to a pipeline with $limit: 10', () => {
      const sql = 'SELECT * FROM users LIMIT 10';
      const ast = parseSql(sql);
      const plan = buildExecutionPlan(ast, sql);
      const stages = plan.pipelines[0].stages;

      expect(stages).toContainEqual({ $limit: 10 });
    });

    it('should translate SELECT name, email FROM users LIMIT 10 to $project stage with specific fields', () => {
      const sql = 'SELECT name, email FROM users LIMIT 10';
      const ast = parseSql(sql);
      const plan = buildExecutionPlan(ast, sql);
      const stages = plan.pipelines[0].stages;

      const projectStage = stages.find(s => '$project' in s) as Record<string, Record<string, unknown>>;
      expect(projectStage).toBeDefined();
      expect(projectStage!['$project']).toMatchObject({ name: 1, email: 1, _id: 0 });
    });

    it('should extract collection name from FROM clause', () => {
      const sql = 'SELECT * FROM orders LIMIT 5';
      const ast = parseSql(sql);
      const plan = buildExecutionPlan(ast, sql);

      expect(plan.collection).toBe('orders');
    });

    it('should set plan type to select', () => {
      const sql = 'SELECT * FROM users LIMIT 10';
      const ast = parseSql(sql);
      const plan = buildExecutionPlan(ast, sql);

      expect(plan.type).toBe('select');
    });

    it('should produce no $project stage for SELECT *', () => {
      const sql = 'SELECT * FROM users LIMIT 10';
      const ast = parseSql(sql);
      const plan = buildExecutionPlan(ast, sql);
      const stages = plan.pipelines[0].stages;

      expect(stages.some(s => '$project' in s)).toBe(false);
    });
  });

  describe('WHERE clause — comparison operators', () => {
    it('should translate WHERE age > 25 to $match: { age: { $gt: 25 } }', () => {
      const sql = 'SELECT * FROM users WHERE age > 25 LIMIT 10';
      const ast = parseSql(sql);
      const plan = buildExecutionPlan(ast, sql);
      const stages = plan.pipelines[0].stages;

      expect(stages).toContainEqual({ $match: { age: { $gt: 25 } } });
    });

    it("should translate WHERE status = 'active' to $match: { status: 'active' }", () => {
      const sql = "SELECT * FROM users WHERE status = 'active' LIMIT 10";
      const ast = parseSql(sql);
      const plan = buildExecutionPlan(ast, sql);
      const stages = plan.pipelines[0].stages;

      expect(stages).toContainEqual({ $match: { status: 'active' } });
    });

    it("should translate WHERE status != 'deleted' to $match: { status: { $ne: 'deleted' } }", () => {
      const sql = "SELECT * FROM users WHERE status != 'deleted' LIMIT 10";
      const ast = parseSql(sql);
      const plan = buildExecutionPlan(ast, sql);
      const stages = plan.pipelines[0].stages;

      expect(stages).toContainEqual({ $match: { status: { $ne: 'deleted' } } });
    });

    it('should translate WHERE age >= 18 to $match: { age: { $gte: 18 } }', () => {
      const sql = 'SELECT * FROM users WHERE age >= 18 LIMIT 10';
      const ast = parseSql(sql);
      const plan = buildExecutionPlan(ast, sql);
      const stages = plan.pipelines[0].stages;

      const matchStage = stages.find(s => '$match' in s) as Record<string, Record<string, unknown>>;
      expect(matchStage).toBeDefined();
      const match = matchStage!['$match'] as Record<string, unknown>;
      expect(match['age']).toMatchObject({ $gte: 18 });
    });

    it('should translate WHERE age <= 65 to $match: { age: { $lte: 65 } }', () => {
      const sql = 'SELECT * FROM users WHERE age <= 65 LIMIT 10';
      const ast = parseSql(sql);
      const plan = buildExecutionPlan(ast, sql);
      const stages = plan.pipelines[0].stages;

      const matchStage = stages.find(s => '$match' in s) as Record<string, Record<string, unknown>>;
      expect(matchStage).toBeDefined();
      const match = matchStage!['$match'] as Record<string, unknown>;
      expect(match['age']).toMatchObject({ $lte: 65 });
    });

    it('should translate WHERE age < 30 to $match: { age: { $lt: 30 } }', () => {
      const sql = 'SELECT * FROM users WHERE age < 30 LIMIT 10';
      const ast = parseSql(sql);
      const plan = buildExecutionPlan(ast, sql);
      const stages = plan.pipelines[0].stages;

      const matchStage = stages.find(s => '$match' in s) as Record<string, Record<string, unknown>>;
      expect(matchStage).toBeDefined();
      const match = matchStage!['$match'] as Record<string, unknown>;
      expect(match['age']).toMatchObject({ $lt: 30 });
    });

    it('should translate compound WHERE with AND to $and array in $match', () => {
      const sql = "SELECT * FROM users WHERE age > 18 AND status = 'active' LIMIT 10";
      const ast = parseSql(sql);
      const plan = buildExecutionPlan(ast, sql);
      const stages = plan.pipelines[0].stages;

      const matchStage = stages.find(s => '$match' in s) as Record<string, Record<string, unknown>>;
      expect(matchStage).toBeDefined();
      const match = matchStage!['$match'] as Record<string, unknown>;
      expect(match).toHaveProperty('$and');
      const andArr = match['$and'] as unknown[];
      expect(andArr).toHaveLength(2);
      expect(andArr).toContainEqual({ age: { $gt: 18 } });
      expect(andArr).toContainEqual({ status: 'active' });
    });

    it('should translate compound WHERE with OR to $or array in $match', () => {
      const sql = "SELECT * FROM users WHERE status = 'active' OR role = 'admin' LIMIT 10";
      const ast = parseSql(sql);
      const plan = buildExecutionPlan(ast, sql);
      const stages = plan.pipelines[0].stages;

      const matchStage = stages.find(s => '$match' in s) as Record<string, Record<string, unknown>>;
      expect(matchStage).toBeDefined();
      const match = matchStage!['$match'] as Record<string, unknown>;
      expect(match).toHaveProperty('$or');
      const orArr = match['$or'] as unknown[];
      expect(orArr).toContainEqual({ status: 'active' });
      expect(orArr).toContainEqual({ role: 'admin' });
    });

    it('should translate nested AND/OR combinations correctly', () => {
      const sql = "SELECT * FROM users WHERE (age > 18 AND age < 65) OR role = 'admin' LIMIT 10";
      const ast = parseSql(sql);
      const plan = buildExecutionPlan(ast, sql);
      const stages = plan.pipelines[0].stages;

      const matchStage = stages.find(s => '$match' in s) as Record<string, Record<string, unknown>>;
      expect(matchStage).toBeDefined();
      const match = matchStage!['$match'] as Record<string, unknown>;
      // Top-level should be $or
      expect(match).toHaveProperty('$or');
      const orArr = match['$or'] as unknown[];
      expect(orArr).toHaveLength(2);
      // First element is the nested $and
      const andPart = orArr[0] as Record<string, unknown>;
      expect(andPart).toHaveProperty('$and');
    });
  });

  describe('WHERE clause — IN / NOT IN', () => {
    it("should translate WHERE role IN ('admin', 'mod') to $match: { role: { $in: [...] } }", () => {
      const sql = "SELECT * FROM users WHERE role IN ('admin', 'mod') LIMIT 10";
      const ast = parseSql(sql);
      const plan = buildExecutionPlan(ast, sql);
      const stages = plan.pipelines[0].stages;

      expect(stages).toContainEqual({
        $match: { role: { $in: ['admin', 'mod'] } },
      });
    });

    it("should translate WHERE role NOT IN ('banned') to $match: { role: { $nin: [...] } }", () => {
      const sql = "SELECT * FROM users WHERE role NOT IN ('banned') LIMIT 10";
      const ast = parseSql(sql);
      const plan = buildExecutionPlan(ast, sql);
      const stages = plan.pipelines[0].stages;

      expect(stages).toContainEqual({
        $match: { role: { $nin: ['banned'] } },
      });
    });
  });

  describe('WHERE clause — BETWEEN', () => {
    it('should translate WHERE age BETWEEN 18 AND 65 to a $match with $gte and $lte', () => {
      const sql = 'SELECT * FROM users WHERE age BETWEEN 18 AND 65 LIMIT 10';
      const ast = parseSql(sql);
      const plan = buildExecutionPlan(ast, sql);
      const stages = plan.pipelines[0].stages;

      const matchStage = stages.find(s => '$match' in s) as Record<string, Record<string, unknown>>;
      expect(matchStage).toBeDefined();
      const match = matchStage!['$match'] as Record<string, unknown>;
      const ageCondition = match['age'] as Record<string, unknown>;
      expect(ageCondition).toHaveProperty('$gte');
      expect(ageCondition).toHaveProperty('$lte');
      // The values contain the BETWEEN bounds (18 and 65)
      const gteVal = ageCondition['$gte'] as { value: number } | number;
      const lteVal = ageCondition['$lte'] as { value: number } | number;
      const gteNum = typeof gteVal === 'object' ? gteVal.value : gteVal;
      const lteNum = typeof lteVal === 'object' ? lteVal.value : lteVal;
      expect(gteNum).toBe(18);
      expect(lteNum).toBe(65);
    });
  });

  describe('WHERE clause — LIKE', () => {
    it('likeToRegex: %Tim% should become .*Tim.* (unanchored)', () => {
      expect(likeToRegex('%Tim%')).toBe('.*Tim.*');
    });

    it('likeToRegex: Tim% should become ^Tim.* (anchored at start)', () => {
      expect(likeToRegex('Tim%')).toBe('^Tim.*');
    });

    it('likeToRegex: %Tim should become .*Tim$ (anchored at end)', () => {
      expect(likeToRegex('%Tim')).toBe('.*Tim$');
    });

    it('likeToRegex: T_m should become ^T.m$ (single char wildcard)', () => {
      expect(likeToRegex('T_m')).toBe('^T.m$');
    });

    it("should translate WHERE name LIKE '%Tim%' to $match with $regex and $options: 'i'", () => {
      const sql = "SELECT * FROM users WHERE name LIKE '%Tim%' LIMIT 10";
      const ast = parseSql(sql);
      const plan = buildExecutionPlan(ast, sql);
      const stages = plan.pipelines[0].stages;

      expect(stages).toContainEqual({
        $match: { name: { $regex: '.*Tim.*', $options: 'i' } },
      });
    });

    it("should translate WHERE name LIKE 'Tim%' to anchored regex", () => {
      const sql = "SELECT * FROM users WHERE name LIKE 'Tim%' LIMIT 10";
      const ast = parseSql(sql);
      const plan = buildExecutionPlan(ast, sql);
      const stages = plan.pipelines[0].stages;

      const matchStage = stages.find(s => '$match' in s) as Record<string, Record<string, unknown>>;
      const match = matchStage!['$match'] as Record<string, unknown>;
      const nameCondition = match['name'] as Record<string, unknown>;
      expect(nameCondition['$regex']).toBe('^Tim.*');
      expect(nameCondition['$options']).toBe('i');
    });

    it("should translate WHERE name LIKE '%Tim' to end-anchored regex", () => {
      const sql = "SELECT * FROM users WHERE name LIKE '%Tim' LIMIT 10";
      const ast = parseSql(sql);
      const plan = buildExecutionPlan(ast, sql);
      const stages = plan.pipelines[0].stages;

      const matchStage = stages.find(s => '$match' in s) as Record<string, Record<string, unknown>>;
      const match = matchStage!['$match'] as Record<string, unknown>;
      const nameCondition = match['name'] as Record<string, unknown>;
      expect(nameCondition['$regex']).toBe('.*Tim$');
    });

    it("should translate WHERE name LIKE 'T_m' to single-char wildcard regex", () => {
      const sql = "SELECT * FROM users WHERE name LIKE 'T_m' LIMIT 10";
      const ast = parseSql(sql);
      const plan = buildExecutionPlan(ast, sql);
      const stages = plan.pipelines[0].stages;

      const matchStage = stages.find(s => '$match' in s) as Record<string, Record<string, unknown>>;
      const match = matchStage!['$match'] as Record<string, unknown>;
      const nameCondition = match['name'] as Record<string, unknown>;
      expect(nameCondition['$regex']).toBe('^T.m$');
    });

    it("should translate WHERE name NOT LIKE '%Tim%' to $not: { $regex, $options }", () => {
      const sql = "SELECT * FROM users WHERE name NOT LIKE '%Tim%' LIMIT 10";
      const ast = parseSql(sql);
      const plan = buildExecutionPlan(ast, sql);
      const stages = plan.pipelines[0].stages;

      const matchStage = stages.find(s => '$match' in s) as Record<string, Record<string, unknown>>;
      const match = matchStage!['$match'] as Record<string, unknown>;
      const nameCondition = match['name'] as Record<string, unknown>;
      expect(nameCondition).toHaveProperty('$not');
      const notPart = nameCondition['$not'] as Record<string, unknown>;
      expect(notPart['$regex']).toBe('.*Tim.*');
      expect(notPart['$options']).toBe('i');
    });
  });

  describe('ORDER BY', () => {
    it('should translate ORDER BY name ASC to $sort: { name: 1 }', () => {
      const sql = 'SELECT * FROM users ORDER BY name ASC LIMIT 10';
      const ast = parseSql(sql);
      const plan = buildExecutionPlan(ast, sql);
      const stages = plan.pipelines[0].stages;

      expect(stages).toContainEqual({ $sort: { name: 1 } });
    });

    it('should translate ORDER BY age DESC to $sort: { age: -1 }', () => {
      const sql = 'SELECT * FROM users ORDER BY age DESC LIMIT 10';
      const ast = parseSql(sql);
      const plan = buildExecutionPlan(ast, sql);
      const stages = plan.pipelines[0].stages;

      expect(stages).toContainEqual({ $sort: { age: -1 } });
    });

    it('should translate multiple ORDER BY fields preserving direction', () => {
      const sql = 'SELECT * FROM users ORDER BY name ASC, age DESC LIMIT 10';
      const ast = parseSql(sql);
      const plan = buildExecutionPlan(ast, sql);
      const stages = plan.pipelines[0].stages;

      expect(stages).toContainEqual({ $sort: { name: 1, age: -1 } });
    });

    it('should place $sort stage before $limit in pipeline', () => {
      const sql = 'SELECT * FROM users ORDER BY name ASC LIMIT 10';
      const ast = parseSql(sql);
      const plan = buildExecutionPlan(ast, sql);
      const stages = plan.pipelines[0].stages;

      const sortIdx = stages.findIndex(s => '$sort' in s);
      const limitIdx = stages.findIndex(s => '$limit' in s);
      expect(sortIdx).toBeLessThan(limitIdx);
    });
  });

  describe('LIMIT and OFFSET', () => {
    it('should translate LIMIT 50 to $limit: 50 stage', () => {
      const sql = 'SELECT * FROM users LIMIT 50';
      const ast = parseSql(sql);
      const plan = buildExecutionPlan(ast, sql);
      const stages = plan.pipelines[0].stages;

      expect(stages).toContainEqual({ $limit: 50 });
    });

    it('should translate LIMIT 50 OFFSET 10 to both $skip and $limit stages', () => {
      const sql = 'SELECT * FROM users LIMIT 50 OFFSET 10';
      const ast = parseSql(sql);
      const plan = buildExecutionPlan(ast, sql);
      const stages = plan.pipelines[0].stages;

      expect(stages.some(s => '$skip' in s)).toBe(true);
      expect(stages.some(s => '$limit' in s)).toBe(true);
    });

    it('should place $skip before $limit when both are present', () => {
      const sql = 'SELECT * FROM users LIMIT 50 OFFSET 10';
      const ast = parseSql(sql);
      const plan = buildExecutionPlan(ast, sql);
      const stages = plan.pipelines[0].stages;

      const skipIdx = stages.findIndex(s => '$skip' in s);
      const limitIdx = stages.findIndex(s => '$limit' in s);
      expect(skipIdx).toBeGreaterThanOrEqual(0);
      expect(limitIdx).toBeGreaterThanOrEqual(0);
      expect(skipIdx).toBeLessThan(limitIdx);
    });
  });

  describe('DISTINCT', () => {
    it('should allow SELECT DISTINCT without throwing (aggregate exemption-like pass)', () => {
      // DISTINCT with LIMIT is allowed by guardrails
      const sql = 'SELECT DISTINCT status FROM users LIMIT 100';
      const ast = parseSql(sql);
      const plan = buildExecutionPlan(ast, sql);

      expect(plan).toBeDefined();
      expect(plan.pipelines[0].stages.length).toBeGreaterThan(0);
    });

    it('should include $limit stage for SELECT DISTINCT with LIMIT', () => {
      const sql = 'SELECT DISTINCT status FROM users LIMIT 100';
      const ast = parseSql(sql);
      const plan = buildExecutionPlan(ast, sql);
      const stages = plan.pipelines[0].stages;

      expect(stages).toContainEqual({ $limit: 100 });
    });

    it('should handle SELECT DISTINCT with multiple columns', () => {
      const sql = 'SELECT DISTINCT status, role FROM users LIMIT 100';
      const ast = parseSql(sql);
      const plan = buildExecutionPlan(ast, sql);

      expect(plan).toBeDefined();
      expect(plan.collection).toBe('users');
    });
  });

  describe('column aliases (AS)', () => {
    it('should translate SELECT name AS full_name to $project with rename', () => {
      const sql = 'SELECT name AS full_name FROM users LIMIT 10';
      const ast = parseSql(sql);
      const plan = buildExecutionPlan(ast, sql);
      const stages = plan.pipelines[0].stages;

      const projectStage = stages.find(s => '$project' in s) as Record<string, Record<string, unknown>>;
      expect(projectStage).toBeDefined();
      expect(projectStage!['$project']).toMatchObject({ full_name: '$name' });
    });

    it('should handle table aliases (FROM users u) without breaking column resolution', () => {
      const sql = 'SELECT u.name FROM users u LIMIT 10';
      const ast = parseSql(sql);
      const plan = buildExecutionPlan(ast, sql);
      const stages = plan.pipelines[0].stages;

      const projectStage = stages.find(s => '$project' in s) as Record<string, Record<string, unknown>>;
      expect(projectStage).toBeDefined();
      expect(projectStage!['$project']).toMatchObject({ name: 1 });
    });
  });

  describe('IS NULL / IS NOT NULL', () => {
    it('should translate WHERE deleted_at IS NULL to $or: [null, $exists: false]', () => {
      const sql = 'SELECT * FROM users WHERE deleted_at IS NULL LIMIT 10';
      const ast = parseSql(sql);
      const plan = buildExecutionPlan(ast, sql);
      const stages = plan.pipelines[0].stages;

      expect(stages).toContainEqual({
        $match: {
          $or: [
            { deleted_at: null },
            { deleted_at: { $exists: false } },
          ],
        },
      });
    });

    it('should translate WHERE deleted_at IS NOT NULL to $exists: true, $ne: null', () => {
      const sql = 'SELECT * FROM users WHERE deleted_at IS NOT NULL LIMIT 10';
      const ast = parseSql(sql);
      const plan = buildExecutionPlan(ast, sql);
      const stages = plan.pipelines[0].stages;

      expect(stages).toContainEqual({
        $match: {
          deleted_at: { $exists: true, $ne: null },
        },
      });
    });
  });

  describe('extractCollection helper', () => {
    it('should extract collection from a FROM clause AST node', () => {
      const ast = parseSql('SELECT * FROM products LIMIT 10') as Record<string, unknown>;
      const name = extractCollection(ast as Record<string, unknown>);
      expect(name).toBe('products');
    });
  });

  describe('translateWhere helper', () => {
    it('should return {} for null/undefined input', () => {
      expect(translateWhere(null)).toEqual({});
      expect(translateWhere(undefined)).toEqual({});
    });

    it('should translate a raw equality AST node', () => {
      const whereNode = {
        type: 'binary_expr',
        operator: '=',
        left: { type: 'column_ref', column: 'id' },
        right: { type: 'number', value: 42 },
      };
      const result = translateWhere(whereNode);
      expect(result).toEqual({ id: 42 });
    });

    it('should translate a raw $gt AST node', () => {
      const whereNode = {
        type: 'binary_expr',
        operator: '>',
        left: { type: 'column_ref', column: 'score' },
        right: { type: 'number', value: 100 },
      };
      const result = translateWhere(whereNode);
      expect(result).toEqual({ score: { $gt: 100 } });
    });
  });
});
