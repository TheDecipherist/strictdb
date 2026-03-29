import { describe, it, expect } from 'vitest';
import { buildExplainPlan } from '../../src/sql/explain.js';
import type { ExecutionPlan, Dependency } from '../../src/sql/types.js';

/**
 * SQL Mode 2 — Explain Plan Tests
 *
 * Tests buildExplainPlan() directly with hand-constructed ExecutionPlan objects.
 * No database connections. No parser. Pure unit tests against the explain formatter.
 */

// Factory for a minimal ExecutionPlan
function makePlan(overrides: Partial<ExecutionPlan> = {}): ExecutionPlan {
  return {
    type: 'select',
    collection: 'users',
    dependencies: [],
    pipelines: [
      {
        collection: 'users',
        stages: [{ $match: { active: true } }, { $limit: 10 }],
      },
    ],
    parallel: false,
    isAggregate: false,
    isTransaction: false,
    ...overrides,
  };
}

// Factory for a Dependency
function makeDep(id: string, collection: string): Dependency {
  return {
    id,
    type: 'subquery',
    collection,
    pipeline: [{ $match: {} }],
    injectAs: 'in',
    targetField: 'user_id',
  };
}

describe('SQL Mode 2 — Explain', () => {
  describe('phases count', () => {
    it('should have phases: 1 for a simple plan with no dependencies', () => {
      const plan = makePlan();
      const explain = buildExplainPlan(plan);
      expect(explain.phases).toBe(1);
    });

    it('should have phases: 2 for a plan with at least one dependency', () => {
      const plan = makePlan({ dependencies: [makeDep('dep_1', 'orders')] });
      const explain = buildExplainPlan(plan);
      expect(explain.phases).toBe(2);
    });

    it('should have phases: 2 for multiple dependencies (they are still phase 2)', () => {
      const plan = makePlan({
        dependencies: [
          makeDep('dep_1', 'orders'),
          makeDep('dep_2', 'reviews'),
        ],
      });
      const explain = buildExplainPlan(plan);
      expect(explain.phases).toBe(2);
    });
  });

  describe('dependencies list', () => {
    it('should have empty dependencies array for a simple plan', () => {
      const plan = makePlan();
      const explain = buildExplainPlan(plan);
      expect(explain.dependencies).toEqual([]);
    });

    it('should include dependency type, collection, and pipeline', () => {
      const dep = makeDep('dep_1', 'orders');
      const plan = makePlan({ dependencies: [dep] });
      const explain = buildExplainPlan(plan);

      expect(explain.dependencies.length).toBe(1);
      const d = explain.dependencies[0]!;
      expect(d.type).toBe('subquery');
      expect(d.collection).toBe('orders');
      expect(Array.isArray(d.pipeline)).toBe(true);
    });

    it('should set resultCount to 0 (not yet executed)', () => {
      const plan = makePlan({ dependencies: [makeDep('dep_1', 'orders')] });
      const explain = buildExplainPlan(plan);
      expect(explain.dependencies[0]?.resultCount).toBe(0);
    });

    it('should include all multiple dependencies', () => {
      const plan = makePlan({
        dependencies: [
          makeDep('dep_1', 'orders'),
          makeDep('dep_2', 'products'),
        ],
      });
      const explain = buildExplainPlan(plan);
      expect(explain.dependencies.length).toBe(2);
      expect(explain.dependencies[0]?.collection).toBe('orders');
      expect(explain.dependencies[1]?.collection).toBe('products');
    });
  });

  describe('pipeline info', () => {
    it('should include collection name in pipeline info', () => {
      const plan = makePlan();
      const explain = buildExplainPlan(plan);

      expect(explain.pipelines.length).toBe(1);
      expect(explain.pipelines[0]?.collection).toBe('users');
    });

    it('should include all pipeline stages', () => {
      const plan = makePlan();
      const explain = buildExplainPlan(plan);

      const stages = explain.pipelines[0]?.stages ?? [];
      expect(stages.length).toBe(2);
      expect(Object.keys(stages[0]!)[0]).toBe('$match');
      expect(Object.keys(stages[1]!)[0]).toBe('$limit');
    });

    it('should handle multiple pipelines (e.g. FULL OUTER JOIN)', () => {
      const plan = makePlan({
        pipelines: [
          { collection: 'users', stages: [{ $match: {} }] },
          { collection: 'orders', stages: [{ $match: {} }] },
        ],
        parallel: true,
      });
      const explain = buildExplainPlan(plan);
      expect(explain.pipelines.length).toBe(2);
    });

    it('should preserve stage order exactly as given', () => {
      const stages = [
        { $match: { status: 'active' } },
        { $sort: { createdAt: -1 } },
        { $limit: 20 },
      ];
      const plan = makePlan({
        pipelines: [{ collection: 'events', stages }],
      });
      const explain = buildExplainPlan(plan);

      const explainStages = explain.pipelines[0]?.stages ?? [];
      expect(explainStages.length).toBe(3);
      expect(Object.keys(explainStages[0]!)[0]).toBe('$match');
      expect(Object.keys(explainStages[1]!)[0]).toBe('$sort');
      expect(Object.keys(explainStages[2]!)[0]).toBe('$limit');
    });
  });

  describe('parallel flag', () => {
    it('should reflect parallel: false for single-pipeline plans', () => {
      const plan = makePlan({ parallel: false });
      const explain = buildExplainPlan(plan);
      expect(explain.parallel).toBe(false);
    });

    it('should reflect parallel: true when plan.parallel is true', () => {
      const plan = makePlan({ parallel: true });
      const explain = buildExplainPlan(plan);
      expect(explain.parallel).toBe(true);
    });
  });

  describe('durationMs', () => {
    it('should include durationMs field set to 0 (pre-execution)', () => {
      const plan = makePlan();
      const explain = buildExplainPlan(plan);
      expect(explain.durationMs).toBe(0);
    });
  });

  describe('CTE dependencies', () => {
    it('should include cte type in dependency info', () => {
      const plan = makePlan({
        dependencies: [
          {
            id: 'cte_1_active',
            type: 'cte',
            collection: 'users',
            pipeline: [{ $match: { active: true } }],
            injectAs: 'cte-result',
            targetField: 'active_users',
          },
        ],
      });
      const explain = buildExplainPlan(plan);
      expect(explain.dependencies[0]?.type).toBe('cte');
    });
  });
});
