import { describe, it, expect } from 'vitest';
import { parseSql } from '../../src/sql/parser.js';
import { buildExecutionPlan } from '../../src/sql/planner.js';
import {
  buildGroupStage,
  extractAggregateFields,
  hasAggregates,
  buildWindowStage,
  extractWindowSpecs,
  hasWindowFunctions,
} from '../../src/sql/translators/aggregates.js';

/**
 * SQL Mode 2 — Aggregate Function Tests
 *
 * Verifies: GROUP BY, HAVING, COUNT, SUM, AVG, MIN, MAX, aggregate without GROUP BY.
 * Aggregate queries are exempt from the LIMIT guardrail.
 */

describe('SQL Mode 2 — Aggregates', () => {
  describe('COUNT', () => {
    it('should translate COUNT(*) to $group with $sum: 1', () => {
      const sql = 'SELECT COUNT(*) AS cnt FROM `employees`';
      const ast = parseSql(sql);
      const plan = buildExecutionPlan(ast, sql);

      expect(plan.isAggregate).toBe(true);
      const stages = plan.pipelines[0]!.stages;
      const groupStage = stages.find(s => '$group' in s) as { $group: Record<string, unknown> } | undefined;
      expect(groupStage).toBeDefined();
      expect(groupStage!.$group['cnt']).toEqual({ $sum: 1 });
    });

    it('should translate COUNT(field) to $sum with $cond/$ifNull check', () => {
      const sql = 'SELECT COUNT(email) AS email_count FROM `employees`';
      const ast = parseSql(sql);
      const plan = buildExecutionPlan(ast, sql);

      const stages = plan.pipelines[0]!.stages;
      const groupStage = stages.find(s => '$group' in s) as { $group: Record<string, unknown> } | undefined;
      expect(groupStage).toBeDefined();

      const accumulator = groupStage!.$group['email_count'] as Record<string, unknown>;
      expect(accumulator).toBeDefined();
      // COUNT(field) uses $cond/$ifNull to skip nulls
      expect(accumulator['$sum']).toBeDefined();
      const sumExpr = accumulator['$sum'] as Record<string, unknown>;
      expect(sumExpr).toHaveProperty('$cond');
    });

    it('should translate COUNT(*) without GROUP BY to _id: null', () => {
      const sql = 'SELECT COUNT(*) AS total FROM `employees`';
      const ast = parseSql(sql);
      const plan = buildExecutionPlan(ast, sql);

      const stages = plan.pipelines[0]!.stages;
      const groupStage = stages.find(s => '$group' in s) as { $group: Record<string, unknown> } | undefined;
      expect(groupStage).toBeDefined();
      expect(groupStage!.$group['_id']).toBeNull();
    });
  });

  describe('SUM / AVG / MIN / MAX', () => {
    it('should translate SUM(salary) to $sum: "$salary" in $group', () => {
      const sql = 'SELECT SUM(`salary`) AS total_salary FROM `employees`';
      const ast = parseSql(sql);
      const plan = buildExecutionPlan(ast, sql);

      const stages = plan.pipelines[0]!.stages;
      const groupStage = stages.find(s => '$group' in s) as { $group: Record<string, unknown> } | undefined;
      expect(groupStage).toBeDefined();
      expect(groupStage!.$group['total_salary']).toEqual({ $sum: '$salary' });
    });

    it('should translate AVG(age) to $avg: "$age" in $group', () => {
      const sql = 'SELECT AVG(`age`) AS avg_age FROM `employees`';
      const ast = parseSql(sql);
      const plan = buildExecutionPlan(ast, sql);

      const stages = plan.pipelines[0]!.stages;
      const groupStage = stages.find(s => '$group' in s) as { $group: Record<string, unknown> } | undefined;
      expect(groupStage).toBeDefined();
      expect(groupStage!.$group['avg_age']).toEqual({ $avg: '$age' });
    });

    it('should translate MIN(price) to $min: "$price" in $group', () => {
      const sql = 'SELECT MIN(`price`) AS min_price FROM `products`';
      const ast = parseSql(sql);
      const plan = buildExecutionPlan(ast, sql);

      const stages = plan.pipelines[0]!.stages;
      const groupStage = stages.find(s => '$group' in s) as { $group: Record<string, unknown> } | undefined;
      expect(groupStage).toBeDefined();
      expect(groupStage!.$group['min_price']).toEqual({ $min: '$price' });
    });

    it('should translate MAX(score) to $max: "$score" in $group', () => {
      const sql = 'SELECT MAX(`score`) AS max_score FROM `results`';
      const ast = parseSql(sql);
      const plan = buildExecutionPlan(ast, sql);

      const stages = plan.pipelines[0]!.stages;
      const groupStage = stages.find(s => '$group' in s) as { $group: Record<string, unknown> } | undefined;
      expect(groupStage).toBeDefined();
      expect(groupStage!.$group['max_score']).toEqual({ $max: '$score' });
    });
  });

  describe('GROUP BY', () => {
    it('should translate GROUP BY department to $group with _id: "$department"', () => {
      const sql = 'SELECT `department`, COUNT(*) AS cnt FROM `employees` GROUP BY `department`';
      const ast = parseSql(sql);
      const plan = buildExecutionPlan(ast, sql);

      expect(plan.isAggregate).toBe(true);
      const stages = plan.pipelines[0]!.stages;
      const groupStage = stages.find(s => '$group' in s) as { $group: Record<string, unknown> } | undefined;
      expect(groupStage).toBeDefined();
      expect(groupStage!.$group['_id']).toBe('$department');
    });

    it('should translate GROUP BY with multiple fields to compound _id', () => {
      const sql = 'SELECT `department`, `role`, COUNT(*) AS cnt FROM `employees` GROUP BY `department`, `role`';
      const ast = parseSql(sql);
      const plan = buildExecutionPlan(ast, sql);

      const stages = plan.pipelines[0]!.stages;
      const groupStage = stages.find(s => '$group' in s) as { $group: Record<string, unknown> } | undefined;
      expect(groupStage).toBeDefined();
      const id = groupStage!.$group['_id'] as Record<string, unknown>;
      expect(typeof id).toBe('object');
      expect(id).not.toBeNull();
      expect(id['department']).toBe('$department');
      expect(id['role']).toBe('$role');
    });

    it('should combine GROUP BY with aggregate functions', () => {
      const sql = 'SELECT `department`, SUM(`salary`) AS total_sal, AVG(`salary`) AS avg_sal FROM `employees` GROUP BY `department`';
      const ast = parseSql(sql);
      const plan = buildExecutionPlan(ast, sql);

      const stages = plan.pipelines[0]!.stages;
      const groupStage = stages.find(s => '$group' in s) as { $group: Record<string, unknown> } | undefined;
      expect(groupStage).toBeDefined();
      expect(groupStage!.$group['_id']).toBe('$department');
      expect(groupStage!.$group['total_sal']).toEqual({ $sum: '$salary' });
      expect(groupStage!.$group['avg_sal']).toEqual({ $avg: '$salary' });
    });
  });

  describe('HAVING', () => {
    it('should translate HAVING COUNT(*) > 5 to $match after $group', () => {
      const sql = 'SELECT `department`, COUNT(*) AS cnt FROM `employees` GROUP BY `department` HAVING COUNT(*) > 5';
      const ast = parseSql(sql);
      const plan = buildExecutionPlan(ast, sql);

      const stages = plan.pipelines[0]!.stages;
      const groupIndex = stages.findIndex(s => '$group' in s);
      expect(groupIndex).toBeGreaterThanOrEqual(0);

      // $match for HAVING must come AFTER $group
      const matchAfterGroup = stages.slice(groupIndex + 1).find(s => '$match' in s);
      expect(matchAfterGroup).toBeDefined();
    });

    it('should place HAVING $match stage after $group stage', () => {
      const sql = 'SELECT `department`, COUNT(*) AS cnt FROM `employees` GROUP BY `department` HAVING COUNT(*) > 5';
      const ast = parseSql(sql);
      const plan = buildExecutionPlan(ast, sql);

      const stages = plan.pipelines[0]!.stages;
      const groupIndex = stages.findIndex(s => '$group' in s);
      const matchAfterGroupIndex = stages.findIndex((s, i) => i > groupIndex && '$match' in s);

      expect(groupIndex).toBeGreaterThanOrEqual(0);
      expect(matchAfterGroupIndex).toBeGreaterThan(groupIndex);
    });

    it('should handle HAVING with aggregate alias', () => {
      const sql = 'SELECT `department`, SUM(`salary`) AS total_sal FROM `employees` GROUP BY `department` HAVING SUM(`salary`) > 100000';
      const ast = parseSql(sql);
      const plan = buildExecutionPlan(ast, sql);

      const stages = plan.pipelines[0]!.stages;
      const groupIndex = stages.findIndex(s => '$group' in s);
      expect(groupIndex).toBeGreaterThanOrEqual(0);

      const matchAfterGroup = stages.slice(groupIndex + 1).find(s => '$match' in s);
      expect(matchAfterGroup).toBeDefined();
    });
  });

  describe('aggregate without GROUP BY', () => {
    it('should translate SELECT COUNT(*), AVG(salary) to $group with _id: null', () => {
      const sql = 'SELECT COUNT(*) AS total, AVG(`salary`) AS avg_sal FROM `employees`';
      const ast = parseSql(sql);
      const plan = buildExecutionPlan(ast, sql);

      expect(plan.isAggregate).toBe(true);
      const stages = plan.pipelines[0]!.stages;
      const groupStage = stages.find(s => '$group' in s) as { $group: Record<string, unknown> } | undefined;
      expect(groupStage).toBeDefined();
      expect(groupStage!.$group['_id']).toBeNull();
    });

    it('should support multiple aggregates in one query without GROUP BY', () => {
      const sql = 'SELECT MIN(`price`) AS min_p, MAX(`price`) AS max_p, AVG(`price`) AS avg_p FROM `products`';
      const ast = parseSql(sql);
      const plan = buildExecutionPlan(ast, sql);

      const stages = plan.pipelines[0]!.stages;
      const groupStage = stages.find(s => '$group' in s) as { $group: Record<string, unknown> } | undefined;
      expect(groupStage).toBeDefined();
      expect(groupStage!.$group['_id']).toBeNull();
      expect(groupStage!.$group['min_p']).toEqual({ $min: '$price' });
      expect(groupStage!.$group['max_p']).toEqual({ $max: '$price' });
      expect(groupStage!.$group['avg_p']).toEqual({ $avg: '$price' });
    });
  });

  describe('aggregate with WHERE', () => {
    it('should place $match (WHERE) before $group stage', () => {
      const sql = "SELECT `department`, COUNT(*) AS cnt FROM `employees` WHERE `status` = 'active' GROUP BY `department`";
      const ast = parseSql(sql);
      const plan = buildExecutionPlan(ast, sql);

      const stages = plan.pipelines[0]!.stages;
      const matchIndex = stages.findIndex(s => '$match' in s);
      const groupIndex = stages.findIndex(s => '$group' in s);

      expect(matchIndex).toBeGreaterThanOrEqual(0);
      expect(groupIndex).toBeGreaterThan(matchIndex);

      // The WHERE $match should filter on status
      const matchStage = stages[matchIndex] as { $match: Record<string, unknown> };
      expect(matchStage.$match).toHaveProperty('status');
    });
  });
});
