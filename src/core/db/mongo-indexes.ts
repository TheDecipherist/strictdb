/**
 * MongoDB Index Management
 *
 * Register and create indexes declaratively.
 * Extracted from mongo.ts — pure code movement.
 */

import { getDb } from './mongo-connection.js';

// ---------------------------------------------------------------------------
// Index management
// ---------------------------------------------------------------------------

export interface IndexDefinition {
  /** Collection name */
  collection: string;
  /** Fields and sort direction (1 = asc, -1 = desc) */
  fields: Record<string, 1 | -1>;
  /** Create a unique constraint */
  unique?: boolean;
  /** Sparse index (only index docs that have the field) */
  sparse?: boolean;
  /** TTL index — auto-delete documents after N seconds */
  expireAfterSeconds?: number;
}

/** Registry of indexes to create */
const indexRegistry: IndexDefinition[] = [];

/**
 * Register an index to be created when ensureIndexes() is called.
 * Call this at module load time to declare your indexes alongside your queries.
 *
 * ```typescript
 * registerIndex({ collection: 'users', fields: { email: 1 }, unique: true });
 * registerIndex({ collection: 'sessions', fields: { userId: 1, startedAt: -1 } });
 * registerIndex({ collection: 'tokens', fields: { expiresAt: 1 }, expireAfterSeconds: 0 });
 * ```
 */
export function registerIndex(definition: IndexDefinition): void {
  indexRegistry.push(definition);
}

/**
 * Create all registered indexes.
 * Call once at application startup. Safe to call multiple times —
 * MongoDB skips indexes that already exist.
 *
 * ```typescript
 * // In your app startup:
 * import { ensureIndexes } from '@/core/db/index.js';
 * await ensureIndexes(); // creates all registered indexes
 * await ensureIndexes({ dryRun: true }); // just logs what would be created
 * ```
 */
export async function ensureIndexes(
  options: { dryRun?: boolean } = {}
): Promise<{ created: string[]; skipped: string[] }> {
  const db = await getDb();
  const created: string[] = [];
  const skipped: string[] = [];

  for (const def of indexRegistry) {
    const indexName = Object.entries(def.fields)
      .map(([k, v]) => `${k}_${v}`)
      .join('_');

    const label = `${def.collection}.${indexName}${def.unique ? ' (unique)' : ''}${def.sparse ? ' (sparse)' : ''}${def.expireAfterSeconds !== undefined ? ` (TTL: ${def.expireAfterSeconds}s)` : ''}`;

    if (options.dryRun) {
      console.log(`[db:index] Would create: ${label}`);
      skipped.push(label);
      continue;
    }

    try {
      const indexOptions: Record<string, unknown> = {};
      if (def.unique) indexOptions.unique = true;
      if (def.sparse) indexOptions.sparse = true;
      if (def.expireAfterSeconds !== undefined) {
        indexOptions.expireAfterSeconds = def.expireAfterSeconds;
      }

      await db.collection(def.collection).createIndex(def.fields, indexOptions);
      console.log(`[db:index] Created: ${label}`);
      created.push(label);
    } catch (err: unknown) {
      // Index already exists with same spec — safe to skip
      if (err && typeof err === 'object' && 'code' in err && (err as { code: number }).code === 85) {
        skipped.push(label);
      } else {
        throw err;
      }
    }
  }

  console.log(`[db:index] Done — ${created.length} created, ${skipped.length} skipped`);
  return { created, skipped };
}
