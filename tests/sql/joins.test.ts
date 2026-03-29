import { describe, it, expect } from 'vitest';
import { parseSql } from '../../src/sql/parser.js';
import { buildExecutionPlan } from '../../src/sql/planner.js';
import { translateJoins, extractJoins } from '../../src/sql/translators/joins.js';

/**
 * SQL Mode 2 — JOIN Translation Tests
 *
 * Verifies: INNER JOIN, LEFT JOIN, RIGHT JOIN, FULL OUTER JOIN.
 * All JOINs map to $lookup + $unwind pipeline stages.
 */

describe('SQL Mode 2 — JOINs', () => {
  describe('INNER JOIN', () => {
    it('should translate INNER JOIN to $lookup + $unwind without preserveNullAndEmptyArrays', () => {
      const sql = 'SELECT * FROM `users` u INNER JOIN `orders` o ON u.id = o.user_id LIMIT 10';
      const ast = parseSql(sql);
      const plan = buildExecutionPlan(ast, sql);
      const stages = plan.pipelines[0]!.stages;

      const lookupStage = stages.find(s => '$lookup' in s) as { $lookup: Record<string, unknown> } | undefined;
      expect(lookupStage).toBeDefined();
      expect(lookupStage!.$lookup.from).toBe('orders');

      const unwindStage = stages.find(s => '$unwind' in s) as { $unwind: unknown } | undefined;
      expect(unwindStage).toBeDefined();
      // INNER JOIN: $unwind is a plain string, NOT an object with preserveNullAndEmptyArrays
      expect(typeof unwindStage!.$unwind).toBe('string');
    });

    it('should map ON clause to $lookup localField/foreignField', () => {
      const sql = 'SELECT * FROM `users` u INNER JOIN `orders` o ON u.id = o.user_id LIMIT 10';
      const ast = parseSql(sql);
      const plan = buildExecutionPlan(ast, sql);
      const stages = plan.pipelines[0]!.stages;

      const lookupStage = stages.find(s => '$lookup' in s) as { $lookup: Record<string, unknown> } | undefined;
      expect(lookupStage).toBeDefined();
      expect(lookupStage!.$lookup.localField).toBe('id');
      expect(lookupStage!.$lookup.foreignField).toBe('user_id');
    });

    it('should handle WHERE clause after INNER JOIN', () => {
      const sql = "SELECT * FROM `users` u INNER JOIN `orders` o ON u.id = o.user_id WHERE u.status = 'active' LIMIT 10";
      const ast = parseSql(sql);
      const plan = buildExecutionPlan(ast, sql);
      const stages = plan.pipelines[0]!.stages;

      // Should have $lookup, $unwind, and $match
      expect(stages.some(s => '$lookup' in s)).toBe(true);
      expect(stages.some(s => '$unwind' in s)).toBe(true);
      const matchStage = stages.find(s => '$match' in s) as { $match: Record<string, unknown> } | undefined;
      expect(matchStage).toBeDefined();
      expect(matchStage!.$match).toHaveProperty('status');
    });
  });

  describe('LEFT JOIN', () => {
    it('should translate LEFT JOIN to $lookup + $unwind with preserveNullAndEmptyArrays: true', () => {
      const sql = 'SELECT * FROM `users` u LEFT JOIN `orders` o ON u.id = o.user_id LIMIT 10';
      const ast = parseSql(sql);
      const plan = buildExecutionPlan(ast, sql);
      const stages = plan.pipelines[0]!.stages;

      const lookupStage = stages.find(s => '$lookup' in s) as { $lookup: Record<string, unknown> } | undefined;
      expect(lookupStage).toBeDefined();
      expect(lookupStage!.$lookup.from).toBe('orders');

      const unwindStage = stages.find(s => '$unwind' in s) as { $unwind: Record<string, unknown> } | undefined;
      expect(unwindStage).toBeDefined();
      // LEFT JOIN: $unwind must be an object with preserveNullAndEmptyArrays: true
      expect(typeof unwindStage!.$unwind).toBe('object');
      expect(unwindStage!.$unwind.preserveNullAndEmptyArrays).toBe(true);
    });

    it('should preserve left-side documents with no match', () => {
      const sql = 'SELECT * FROM `users` u LEFT JOIN `orders` o ON u.id = o.user_id LIMIT 10';
      const ast = parseSql(sql);
      const plan = buildExecutionPlan(ast, sql);
      const stages = plan.pipelines[0]!.stages;

      const unwindStage = stages.find(s => '$unwind' in s) as { $unwind: Record<string, unknown> } | undefined;
      expect(unwindStage!.$unwind.preserveNullAndEmptyArrays).toBe(true);
      // When alias 'o' is present, the $unwind path uses the alias
      expect(unwindStage!.$unwind.path).toBe('$o');
    });
  });

  describe('RIGHT JOIN', () => {
    it('should swap collection order and use LEFT JOIN strategy', () => {
      const sql = 'SELECT * FROM `users` u RIGHT JOIN `orders` o ON u.id = o.user_id LIMIT 10';
      const ast = parseSql(sql);
      const plan = buildExecutionPlan(ast, sql);
      const stages = plan.pipelines[0]!.stages;

      // RIGHT JOIN swaps: $lookup.from becomes the original main table (users)
      const lookupStage = stages.find(s => '$lookup' in s) as { $lookup: Record<string, unknown> } | undefined;
      expect(lookupStage).toBeDefined();
      expect(lookupStage!.$lookup.from).toBe('users');
    });

    it('should produce correct pipeline with swapped from/localField/foreignField', () => {
      const sql = 'SELECT * FROM `users` u RIGHT JOIN `orders` o ON u.id = o.user_id LIMIT 10';
      const ast = parseSql(sql);
      const plan = buildExecutionPlan(ast, sql);
      const stages = plan.pipelines[0]!.stages;

      const lookupStage = stages.find(s => '$lookup' in s) as { $lookup: Record<string, unknown> } | undefined;
      expect(lookupStage).toBeDefined();
      // Swapped: the ON clause fields are also swapped
      expect(lookupStage!.$lookup.localField).toBe('user_id');
      expect(lookupStage!.$lookup.foreignField).toBe('id');

      // preserveNullAndEmptyArrays should be true (uses LEFT JOIN strategy)
      const unwindStage = stages.find(s => '$unwind' in s) as { $unwind: Record<string, unknown> } | undefined;
      expect(typeof unwindStage!.$unwind).toBe('object');
      expect(unwindStage!.$unwind.preserveNullAndEmptyArrays).toBe(true);
    });
  });

  describe('FULL OUTER JOIN', () => {
    it('should produce two pipelines for FULL OUTER JOIN', () => {
      const sql = 'SELECT * FROM `users` u FULL OUTER JOIN `orders` o ON u.id = o.user_id LIMIT 10';
      const ast = parseSql(sql);
      const plan = buildExecutionPlan(ast, sql);

      expect(plan.pipelines).toHaveLength(2);
    });

    it('should include LEFT JOIN pipeline as first call', () => {
      const sql = 'SELECT * FROM `users` u FULL OUTER JOIN `orders` o ON u.id = o.user_id LIMIT 10';
      const ast = parseSql(sql);
      const plan = buildExecutionPlan(ast, sql);

      const mainPipeline = plan.pipelines[0]!;
      expect(mainPipeline.collection).toBe('users');
      expect(mainPipeline.stages.some(s => '$lookup' in s)).toBe(true);
    });

    it('should include right-only pipeline as second call', () => {
      const sql = 'SELECT * FROM `users` u FULL OUTER JOIN `orders` o ON u.id = o.user_id LIMIT 10';
      const ast = parseSql(sql);
      const plan = buildExecutionPlan(ast, sql);

      const secondPipeline = plan.pipelines[1]!;
      // Second pipeline targets the join table
      expect(secondPipeline.collection).toBe('orders');
      // It should filter out rows that matched in the first pipeline
      expect(secondPipeline.stages.some(s => '$match' in s)).toBe(true);
    });

    it('should mark execution plan as parallel for the two pipelines', () => {
      const sql = 'SELECT * FROM `users` u FULL OUTER JOIN `orders` o ON u.id = o.user_id LIMIT 10';
      const ast = parseSql(sql);
      const plan = buildExecutionPlan(ast, sql);

      expect(plan.parallel).toBe(true);
    });
  });

  describe('JOIN with aliases', () => {
    it('should handle table aliases in JOIN ON clause (u.id = o.user_id)', () => {
      const sql = 'SELECT * FROM `users` AS `u` INNER JOIN `orders` AS `o` ON u.id = o.user_id LIMIT 10';
      const ast = parseSql(sql);
      const plan = buildExecutionPlan(ast, sql);
      const stages = plan.pipelines[0]!.stages;

      expect(stages.some(s => '$lookup' in s)).toBe(true);
      expect(stages.some(s => '$unwind' in s)).toBe(true);
    });

    it('should resolve aliased field names in $lookup', () => {
      const sql = 'SELECT * FROM `users` AS `u` INNER JOIN `orders` AS `o` ON u.id = o.user_id LIMIT 10';
      const ast = parseSql(sql);
      const plan = buildExecutionPlan(ast, sql);
      const stages = plan.pipelines[0]!.stages;

      const lookupStage = stages.find(s => '$lookup' in s) as { $lookup: Record<string, unknown> } | undefined;
      expect(lookupStage).toBeDefined();
      // Fields come from ON clause, stripped of table prefix
      expect(lookupStage!.$lookup.localField).toBe('id');
      expect(lookupStage!.$lookup.foreignField).toBe('user_id');
    });
  });

  describe('multiple JOINs', () => {
    it('should chain multiple $lookup stages for multi-table JOINs', () => {
      const sql = 'SELECT * FROM `users` u INNER JOIN `orders` o ON u.id = o.user_id INNER JOIN `products` p ON o.product_id = p.id LIMIT 10';
      const ast = parseSql(sql);
      const plan = buildExecutionPlan(ast, sql);
      const stages = plan.pipelines[0]!.stages;

      const lookupStages = stages.filter(s => '$lookup' in s);
      expect(lookupStages.length).toBeGreaterThanOrEqual(2);

      // First lookup: orders
      const first = lookupStages[0] as { $lookup: Record<string, unknown> };
      expect(first.$lookup.from).toBe('orders');

      // Second lookup: products
      const second = lookupStages[1] as { $lookup: Record<string, unknown> };
      expect(second.$lookup.from).toBe('products');
    });
  });
});
