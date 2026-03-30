/**
 * SQL Mode 2 — Entry Point
 *
 * SqlEngine class wires parsing, planning, and execution together.
 * Exposes a single `execute()` method that StrictDB.sql() delegates to.
 */

import type { SqlOptions, SqlMode2Result } from './types.js';
import type { Backend, OperationReceipt } from '../types.js';
import { bindParams, parseSql, isTransactionBlock, ensureParser } from './parser.js';
import { buildExecutionPlan } from './planner.js';
import { executePlan, type SqlExecutorAdapter } from './executor.js';
import { validateSqlMode } from './raw.js';
import { parseTransactionBlock } from './transactions.js';
import { transactionFailedError } from './errors.js';

export type { SqlOptions, SqlMode2Result } from './types.js';

export class SqlEngine {
  /**
   * Execute a SQL string against MongoDB.
   */
  static async execute(
    sql: string,
    options: SqlOptions | undefined,
    backend: Backend,
    adapter: SqlExecutorAdapter,
    rawExecutor?: (sql: string, params?: unknown[]) => Promise<unknown>,
  ): Promise<SqlMode2Result | OperationReceipt> {
    const dialect = options?.dialect ?? 'mysql';
    const explain = options?.explain ?? false;
    const raw = options?.raw ?? false;

    // Validate mode (throws if invalid combination)
    const mode = validateSqlMode(backend, raw, sql);

    // Ensure parser is loaded (lazy — first call pays import cost, subsequent calls are free)
    await ensureParser();

    // Raw passthrough — delegate to native driver
    if (mode === 'raw' && rawExecutor) {
      const result = await rawExecutor(sql, options?.params);
      return { data: Array.isArray(result) ? result : [result as Record<string, unknown>] };
    }

    // Bind parameters
    const boundSql = bindParams(sql, options?.params, dialect);

    // Check for transaction block
    if (isTransactionBlock(boundSql)) {
      return SqlEngine.executeTransaction(boundSql, dialect, adapter, sql);
    }

    // Parse and plan
    const ast = parseSql(boundSql, dialect);

    // Handle array of ASTs (multi-statement)
    const astNode = Array.isArray(ast) ? ast[0] : ast;

    // Handle UNION / UNION ALL — AST has set_op + _next chain
    const rootNode = astNode as Record<string, unknown>;
    if (rootNode['set_op'] && rootNode['_next']) {
      return SqlEngine.executeUnion(rootNode, adapter, explain);
    }

    const plan = buildExecutionPlan(astNode, sql);

    // Execute
    const result = await executePlan(plan, adapter, explain);

    // Write operations return OperationReceipt
    if (plan.type !== 'select' && result.data.length > 0) {
      return result.data[0] as unknown as OperationReceipt;
    }

    return result;
  }

  /**
   * Execute a UNION / UNION ALL query.
   * Walks the _next chain, builds a plan for each SELECT, runs in parallel, merges.
   */
  private static async executeUnion(
    rootAst: Record<string, unknown>,
    adapter: SqlExecutorAdapter,
    explain: boolean,
  ): Promise<SqlMode2Result> {
    // Collect all SELECT ASTs and the set operations between them
    interface UnionSegment {
      ast: Record<string, unknown>;
      setOp: string; // 'union' or 'union all' — applies BEFORE this segment's results merge
    }
    const segments: UnionSegment[] = [];
    let current: Record<string, unknown> | undefined = rootAst;

    while (current) {
      const setOp = (current['set_op'] as string | undefined) ?? '';
      // Strip _next and set_op so buildExecutionPlan sees a plain SELECT
      const cleanAst = { ...current };
      delete cleanAst['_next'];
      delete cleanAst['set_op'];
      segments.push({ ast: cleanAst, setOp });
      current = current['_next'] as Record<string, unknown> | undefined;
    }

    // Build and execute each SELECT in parallel
    const results = await Promise.all(
      segments.map(async (seg) => {
        const plan = buildExecutionPlan(seg.ast, 'UNION segment');
        const result = await executePlan(plan, adapter, explain);
        return result.data;
      }),
    );

    // Merge results according to set operations
    // The set_op on segment[i] describes the operation between segment[i] and segment[i+1].
    // Actually, in node-sql-parser: segment[0].set_op = 'union' means "union the first SELECT with _next".
    // So we merge sequentially: start with results[0], then apply set_op[0] to merge results[1], etc.
    let merged = results[0] ?? [];

    for (let i = 1; i < results.length; i++) {
      const op = segments[i - 1]!.setOp.toLowerCase();
      const nextData = results[i] ?? [];

      if (op === 'union all') {
        // UNION ALL — simple concatenation
        merged = [...merged, ...nextData];
      } else {
        // UNION — concatenate then deduplicate
        const combined = [...merged, ...nextData];
        const seen = new Set<string>();
        const deduped: Record<string, unknown>[] = [];
        for (const row of combined) {
          const key = JSON.stringify(row);
          if (!seen.has(key)) {
            seen.add(key);
            deduped.push(row);
          }
        }
        merged = deduped;
      }
    }

    return { data: merged };
  }

  /**
   * Execute a transaction block (BEGIN...COMMIT).
   */
  private static async executeTransaction(
    sql: string,
    dialect: SqlOptions['dialect'],
    adapter: SqlExecutorAdapter,
    originalSql: string,
  ): Promise<SqlMode2Result> {
    const statements = parseTransactionBlock(sql, dialect ?? 'mysql');
    const results: Record<string, unknown>[] = [];

    // Execute each statement sequentially
    for (const stmt of statements) {
      try {
        const stmtAst = parseSql(stmt.sql, dialect ?? 'mysql');
        const astNode = Array.isArray(stmtAst) ? stmtAst[0] : stmtAst;
        const plan = buildExecutionPlan(astNode, stmt.sql);
        const result = await executePlan(plan, adapter);
        results.push(...result.data);
      } catch (err) {
        // Transaction failed — throw with context
        const msg = err instanceof Error ? err.message : String(err);
        throw transactionFailedError(stmt.sql, msg, { sql: originalSql });
      }
    }

    return { data: results };
  }
}
