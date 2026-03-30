/**
 * SQL Connection Management — PostgreSQL, MySQL, MSSQL, SQLite
 *
 * Singleton pool, connect/close, transactions.
 * Extracted from sql.ts — pure code movement.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export interface PoolOptions {
  pool?: 'high' | 'standard' | 'low';
  label?: string;
}

export interface ResultSet {
  rowCount: number;
  rows?: unknown[];
}

export interface PoolClient {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[]; rowCount: number }>;
  release(): void;
}

interface Pool {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[]; rowCount: number }>;
  connect(): Promise<PoolClient>;
  end(): Promise<void>;
}

// ─── Pool Presets ───────────────────────────────────────────────────────────

const POOL_PRESETS = {
  high: { max: 20, min: 2 },
  standard: { max: 10, min: 2 },
  low: { max: 5, min: 1 },
} as const;

// ─── Singleton Pool ─────────────────────────────────────────────────────────

const POOL_KEY = Symbol.for('__sql_pool__');
const LABEL_KEY = Symbol.for('__sql_label__');

function getGlobal(): { pool?: Pool; label?: string } {
  const g = globalThis as Record<symbol, unknown>;
  return {
    pool: g[POOL_KEY] as Pool | undefined,
    label: g[LABEL_KEY] as string | undefined,
  };
}

function setGlobal(pool: Pool, label: string): void {
  const g = globalThis as Record<symbol, unknown>;
  g[POOL_KEY] = pool;
  g[LABEL_KEY] = label;
}

function clearGlobal(): void {
  const g = globalThis as Record<symbol, unknown>;
  delete g[POOL_KEY];
  delete g[LABEL_KEY];
}

// ─── Driver Detection ───────────────────────────────────────────────────────

type DriverType = 'pg' | 'mysql2' | 'mssql' | 'sqlite';

function detectDriver(uri: string): DriverType {
  if (uri.startsWith('postgresql://') || uri.startsWith('postgres://')) return 'pg';
  if (uri.startsWith('mysql://')) return 'mysql2';
  if (uri.startsWith('mssql://')) return 'mssql';
  if (uri.startsWith('file:') || uri.startsWith('sqlite:')) return 'sqlite';
  throw new Error(
    `Cannot detect SQL driver from URI. Expected scheme: postgresql://, postgres://, mysql://, mssql://, file:, or sqlite:. Got: ${uri.substring(0, 20)}...`,
  );
}

// ─── Connection ─────────────────────────────────────────────────────────────

/**
 * Connect to the SQL database. Auto-detects driver from DATABASE_URL scheme.
 *
 * @param uri - Connection string (defaults to process.env.DATABASE_URL)
 * @param opts - Pool size preset and label
 *
 * @example
 * await connect(); // uses DATABASE_URL from .env
 * await connect(undefined, { pool: 'high', label: 'API' });
 */
export async function connect(
  uri?: string,
  opts: PoolOptions = {},
): Promise<void> {
  const existing = getGlobal();
  if (existing.pool) return; // Already connected

  const connectionString = uri ?? process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL not set and no URI provided');
  }

  const preset = POOL_PRESETS[opts.pool ?? 'standard'];
  const label = opts.label ?? 'SQL';
  const driver = detectDriver(connectionString);

  let pool: Pool;

  switch (driver) {
    case 'pg': {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { Pool: PgPool } = await import('pg');
      pool = new PgPool({
        connectionString,
        max: preset.max,
        min: preset.min,
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 5_000,
      }) as unknown as Pool;
      break;
    }
    case 'mysql2': {
      const mysql = await import('mysql2/promise');
      const mysqlPool = mysql.createPool({
        uri: connectionString,
        connectionLimit: preset.max,
        waitForConnections: true,
        queueLimit: 0,
      });
      // Adapt mysql2 pool to our Pool interface
      pool = {
        async query(sql: string, params?: unknown[]) {
          const [rows] = await mysqlPool.execute(sql, params as (string | number | boolean | null | Buffer)[]);
          const resultRows = Array.isArray(rows) ? rows : [];
          return { rows: resultRows as unknown[], rowCount: resultRows.length };
        },
        async connect() {
          const conn = await mysqlPool.getConnection();
          return {
            async query(sql: string, params?: unknown[]) {
              const [rows] = await conn.execute(sql, params as (string | number | boolean | null | Buffer)[]);
              const resultRows = Array.isArray(rows) ? rows : [];
              return { rows: resultRows as unknown[], rowCount: resultRows.length };
            },
            release() { conn.release(); },
          };
        },
        async end() { await mysqlPool.end(); },
      };
      break;
    }
    case 'mssql': {
      const mssql = await import('mssql');
      const mssqlPool = await mssql.connect({
        connectionString,
        pool: { max: preset.max, min: preset.min },
      } as unknown as Parameters<typeof mssql.connect>[0]);
      pool = {
        async query(sql: string, params?: unknown[]) {
          const request = mssqlPool.request();
          params?.forEach((p, i) => request.input(`p${i + 1}`, p));
          // MSSQL uses @p1, @p2 instead of $1, $2
          const adapted = sql.replace(/\$(\d+)/g, (_, n) => `@p${n}`);
          const result = await request.query(adapted);
          return { rows: result.recordset ?? [], rowCount: result.rowsAffected[0] ?? 0 };
        },
        async connect() {
          return {
            async query(sql: string, params?: unknown[]) {
              const request = mssqlPool.request();
              params?.forEach((p, i) => request.input(`p${i + 1}`, p));
              const adapted = sql.replace(/\$(\d+)/g, (_, n) => `@p${n}`);
              const result = await request.query(adapted);
              return { rows: result.recordset ?? [], rowCount: result.rowsAffected[0] ?? 0 };
            },
            release() { /* MSSQL pools manage connections internally */ },
          };
        },
        async end() { await mssqlPool.close(); },
      };
      break;
    }
    case 'sqlite': {
      const Database = (await import('better-sqlite3')).default;
      const dbPath = connectionString.replace(/^(file:|sqlite:)\/\//, '');
      const db = new Database(dbPath);
      db.pragma('journal_mode = WAL');
      pool = {
        async query(sql: string, params?: unknown[]) {
          // Convert $1, $2 placeholders to ? for SQLite
          const adapted = sql.replace(/\$\d+/g, '?');
          if (adapted.trimStart().toUpperCase().startsWith('SELECT') ||
              adapted.trimStart().toUpperCase().startsWith('WITH')) {
            const rows = db.prepare(adapted).all(...(params ?? []));
            return { rows: rows as unknown[], rowCount: rows.length };
          }
          const result = db.prepare(adapted).run(...(params ?? []));
          return { rows: [], rowCount: result.changes };
        },
        async connect() {
          return {
            async query(sql: string, params?: unknown[]) {
              const adapted = sql.replace(/\$\d+/g, '?');
              if (adapted.trimStart().toUpperCase().startsWith('SELECT') ||
                  adapted.trimStart().toUpperCase().startsWith('WITH')) {
                const rows = db.prepare(adapted).all(...(params ?? []));
                return { rows: rows as unknown[], rowCount: rows.length };
              }
              const result = db.prepare(adapted).run(...(params ?? []));
              return { rows: [], rowCount: result.changes };
            },
            release() { /* SQLite is single-connection */ },
          };
        },
        async end() { db.close(); },
      };
      break;
    }
    default:
      throw new Error(`Unsupported database driver: ${driver}. DATABASE_URL must start with postgresql://, postgres://, mysql://, mssql://, file:, or sqlite:`);
  }

  setGlobal(pool, label);
  console.log(`[${label}] SQL pool connected (${opts.pool ?? 'standard'} preset, max=${preset.max})`);
}

// ─── Pool Access ────────────────────────────────────────────────────────────

/** Get the active connection pool. Throws if not connected. */
export function getPool(): Pool {
  const { pool } = getGlobal();
  if (!pool) throw new Error('SQL pool not connected. Call connect() first.');
  return pool;
}

/** Close the connection pool. */
export async function closePool(): Promise<void> {
  const { pool, label } = getGlobal();
  if (!pool) return;
  await pool.end();
  clearGlobal();
  console.log(`[${label}] SQL pool closed`);
}

// ─── Graceful Shutdown ──────────────────────────────────────────────────────

let shutdownCalled = false;

/** Idempotent shutdown — safe to call from multiple signal handlers. */
export function gracefulShutdown(exitCode = 0): void {
  if (shutdownCalled) return;
  shutdownCalled = true;
  closePool()
    .catch((err) => console.error('Error closing SQL pool:', err))
    .finally(() => process.exit(exitCode));
}

// ─── Transactions ───────────────────────────────────────────────────────────

/**
 * Execute a function within a database transaction.
 * Automatically commits on success, rolls back on error.
 *
 * @example
 * const result = await withTransaction(async (client) => {
 *   await client.query('UPDATE accounts SET balance = balance - $1 WHERE id = $2', [100, fromId]);
 *   await client.query('UPDATE accounts SET balance = balance + $1 WHERE id = $2', [100, toId]);
 *   return { success: true };
 * });
 */
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
  dialect?: 'pg' | 'mysql2' | 'mssql' | 'sqlite',
): Promise<T> {
  const pool = getPool();
  const client = await pool.connect();
  const beginCmd = dialect === 'mssql' ? 'BEGIN TRANSACTION' : 'BEGIN';
  try {
    await client.query(beginCmd);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
