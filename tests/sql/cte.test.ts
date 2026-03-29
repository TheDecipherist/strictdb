import { describe, it, expect, beforeEach } from 'vitest';
import { extractCTEs, resetCteCounter } from '../../src/sql/translators/cte.js';

/**
 * SQL Mode 2 — CTE (Common Table Expression) Tests
 *
 * Tests extractCTEs() directly with mock WITH clause arrays.
 * No database connections. Verifies dependency type, chaining, and $graphLookup.
 */

// Minimal SELECT AST for use inside a CTE body
function makeSelectAst(table: string): Record<string, unknown> {
  return {
    type: 'select',
    columns: [{ expr: { type: 'star' }, as: null }],
    from: [{ table, as: null }],
    where: null,
    groupby: null,
    orderby: null,
    limit: null,
  };
}

// Build a WITH clause array entry
function makeCteEntry(
  name: string,
  table: string,
  recursive = false,
): Record<string, unknown> {
  return {
    name,
    stmt: makeSelectAst(table),
    recursive,
  };
}

// Build a recursive CTE entry (stmt wrapped in { ast: ... } to mirror some parser shapes)
function makeRecursiveCteEntry(name: string, table: string): Record<string, unknown> {
  return {
    name,
    stmt: { ast: makeSelectAst(table) },
    recursive: true,
  };
}

describe('SQL Mode 2 — CTEs', () => {
  beforeEach(() => {
    resetCteCounter();
  });

  describe('WITH (non-recursive)', () => {
    it('should return a dependency with type: "cte"', () => {
      const withClause = [makeCteEntry('active_users', 'users')];
      const deps = extractCTEs(withClause);

      expect(deps.length).toBe(1);
      expect(deps[0]?.type).toBe('cte');
    });

    it('should set injectAs to "cte-result"', () => {
      const withClause = [makeCteEntry('recent_orders', 'orders')];
      const deps = extractCTEs(withClause);

      expect(deps[0]?.injectAs).toBe('cte-result');
    });

    it('should use the CTE name as the targetField', () => {
      const withClause = [makeCteEntry('active_users', 'users')];
      const deps = extractCTEs(withClause);

      expect(deps[0]?.targetField).toBe('active_users');
    });

    it('should extract the collection from the CTE body', () => {
      const withClause = [makeCteEntry('recent_orders', 'orders')];
      const deps = extractCTEs(withClause);

      expect(deps[0]?.collection).toBe('orders');
    });

    it('should include a pipeline array on the dependency', () => {
      const withClause = [makeCteEntry('top_products', 'products')];
      const deps = extractCTEs(withClause);

      expect(Array.isArray(deps[0]?.pipeline)).toBe(true);
    });

    it('should handle multiple CTEs in one WITH clause', () => {
      const withClause = [
        makeCteEntry('cte_a', 'table_a'),
        makeCteEntry('cte_b', 'table_b'),
      ];
      const deps = extractCTEs(withClause);

      expect(deps.length).toBe(2);
      expect(deps[0]?.targetField).toBe('cte_a');
      expect(deps[1]?.targetField).toBe('cte_b');
    });

    it('should build a dependsOn chain so cte_b depends on cte_a', () => {
      const withClause = [
        makeCteEntry('cte_a', 'table_a'),
        makeCteEntry('cte_b', 'table_b'),
      ];
      const deps = extractCTEs(withClause);

      // cte_a has no prior deps
      expect(deps[0]?.dependsOn).toEqual([]);

      // cte_b depends on cte_a's id
      expect(deps[1]?.dependsOn?.length).toBe(1);
      expect(deps[1]?.dependsOn?.[0]).toBe(deps[0]?.id);
    });

    it('should assign unique ids to each CTE dependency', () => {
      const withClause = [
        makeCteEntry('cte_a', 'table_a'),
        makeCteEntry('cte_b', 'table_b'),
        makeCteEntry('cte_c', 'table_c'),
      ];
      const deps = extractCTEs(withClause);

      const ids = deps.map(d => d.id);
      const unique = new Set(ids);
      expect(unique.size).toBe(3);
    });
  });

  describe('WITH RECURSIVE', () => {
    it('should produce a dependency with type: "cte" for WITH RECURSIVE', () => {
      const withClause = [makeRecursiveCteEntry('hierarchy', 'employees')];
      const deps = extractCTEs(withClause);

      expect(deps.length).toBe(1);
      expect(deps[0]?.type).toBe('cte');
    });

    it('should include a $graphLookup stage in the pipeline for recursive CTEs', () => {
      const withClause = [makeRecursiveCteEntry('hierarchy', 'employees')];
      const deps = extractCTEs(withClause);

      const pipeline = deps[0]?.pipeline ?? [];
      const hasGraphLookup = pipeline.some(
        stage => '$graphLookup' in (stage as Record<string, unknown>),
      );
      expect(hasGraphLookup).toBe(true);
    });

    it('should include connectFromField in $graphLookup stage', () => {
      const withClause = [makeRecursiveCteEntry('hierarchy', 'employees')];
      const deps = extractCTEs(withClause);

      const pipeline = deps[0]?.pipeline ?? [];
      const graphStage = pipeline.find(
        stage => '$graphLookup' in (stage as Record<string, unknown>),
      ) as Record<string, unknown> | undefined;

      expect(graphStage).toBeDefined();
      const gl = graphStage?.['$graphLookup'] as Record<string, unknown>;
      expect(gl['connectFromField']).toBeDefined();
    });

    it('should include depthField in $graphLookup stage', () => {
      const withClause = [makeRecursiveCteEntry('hierarchy', 'employees')];
      const deps = extractCTEs(withClause);

      const pipeline = deps[0]?.pipeline ?? [];
      const graphStage = pipeline.find(
        stage => '$graphLookup' in (stage as Record<string, unknown>),
      ) as Record<string, unknown> | undefined;

      const gl = graphStage?.['$graphLookup'] as Record<string, unknown>;
      expect(gl['depthField']).toBeDefined();
    });
  });

  describe('empty / null input', () => {
    it('should return empty array for null withClause', () => {
      expect(extractCTEs(null)).toEqual([]);
    });

    it('should return empty array for undefined withClause', () => {
      expect(extractCTEs(undefined)).toEqual([]);
    });

    it('should return empty array for empty array withClause', () => {
      expect(extractCTEs([])).toEqual([]);
    });
  });
});
