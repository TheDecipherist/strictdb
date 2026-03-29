/**
 * SQL Mode 2 — Transactions
 *
 * BEGIN/COMMIT/ROLLBACK → MongoDB ClientSession
 * Multi-statement blocks split by semicolons, executed sequentially.
 */

import { splitStatements } from './parser.js';
import type { ExecutionPlan, ParsedStatement, SqlMode2Dialect } from './types.js';

/**
 * Parse a transaction block into individual statements.
 */
export function parseTransactionBlock(sql: string, _dialect: SqlMode2Dialect = 'mysql'): ParsedStatement[] {
  const statements = splitStatements(sql);
  const parsed: ParsedStatement[] = [];

  for (const stmt of statements) {
    const upper = stmt.toUpperCase().trim();

    // Skip BEGIN/START TRANSACTION/COMMIT/ROLLBACK — these are control flow
    if (upper === 'BEGIN' || upper === 'START TRANSACTION' || upper === 'COMMIT' || upper === 'ROLLBACK') {
      continue;
    }

    const stmtType = detectStatementType(upper);
    parsed.push({ sql: stmt, type: stmtType });
  }

  return parsed;
}

function detectStatementType(upper: string): 'select' | 'insert' | 'update' | 'delete' | 'transaction' {
  if (upper.startsWith('SELECT')) return 'select';
  if (upper.startsWith('INSERT')) return 'insert';
  if (upper.startsWith('UPDATE')) return 'update';
  if (upper.startsWith('DELETE')) return 'delete';
  return 'transaction';
}

/**
 * Build execution plans for each statement in a transaction.
 */
export function planTransaction(
  statements: ParsedStatement[],
  _dialect: SqlMode2Dialect = 'mysql',
): ExecutionPlan {
  return {
    type: 'transaction',
    collection: 'transaction',
    dependencies: [],
    pipelines: [],
    parallel: false,
    isAggregate: false,
    isTransaction: true,
    statements,
  };
}

/**
 * Check if a SQL string contains a ROLLBACK statement.
 */
export function hasRollback(sql: string): boolean {
  return sql.toUpperCase().includes('ROLLBACK');
}
