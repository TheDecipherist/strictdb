/**
 * SQL Mode 2 — Parser
 *
 * Wraps node-sql-parser. Handles parameter binding (? and $N styles).
 * Splits multi-statement blocks for transactions.
 *
 * PERFORMANCE: node-sql-parser (2.5MB) is lazy-loaded on first parseSql() call.
 * Users who never call db.sql() pay zero import cost.
 */

import { paramMismatchError, parseError } from './errors.js';
import type { SqlMode2Dialect } from './types.js';

// ─── Lazy-loaded parser ─────────────────────────────────────────────────────

type ParserInstance = { astify(sql: string, opts: { database: string }): unknown };
let _parser: ParserInstance | undefined;
let _parserPromise: Promise<ParserInstance> | undefined;

/**
 * Ensure the parser is loaded. Call once (e.g., from SqlEngine.execute)
 * before any synchronous parseSql() calls.
 */
export async function ensureParser(): Promise<void> {
  if (_parser) return;
  if (!_parserPromise) {
    _parserPromise = (async () => {
      const mod = await import('node-sql-parser');
      const Parser = mod.default?.Parser ?? (mod as unknown as { Parser: new () => ParserInstance }).Parser;
      _parser = new Parser();
      return _parser;
    })();
  }
  await _parserPromise;
}

function getParserSync(): ParserInstance {
  if (!_parser) {
    // In production ESM, ensureParser() MUST be called first (SqlEngine.execute does this).
    // In test environments (vitest/tsx), we can fall back to synchronous loading.
    try {
      /* eslint-disable @typescript-eslint/no-require-imports */
      const mod = typeof require !== 'undefined'
        ? require('node-sql-parser') as Record<string, unknown>
        : undefined;
      /* eslint-enable @typescript-eslint/no-require-imports */
      if (mod) {
        const Parser = (mod['Parser'] ?? (mod['default'] as Record<string, unknown>)?.['Parser']) as new () => ParserInstance;
        _parser = new Parser();
      } else {
        throw new Error('require not available');
      }
    } catch {
      throw new Error(
        'SQL parser not initialized. Ensure db.sql() is called (it loads the parser automatically), or call await ensureParser() first.',
      );
    }
  }
  return _parser!;
}

const DIALECT_MAP: Record<SqlMode2Dialect, string> = {
  mysql: 'MySQL',
  postgresql: 'PostgreSQL',
  mariadb: 'MariaDB',
  sqlite: 'SQLite',
  bigquery: 'BigQuery',
};

// ─── Parameter Binding ──────────────────────────────────────────────────────

/**
 * Bind parameters into the SQL string before parsing.
 * Supports both ? (MySQL) and $N (PostgreSQL) styles.
 * All binding is quote-aware — placeholders inside string literals are ignored.
 */
export function bindParams(sql: string, params: unknown[] | undefined, dialect: SqlMode2Dialect = 'mysql'): string {
  if (!params || params.length === 0) return sql;

  if (dialect === 'postgresql') {
    return bindPgParams(sql, params);
  }
  return bindMysqlParams(sql, params);
}

function bindMysqlParams(sql: string, params: unknown[]): string {
  const placeholderCount = countQuoteAware(sql, '?');
  if (placeholderCount !== params.length) {
    throw paramMismatchError(placeholderCount, params.length, { sql });
  }

  let paramIdx = 0;
  return replaceQuoteAware(sql, '?', () => {
    const val = params[paramIdx++];
    return formatValue(val);
  });
}

function bindPgParams(sql: string, params: unknown[]): string {
  // Quote-aware scan: find all $N references NOT inside string literals
  const refs = new Set<number>();
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i]!;
    if (ch === "'" && !inDouble) { inSingle = !inSingle; continue; }
    if (ch === '"' && !inSingle) { inDouble = !inDouble; continue; }
    if (ch === '$' && !inSingle && !inDouble) {
      let numStr = '';
      let j = i + 1;
      while (j < sql.length && sql[j]! >= '0' && sql[j]! <= '9') {
        numStr += sql[j]!;
        j++;
      }
      if (numStr.length > 0) {
        refs.add(parseInt(numStr, 10));
      }
    }
  }

  const maxRef = refs.size > 0 ? Math.max(...refs) : 0;
  if (maxRef !== params.length) {
    throw paramMismatchError(maxRef, params.length, { sql });
  }

  // Quote-aware replacement of $N
  const parts: string[] = [];
  inSingle = false;
  inDouble = false;
  let segStart = 0;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i]!;
    if (ch === "'" && !inDouble) { inSingle = !inSingle; continue; }
    if (ch === '"' && !inSingle) { inDouble = !inDouble; continue; }
    if (ch === '$' && !inSingle && !inDouble) {
      let numStr = '';
      let j = i + 1;
      while (j < sql.length && sql[j]! >= '0' && sql[j]! <= '9') {
        numStr += sql[j]!;
        j++;
      }
      if (numStr.length > 0) {
        parts.push(sql.slice(segStart, i));
        const idx = parseInt(numStr, 10) - 1;
        parts.push(formatValue(params[idx]));
        segStart = j;
        i = j - 1; // skip past the number
      }
    }
  }
  parts.push(sql.slice(segStart));
  return parts.join('');
}

function formatValue(val: unknown): string {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'number') return String(val);
  if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE';
  if (typeof val === 'string') return `'${val.replace(/'/g, "''")}'`;
  if (val instanceof Date) return `'${val.toISOString()}'`;
  return `'${String(val).replace(/'/g, "''")}'`;
}

// ─── Quote-Aware Helpers ────────────────────────────────────────────────────

function countQuoteAware(sql: string, marker: string): number {
  let count = 0;
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i]!;
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === marker && !inSingle && !inDouble) count++;
  }
  return count;
}

function replaceQuoteAware(sql: string, marker: string, replacer: () => string): string {
  // Build with array.join() instead of string concatenation (O(n) vs O(n²))
  const parts: string[] = [];
  let inSingle = false;
  let inDouble = false;
  let segStart = 0;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i]!;
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
    } else if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
    } else if (ch === marker && !inSingle && !inDouble) {
      parts.push(sql.slice(segStart, i));
      parts.push(replacer());
      segStart = i + 1;
    }
  }
  parts.push(sql.slice(segStart));
  return parts.join('');
}

// ─── SQL Parsing ────────────────────────────────────────────────────────────

/**
 * Parse a SQL string into an AST.
 * Lazy-loads node-sql-parser on first call.
 */
export function parseSql(sql: string, dialect: SqlMode2Dialect = 'mysql'): unknown {
  const p = getParserSync();
  const dbType = DIALECT_MAP[dialect] ?? 'MySQL';
  try {
    return p.astify(sql, { database: dbType });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw parseError({ sql, detail: msg });
  }
}

// ─── Statement Splitting ────────────────────────────────────────────────────

/**
 * Split a multi-statement SQL block into individual statements.
 * Quote-aware — semicolons inside string literals are preserved.
 */
export function splitStatements(sql: string): string[] {
  const statements: string[] = [];
  let inSingle = false;
  let inDouble = false;
  let segStart = 0;

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i]!;
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === ';' && !inSingle && !inDouble) {
      const stmt = sql.slice(segStart, i).trim();
      if (stmt.length > 0) statements.push(stmt);
      segStart = i + 1;
    }
  }

  // Last segment (no trailing semicolon)
  const last = sql.slice(segStart).trim();
  if (last.length > 0) statements.push(last);

  return statements;
}

/**
 * Check if a SQL string is a transaction block.
 */
export function isTransactionBlock(sql: string): boolean {
  const upper = sql.toUpperCase().trim();
  return upper.startsWith('BEGIN') || upper.startsWith('START TRANSACTION');
}
