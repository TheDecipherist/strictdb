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
