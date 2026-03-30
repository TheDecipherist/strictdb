/**
 * Centralized SQL Database Wrapper — PostgreSQL, MySQL, MSSQL, SQLite
 *
 * ALL SQL database access MUST go through this file.
 * NEVER create connection pools anywhere else.
 * NEVER import `pg`/`mysql2`/`mssql`/`better-sqlite3` directly in other files.
 *
 * Mirrors the MongoDB wrapper pattern (src/core/db/index.ts):
 * - Singleton pool per URI (prevents connection exhaustion)
 * - Parameterized queries ALWAYS (prevents SQL injection)
 * - Graceful shutdown with closePool()
 * - Next.js hot-reload persistence via globalThis
 *
 * Driver auto-detection from DATABASE_URL scheme:
 *   postgresql:// or postgres:// → pg
 *   mysql://                     → mysql2
 *   mssql://                     → mssql
 *   file: or sqlite:            → better-sqlite3
 *
 * Install the driver for your database:
 *   PostgreSQL: npm install pg @types/pg
 *   MySQL:      npm install mysql2
 *   MSSQL:      npm install mssql
 *   SQLite:     npm install better-sqlite3 @types/better-sqlite3
 */

// Re-export connection management
export {
  connect,
  getPool,
  closePool,
  gracefulShutdown,
  withTransaction,
} from './sql-connection.js';
export type { PoolOptions, ResultSet } from './sql-connection.js';

// Import what we need internally
import { getPool } from './sql-connection.js';

// ─── Read Operations ────────────────────────────────────────────────────────

/**
 * Query a single row. Returns null if not found.
 * ALWAYS use parameterized queries — NEVER interpolate values.
 *
 * @example
 * const user = await queryOne<User>('SELECT * FROM users WHERE id = $1', [userId]);
 */
export async function queryOne<T>(sql: string, params?: unknown[]): Promise<T | null> {
  const pool = getPool();
  const result = await pool.query(sql, params);
  return (result.rows[0] as T) ?? null;
}

/**
 * Query multiple rows.
 *
 * @example
 * const users = await queryMany<User>('SELECT * FROM users WHERE role = $1 LIMIT $2', ['admin', 50]);
 */
export async function queryMany<T>(sql: string, params?: unknown[]): Promise<T[]> {
  const pool = getPool();
  const result = await pool.query(sql, params);
  return result.rows as T[];
}

/**
 * Count rows in a table with optional WHERE clause.
 *
 * @example
 * const total = await count('users', { role: 'admin' });
 */
export async function count(table: string, where?: Record<string, unknown>): Promise<number> {
  const pool = getPool();
  if (!where || Object.keys(where).length === 0) {
    const result = await pool.query(`SELECT COUNT(*) as count FROM "${table}"`);
    return Number((result.rows[0] as { count: string | number }).count);
  }
  const { clause, values } = buildWhere(where);
  const result = await pool.query(`SELECT COUNT(*) as count FROM "${table}" WHERE ${clause}`, values);
  return Number((result.rows[0] as { count: string | number }).count);
}

// ─── Write Operations ───────────────────────────────────────────────────────

/**
 * Execute a raw SQL statement.
 *
 * @example
 * await execute('UPDATE users SET active = $1 WHERE last_login < $2', [false, cutoffDate]);
 */
export async function execute(sql: string, params?: unknown[]): Promise<{ rowCount: number; rows?: unknown[] }> {
  const pool = getPool();
  const result = await pool.query(sql, params);
  return { rowCount: result.rowCount, rows: result.rows };
}

/**
 * Insert a single row into a table.
 *
 * @example
 * await insertOne('users', { email: 'a@b.com', name: 'Alice', created_at: new Date() });
 */
export async function insertOne(table: string, data: Record<string, unknown>): Promise<{ rowCount: number; rows?: unknown[] }> {
  const keys = Object.keys(data);
  const values = Object.values(data);
  const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
  const columns = keys.map((k) => `"${k}"`).join(', ');
  return execute(
    `INSERT INTO "${table}" (${columns}) VALUES (${placeholders})`,
    values,
  );
}

/**
 * Insert multiple rows in a single statement.
 *
 * @example
 * await insertMany('events', [{ type: 'click', ts: new Date() }, { type: 'view', ts: new Date() }]);
 */
export async function insertMany(table: string, rows: Record<string, unknown>[]): Promise<void> {
  if (rows.length === 0) return;
  const keys = Object.keys(rows[0]!);
  const columns = keys.map((k) => `"${k}"`).join(', ');
  const allValues: unknown[] = [];
  const rowPlaceholders: string[] = [];

  rows.forEach((row, rowIdx) => {
    const placeholders = keys.map((_, colIdx) => `$${rowIdx * keys.length + colIdx + 1}`);
    rowPlaceholders.push(`(${placeholders.join(', ')})`);
    keys.forEach((k) => allValues.push(row[k]));
  });

  await execute(
    `INSERT INTO "${table}" (${columns}) VALUES ${rowPlaceholders.join(', ')}`,
    allValues,
  );
}

/**
 * Update a single row matching the WHERE clause.
 *
 * @example
 * await updateOne('users', { id: 1 }, { name: 'Bob', updated_at: new Date() });
 */
export async function updateOne(
  table: string,
  where: Record<string, unknown>,
  set: Record<string, unknown>,
): Promise<{ rowCount: number; rows?: unknown[] }> {
  const setKeys = Object.keys(set);
  const whereKeys = Object.keys(where);
  const allValues = [...Object.values(set), ...Object.values(where)];

  const setClauses = setKeys.map((k, i) => `"${k}" = $${i + 1}`).join(', ');
  const whereClauses = whereKeys.map((k, i) => `"${k}" = $${setKeys.length + i + 1}`).join(' AND ');

  return execute(
    `UPDATE "${table}" SET ${setClauses} WHERE ${whereClauses}`,
    allValues,
  );
}

/**
 * Delete a single row matching the WHERE clause.
 *
 * @example
 * await deleteOne('tokens', { token: 'abc123' });
 */
export async function deleteOne(table: string, where: Record<string, unknown>): Promise<{ rowCount: number; rows?: unknown[] }> {
  const { clause, values } = buildWhere(where);
  return execute(`DELETE FROM "${table}" WHERE ${clause}`, values);
}

// ─── SQL Injection Prevention ───────────────────────────────────────────────

/**
 * Build a parameterized WHERE clause from a key-value object.
 * NEVER string-interpolate user input into SQL — use this instead.
 *
 * @example
 * const { clause, values } = buildWhere({ email: 'a@b.com', active: true });
 * // clause: '"email" = $1 AND "active" = $2'
 * // values: ['a@b.com', true]
 */
export function buildWhere(
  where: Record<string, unknown>,
  startIdx = 1,
): { clause: string; values: unknown[] } {
  const keys = Object.keys(where);
  const values = Object.values(where);
  const clause = keys.map((k, i) => `"${k}" = $${startIdx + i}`).join(' AND ');
  return { clause, values };
}
