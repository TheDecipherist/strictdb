#!/usr/bin/env node
/**
 * StrictDB MCP Server
 *
 * The primary interface for AI agents. AI doesn't write database code — it calls tools.
 * StrictDB holds the connection, the AI holds nothing.
 * Database-agnostic: the AI never knows what backend it's talking to.
 */

import { StrictDB } from 'strictdb';
import type { StrictDBConfig, BatchOperation } from 'strictdb';

let db: StrictDB | null = null;

async function getDB(): Promise<StrictDB> {
  if (db) return db;

  const uri = process.env['STRICTDB_URI'];
  if (!uri) {
    throw new Error('STRICTDB_URI environment variable is required');
  }

  const config: StrictDBConfig = {
    uri,
    dbName: process.env['STRICTDB_DB_NAME'],
    label: 'MCP',
    guardrails: true,
    sanitize: true,
    logging: true,
  };

  if (process.env['STRICTDB_ES_API_KEY']) {
    config.elastic = { apiKey: process.env['STRICTDB_ES_API_KEY'] };
  }

  db = await StrictDB.create(config);
  return db;
}

/**
 * Handle an MCP tool call. Returns the result as a JSON-serializable object.
 */
export async function handleToolCall(
  toolName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const database = await getDB();

  switch (toolName) {
    case 'strictdb_query_one':
      return database.queryOne(
        args['collection'] as string,
        (args['filter'] ?? {}) as Record<string, unknown>,
        {
          sort: args['sort'] as Record<string, 1 | -1> | undefined,
        },
      );

    case 'strictdb_query_many':
      return database.queryMany(
        args['collection'] as string,
        (args['filter'] ?? {}) as Record<string, unknown>,
        {
          sort: args['sort'] as Record<string, 1 | -1> | undefined,
          limit: args['limit'] as number,
          skip: args['skip'] as number | undefined,
        },
      );

    case 'strictdb_count':
      return database.count(
        args['collection'] as string,
        args['filter'] as Record<string, unknown> | undefined,
      );

    case 'strictdb_insert_one':
      return database.insertOne(
        args['collection'] as string,
        args['doc'] as Record<string, unknown>,
      );

    case 'strictdb_insert_many':
      return database.insertMany(
        args['collection'] as string,
        args['docs'] as Record<string, unknown>[],
      );

    case 'strictdb_update_one':
      return database.updateOne(
        args['collection'] as string,
        (args['filter'] ?? {}) as Record<string, unknown>,
        args['update'] as Record<string, unknown>,
        args['upsert'] as boolean | undefined,
      );

    case 'strictdb_update_many':
      return database.updateMany(
        args['collection'] as string,
        (args['filter'] ?? {}) as Record<string, unknown>,
        args['update'] as Record<string, unknown>,
      );

    case 'strictdb_delete_one':
      return database.deleteOne(
        args['collection'] as string,
        (args['filter'] ?? {}) as Record<string, unknown>,
      );

    case 'strictdb_delete_many':
      return database.deleteMany(
        args['collection'] as string,
        (args['filter'] ?? {}) as Record<string, unknown>,
      );

    case 'strictdb_describe':
      return database.describe(args['collection'] as string);

    case 'strictdb_validate':
      return database.validate(
        args['collection'] as string,
        {
          filter: args['filter'] as Record<string, unknown> | undefined,
          update: args['update'] as Record<string, unknown> | undefined,
          doc: args['doc'] as Record<string, unknown> | undefined,
        },
      );

    case 'strictdb_explain':
      return database.explain(
        args['collection'] as string,
        {
          filter: args['filter'] as Record<string, unknown> | undefined,
          sort: args['sort'] as Record<string, unknown> | undefined,
          limit: args['limit'] as number | undefined,
        },
      );

    case 'strictdb_status':
      return database.status();

    case 'strictdb_batch': {
      const operations = args['operations'] as BatchOperation[];
      return database.batch(operations);
    }

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  if (db) await db.gracefulShutdown(0);
});

process.on('SIGINT', async () => {
  if (db) await db.gracefulShutdown(0);
});
