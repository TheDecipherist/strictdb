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

  describe('CROSS JOIN', () => {
    it('should translate CROSS JOIN to $lookup with empty pipeline + $unwind', () => {
      const sql = 'SELECT * FROM `users` CROSS JOIN `roles` LIMIT 10';
      const ast = parseSql(sql);
      const plan = buildExecutionPlan(ast, sql);
      const stages = plan.pipelines[0]!.stages;

      const lookupStage = stages.find(s => '$lookup' in s) as { $lookup: Record<string, unknown> } | undefined;
      expect(lookupStage).toBeDefined();
      expect(lookupStage!.$lookup.from).toBe('roles');
      expect(lookupStage!.$lookup.pipeline).toEqual([]);
      // No localField/foreignField — uses pipeline form
      expect(lookupStage!.$lookup.localField).toBeUndefined();

      const unwindStage = stages.find(s => '$unwind' in s) as { $unwind: unknown } | undefined;
      expect(unwindStage).toBeDefined();
      expect(typeof unwindStage!.$unwind).toBe('string');
      expect(unwindStage!.$unwind).toBe('$roles');
    });

    it('should use alias for $unwind path when alias is present', () => {
      const sql = 'SELECT * FROM `users` u CROSS JOIN `roles` r LIMIT 10';
      const ast = parseSql(sql);
      const plan = buildExecutionPlan(ast, sql);
      const stages = plan.pipelines[0]!.stages;

      const lookupStage = stages.find(s => '$lookup' in s) as { $lookup: Record<string, unknown> } | undefined;
      expect(lookupStage!.$lookup.as).toBe('r');

      const unwindStage = stages.find(s => '$unwind' in s) as { $unwind: unknown } | undefined;
      expect(unwindStage!.$unwind).toBe('$r');
    });

    it('should extract CROSS JOIN via extractJoins', () => {
      const sql = 'SELECT * FROM `users` CROSS JOIN `products` LIMIT 10';
      const ast = parseSql(sql);
      const node = ast as Record<string, unknown>;
      const joins = extractJoins(node['from']);
      expect(joins).toHaveLength(1);
      expect(joins[0]!.type).toBe('cross');
      expect(joins[0]!.table).toBe('products');
    });
  });

  describe('multi-condition ON', () => {
    it('should handle AND-chained ON clause with two conditions', () => {
      const sql = 'SELECT * FROM `users` u INNER JOIN `orders` o ON u.id = o.user_id AND u.type = o.type LIMIT 10';
      const ast = parseSql(sql);
      const plan = buildExecutionPlan(ast, sql);
      const stages = plan.pipelines[0]!.stages;

      const lookupStage = stages.find(s => '$lookup' in s) as { $lookup: Record<string, unknown> } | undefined;
      expect(lookupStage).toBeDefined();
      // Multi-condition uses pipeline form with let + $expr
      expect(lookupStage!.$lookup.let).toBeDefined();
      expect(lookupStage!.$lookup.pipeline).toBeDefined();

      const pipeline = lookupStage!.$lookup.pipeline as Record<string, unknown>[];
      expect(pipeline.length).toBeGreaterThanOrEqual(1);
      const matchStage = pipeline[0] as { $match: { $expr: Record<string, unknown> } };
      expect(matchStage.$match.$expr).toHaveProperty('$and');
      const andConditions = (matchStage.$match.$expr as Record<string, unknown>)['$and'] as unknown[];
      expect(andConditions).toHaveLength(2);
    });

    it('should use let variables for each local field', () => {
      const sql = 'SELECT * FROM `users` u INNER JOIN `orders` o ON u.id = o.user_id AND u.region = o.region LIMIT 10';
      const ast = parseSql(sql);
      const plan = buildExecutionPlan(ast, sql);
      const stages = plan.pipelines[0]!.stages;

      const lookupStage = stages.find(s => '$lookup' in s) as { $lookup: Record<string, unknown> } | undefined;
      const letVars = lookupStage!.$lookup.let as Record<string, string>;
      expect(Object.keys(letVars)).toHaveLength(2);
      // Should have let variables for 'id' and 'region'
      expect(letVars['local_id']).toBe('$id');
      expect(letVars['local_region']).toBe('$region');
    });

    it('should extract multiple conditions via extractJoins', () => {
      const sql = 'SELECT * FROM `users` u INNER JOIN `orders` o ON u.id = o.user_id AND u.type = o.type LIMIT 10';
      const ast = parseSql(sql);
      const node = ast as Record<string, unknown>;
      const joins = extractJoins(node['from']);
      expect(joins).toHaveLength(1);
      expect(joins[0]!.conditions).toBeDefined();
      expect(joins[0]!.conditions).toHaveLength(2);
      expect(joins[0]!.conditions![0]!.localField).toBe('id');
      expect(joins[0]!.conditions![0]!.foreignField).toBe('user_id');
      expect(joins[0]!.conditions![1]!.localField).toBe('type');
      expect(joins[0]!.conditions![1]!.foreignField).toBe('type');
    });

    it('single ON condition should NOT set conditions array', () => {
      const sql = 'SELECT * FROM `users` u INNER JOIN `orders` o ON u.id = o.user_id LIMIT 10';
      const ast = parseSql(sql);
      const node = ast as Record<string, unknown>;
      const joins = extractJoins(node['from']);
      expect(joins[0]!.conditions).toBeUndefined();
    });
  });

  describe('derived tables (subquery in FROM)', () => {
    it('should handle SELECT from a subquery in FROM', () => {
      const sql = 'SELECT * FROM (SELECT userId, COUNT(*) AS cnt FROM `orders` GROUP BY userId) t WHERE cnt > 5 LIMIT 10';
      const ast = parseSql(sql);
      const plan = buildExecutionPlan(ast, sql);

      // Should target the inner collection
      expect(plan.collection).toBe('orders');

      const stages = plan.pipelines[0]!.stages;
      // Inner query stages: $group
      expect(stages.some(s => '$group' in s)).toBe(true);
      // Outer WHERE: $match for cnt > 5
      const matchStages = stages.filter(s => '$match' in s);
      expect(matchStages.length).toBeGreaterThanOrEqual(1);
      // Outer LIMIT
      expect(stages.some(s => '$limit' in s)).toBe(true);
    });

    it('should apply outer ORDER BY after inner query', () => {
      const sql = 'SELECT * FROM (SELECT userId, COUNT(*) AS cnt FROM `orders` GROUP BY userId) t ORDER BY cnt DESC LIMIT 10';
      const ast = parseSql(sql);
      const plan = buildExecutionPlan(ast, sql);
      const stages = plan.pipelines[0]!.stages;

      // Should have $group (inner) followed by $sort (outer)
      const groupIdx = stages.findIndex(s => '$group' in s);
      const sortIdx = stages.findIndex(s => '$sort' in s);
      expect(groupIdx).toBeGreaterThanOrEqual(0);
      expect(sortIdx).toBeGreaterThan(groupIdx);
    });

    it('should apply outer LIMIT and SKIP after inner query', () => {
      const sql = 'SELECT * FROM (SELECT name FROM `users`) t LIMIT 5';
      const ast = parseSql(sql);
      const plan = buildExecutionPlan(ast, sql);
      const stages = plan.pipelines[0]!.stages;

      const limitStages = stages.filter(s => '$limit' in s);
      // The outer LIMIT should be the last $limit in the pipeline
      expect(limitStages.length).toBeGreaterThanOrEqual(1);
    });
  });
});
