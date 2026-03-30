/**
 * MongoDB Connection Management
 *
 * Singleton pool, connect/close, default db accessor.
 * Extracted from mongo.ts — pure code movement.
 */

import {
  type Collection,
  type Db,
  type Document,
  MongoClient,
} from 'mongodb';

// ---------------------------------------------------------------------------
// Pool configuration
// ---------------------------------------------------------------------------

type PoolPreset = 'high' | 'standard' | 'low';

interface PoolConfig {
  maxPoolSize: number;
  minPoolSize: number;
}

const POOL_PRESETS: Record<PoolPreset, PoolConfig> = {
  high: { maxPoolSize: 20, minPoolSize: 2 },
  standard: { maxPoolSize: 10, minPoolSize: 2 },
  low: { maxPoolSize: 5, minPoolSize: 1 },
};

export interface ConnectOptions {
  /** Pool size preset or custom config */
  pool?: PoolPreset | PoolConfig;
  /** Database name (defaults to DATABASE_NAME env or 'app') */
  dbName?: string;
  /** Label for logging */
  label?: string;
  /** Enable Next.js hot-reload persistence via globalThis */
  nextjs?: boolean;
}

// ---------------------------------------------------------------------------
// Singleton pool management
// ---------------------------------------------------------------------------

const globalSymbol = Symbol.for('__mongo_pools__');

interface PoolEntry {
  client: MongoClient;
  db: Db;
  label: string;
}

/** Get or create the global pool map (survives Next.js hot-reload) */
function getPoolMap(): Map<string, PoolEntry> {
  const g = globalThis as Record<symbol, Map<string, PoolEntry> | undefined>;
  if (!g[globalSymbol]) {
    g[globalSymbol] = new Map();
  }
  return g[globalSymbol]!;
}

/** Check if a MongoClient is still alive */
function isClientAlive(client: MongoClient): boolean {
  try {
    // topology is internal but reliable for health checks
    const topology = (client as unknown as Record<string, unknown>).topology;
    if (!topology) return false;
    const desc = (topology as Record<string, unknown>).description;
    if (!desc) return false;
    const type = (desc as Record<string, string>).type;
    return type !== 'Unknown' && type !== undefined;
  } catch {
    return false;
  }
}

/**
 * Connect to MongoDB. Returns the same client/db for the same URI (singleton).
 * Safe to call multiple times — only connects once per URI.
 */
export async function connect(
  uri?: string,
  options: ConnectOptions = {}
): Promise<{ client: MongoClient; db: Db }> {
  const connectionUri = uri ?? process.env.MONGODB_URI ?? process.env.DATABASE_URL ?? '';
  if (!connectionUri) {
    throw new Error(
      'No MongoDB URI provided. Set MONGODB_URI or DATABASE_URL environment variable.'
    );
  }

  const pools = getPoolMap();
  const existing = pools.get(connectionUri);

  if (existing && isClientAlive(existing.client)) {
    return { client: existing.client, db: existing.db };
  }

  // Resolve pool config
  const poolConfig: PoolConfig =
    typeof options.pool === 'string'
      ? POOL_PRESETS[options.pool]
      : options.pool ?? POOL_PRESETS.standard;

  const dbName = options.dbName ?? process.env.DATABASE_NAME ?? 'app';
  const label = options.label ?? 'default';

  const client = new MongoClient(connectionUri, {
    maxPoolSize: poolConfig.maxPoolSize,
    minPoolSize: poolConfig.minPoolSize,
    maxIdleTimeMS: 30_000,
    serverSelectionTimeoutMS: 15_000,
  });

  await client.connect();
  const db = client.db(dbName);

  pools.set(connectionUri, { client, db, label });
  console.log(`[db:${label}] Connected to ${dbName} (pool: ${poolConfig.maxPoolSize} max)`);

  return { client, db };
}

/** Close all connection pools. Call on graceful shutdown. */
export async function closePool(): Promise<void> {
  const pools = getPoolMap();
  const closePromises: Promise<void>[] = [];

  for (const [uri, entry] of pools) {
    console.log(`[db:${entry.label}] Closing connection pool...`);
    closePromises.push(entry.client.close());
    pools.delete(uri);
  }

  await Promise.all(closePromises);
}

// ---------------------------------------------------------------------------
// Default database accessor (convenience)
// ---------------------------------------------------------------------------

let _defaultDb: Db | null = null;
let _defaultClient: MongoClient | null = null;

/** Get the default database instance. Connects automatically if needed. */
export async function getDb(options?: ConnectOptions): Promise<Db> {
  if (_defaultDb && _defaultClient && isClientAlive(_defaultClient)) {
    return _defaultDb;
  }
  const { client, db } = await connect(undefined, options);
  _defaultDb = db;
  _defaultClient = client;
  return db;
}

/** Get a typed collection from the default database */
export async function getCollection<T extends Document>(
  name: string
): Promise<Collection<T>> {
  const db = await getDb();
  return db.collection<T>(name);
}

// ---------------------------------------------------------------------------
// Graceful shutdown — wire to process signals and crash handlers
// ---------------------------------------------------------------------------

let _shuttingDown = false;

/**
 * Gracefully close all MongoDB pools and exit the process.
 * Safe to call multiple times — only runs once.
 *
 * Wire this to ALL process exit events in your entry point:
 *
 * ```typescript
 * import { gracefulShutdown } from '@/core/db/index.js';
 *
 * process.on('SIGTERM', gracefulShutdown);
 * process.on('SIGINT', gracefulShutdown);
 * process.on('uncaughtException', (err) => {
 *   console.error('Uncaught Exception:', err);
 *   gracefulShutdown(1);
 * });
 * process.on('unhandledRejection', (reason) => {
 *   console.error('Unhandled Rejection:', reason);
 *   gracefulShutdown(1);
 * });
 * ```
 */
export async function gracefulShutdown(exitCode: number | unknown = 0): Promise<void> {
  if (_shuttingDown) return;
  _shuttingDown = true;

  const code = typeof exitCode === 'number' ? exitCode : 1;

  console.log(`[db] Graceful shutdown initiated (exit code: ${code})...`);

  try {
    await closePool();
    console.log('[db] All connection pools closed.');
  } catch (err) {
    console.error('[db] Error during pool shutdown:', err);
  }

  process.exit(code);
}
