import { describe, it, expect, vi } from 'vitest';
import { parseSql, ensureParser } from '../../src/sql/parser.js';
import { buildExecutionPlan } from '../../src/sql/planner.js';
import { SqlEngine } from '../../src/sql/index.js';
import type { SqlExecutorAdapter } from '../../src/sql/executor.js';
import type { OperationReceipt } from '../../src/types.js';

/**
 * SQL Mode 2 — UNION / UNION ALL Tests
 *
 * Verifies: UNION deduplicates, UNION ALL concatenates, chained UNIONs work.
 */

// Helper: mock adapter that returns canned results per collection
function mockAdapter(resultMap: Record<string, Record<string, unknown>[]>): SqlExecutorAdapter {
  return {
    aggregate: vi.fn(async (collection: string) => {
      return resultMap[collection] ?? [];
    }),
    bulkWrite: vi.fn(async () => ({} as OperationReceipt)),
  };
}

describe('SQL Mode 2 — UNION / UNION ALL', () => {
  it('should detect set_op and _next on UNION AST', () => {
    const sql = 'SELECT name FROM users LIMIT 5 UNION SELECT name FROM employees LIMIT 5';
    const ast = parseSql(sql) as Record<string, unknown>;

    expect(ast['set_op']).toBe('union');
    expect(ast['_next']).toBeDefined();
  });

  it('should detect set_op "union all" on UNION ALL AST', () => {
    const sql = 'SELECT name FROM users LIMIT 5 UNION ALL SELECT name FROM employees LIMIT 5';
    const ast = parseSql(sql) as Record<string, unknown>;

    expect(ast['set_op']).toBe('union all');
    expect(ast['_next']).toBeDefined();
  });

  it('should execute UNION ALL and concatenate results', async () => {
    await ensureParser();

    const adapter = mockAdapter({
      users: [{ name: 'Alice' }, { name: 'Bob' }],
      employees: [{ name: 'Bob' }, { name: 'Charlie' }],
    });

    const result = await SqlEngine.execute(
      'SELECT name FROM users LIMIT 5 UNION ALL SELECT name FROM employees LIMIT 5',
      undefined,
      'mongo',
      adapter,
    );

    const data = (result as { data: Record<string, unknown>[] }).data;
    expect(data).toHaveLength(4); // All 4 rows (no dedup)
    expect(data).toContainEqual({ name: 'Alice' });
    expect(data).toContainEqual({ name: 'Charlie' });
    // Bob appears twice
    expect(data.filter(r => r['name'] === 'Bob')).toHaveLength(2);
  });

  it('should execute UNION and deduplicate results', async () => {
    await ensureParser();

    const adapter = mockAdapter({
      users: [{ name: 'Alice' }, { name: 'Bob' }],
      employees: [{ name: 'Bob' }, { name: 'Charlie' }],
    });

    const result = await SqlEngine.execute(
      'SELECT name FROM users LIMIT 5 UNION SELECT name FROM employees LIMIT 5',
      undefined,
      'mongo',
      adapter,
    );

    const data = (result as { data: Record<string, unknown>[] }).data;
    expect(data).toHaveLength(3); // Deduplicated: Alice, Bob, Charlie
    expect(data).toContainEqual({ name: 'Alice' });
    expect(data).toContainEqual({ name: 'Bob' });
    expect(data).toContainEqual({ name: 'Charlie' });
  });

  it('should handle chained UNION (3 SELECTs)', async () => {
    await ensureParser();

    const adapter = mockAdapter({
      a: [{ x: 1 }],
      b: [{ x: 2 }],
      c: [{ x: 1 }], // duplicate of a
    });

    const result = await SqlEngine.execute(
      'SELECT x FROM a LIMIT 5 UNION SELECT x FROM b LIMIT 5 UNION SELECT x FROM c LIMIT 5',
      undefined,
      'mongo',
      adapter,
    );

    const data = (result as { data: Record<string, unknown>[] }).data;
    // UNION deduplicates: {x:1} and {x:2} only
    expect(data).toHaveLength(2);
  });

  it('should handle chained UNION ALL (3 SELECTs)', async () => {
    await ensureParser();

    const adapter = mockAdapter({
      a: [{ x: 1 }],
      b: [{ x: 2 }],
      c: [{ x: 1 }],
    });

    const result = await SqlEngine.execute(
      'SELECT x FROM a LIMIT 5 UNION ALL SELECT x FROM b LIMIT 5 UNION ALL SELECT x FROM c LIMIT 5',
      undefined,
      'mongo',
      adapter,
    );

    const data = (result as { data: Record<string, unknown>[] }).data;
    expect(data).toHaveLength(3); // No dedup
  });
});
