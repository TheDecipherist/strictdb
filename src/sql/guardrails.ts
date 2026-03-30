/**
 * SQL Mode 2 — SQL-Specific Guardrails
 *
 * Checks SQL AST for dangerous patterns before execution.
 */

import { guardrailBlockedError, nullComparisonError } from './errors.js';

interface AstNode {
  type?: string;
  keyword?: string;
  where?: unknown;
  limit?: unknown;
  from?: Array<{ table?: string }>;
  table?: Array<{ table?: string }> | string;
  columns?: unknown;
  set?: unknown;
}

/**
 * Check SQL AST for guardrail violations.
 * Throws StrictDBError if blocked.
 */
export function checkSqlGuardrails(ast: AstNode, sql: string): void {
  const stmtType = ast.type?.toLowerCase();

  if (stmtType === 'delete') {
    checkDeleteGuardrail(ast, sql);
  }

  if (stmtType === 'select') {
    checkSelectGuardrail(ast, sql);
  }

  if (stmtType === 'update') {
    checkUpdateGuardrail(ast, sql);
  }
}

function checkDeleteGuardrail(ast: AstNode, sql: string): void {
  if (!ast.where) {
    const table = extractTableName(ast);
    throw guardrailBlockedError(
      `DELETE without WHERE clause would delete all documents in ${table}`,
      `Add a WHERE clause: DELETE FROM ${table} WHERE <condition>`,
      sql,
    );
  }
}

function checkSelectGuardrail(ast: AstNode, sql: string): void {
  // Skip limit check for aggregate queries (COUNT, SUM, etc.)
  if (isAggregateQuery(ast)) return;

  if (!ast.limit) {
    const table = extractTableName(ast);
    throw guardrailBlockedError(
      `SELECT without LIMIT would return unbounded results from ${table}`,
      `Add a LIMIT clause: SELECT * FROM ${table} LIMIT 100`,
      sql,
    );
  }
}

function checkUpdateGuardrail(ast: AstNode, sql: string): void {
  if (!ast.where) {
    const table = extractTableName(ast);
    throw guardrailBlockedError(
      `UPDATE without WHERE clause would update all documents in ${table}`,
      `Add a WHERE clause: UPDATE ${table} SET ... WHERE <condition>`,
      sql,
    );
  }
}

function extractTableName(ast: AstNode): string {
  if (ast.from && Array.isArray(ast.from) && ast.from[0]?.table) {
    return ast.from[0].table;
  }
  if (ast.table && Array.isArray(ast.table) && ast.table[0]?.table) {
    return ast.table[0].table;
  }
  if (typeof ast.table === 'string') return ast.table;
  return 'unknown';
}

function isAggregateQuery(ast: AstNode): boolean {
  // GROUP BY always bounds results
  if ((ast as Record<string, unknown>)['groupby']) return true;

  const columns = ast.columns as unknown[];
  if (!Array.isArray(columns)) return false;
  return columns.some((col: unknown) => {
    const c = col as Record<string, unknown>;
    const expr = c['expr'] as Record<string, unknown> | undefined;
    return expr?.['type'] === 'aggr_func';
  });
}

/**
 * Check for = NULL / != NULL comparisons in WHERE clause.
 * These should use IS NULL / IS NOT NULL instead.
 */
export function checkNullComparisons(where: unknown, sql: string): void {
  if (!where) return;
  walkWhere(where as Record<string, unknown>, sql);
}

function walkWhere(node: Record<string, unknown>, sql: string): void {
  if (!node || typeof node !== 'object') return;

  const type = node['type'] as string | undefined;
  const operator = node['operator'] as string | undefined;

  // Check for = NULL or != NULL
  if (type === 'binary_expr' && (operator === '=' || operator === '!=' || operator === '<>')) {
    const right = node['right'] as Record<string, unknown> | undefined;
    const left = node['left'] as Record<string, unknown> | undefined;

    if (isNullNode(right) || isNullNode(left)) {
      throw nullComparisonError({ sql });
    }
  }

  // Recurse into children
  if (node['left']) walkWhere(node['left'] as Record<string, unknown>, sql);
  if (node['right']) walkWhere(node['right'] as Record<string, unknown>, sql);
  if (node['args']) {
    const args = node['args'];
    if (Array.isArray(args)) {
      for (const arg of args) walkWhere(arg as Record<string, unknown>, sql);
    } else if (typeof args === 'object') {
      walkWhere(args as Record<string, unknown>, sql);
    }
  }
}

function isNullNode(node: unknown): boolean {
  if (!node || typeof node !== 'object') return false;
  const n = node as Record<string, unknown>;
  return n['type'] === 'null' || n['value'] === null;
}
