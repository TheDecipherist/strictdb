/**
 * StrictDB MCP Tool Definitions
 *
 * Every tool includes Zod-generated input schemas with descriptions.
 * When an AI connects to the StrictDB MCP server, it gets self-documenting tools.
 */

import { z } from 'zod';

const filterSchema = z.record(z.unknown()).describe('MongoDB-style filter object. Example: { role: "admin", age: { $gte: 18 } }');
const collectionSchema = z.string().describe('Collection/table/index name');
const updateSchema = z.object({
  $set: z.record(z.unknown()).optional().describe('Set field values'),
  $inc: z.record(z.number()).optional().describe('Increment numeric fields'),
  $unset: z.record(z.literal(true)).optional().describe('Remove fields'),
}).describe('Update operators');

export const toolDefinitions = {
  strictdb_query_one: {
    description: 'Find a single document matching the filter. Returns null if not found.',
    inputSchema: z.object({
      collection: collectionSchema,
      filter: filterSchema,
      sort: z.record(z.union([z.literal(1), z.literal(-1)])).optional().describe('Sort specification'),
    }),
  },
  strictdb_query_many: {
    description: 'Find multiple documents matching the filter. Always include a limit.',
    inputSchema: z.object({
      collection: collectionSchema,
      filter: filterSchema,
      sort: z.record(z.union([z.literal(1), z.literal(-1)])).optional(),
      limit: z.number().int().positive().describe('Maximum number of results (required)'),
      skip: z.number().int().nonnegative().optional().describe('Number of results to skip'),
    }),
  },
  strictdb_count: {
    description: 'Count documents matching the filter.',
    inputSchema: z.object({
      collection: collectionSchema,
      filter: filterSchema.optional(),
    }),
  },
  strictdb_insert_one: {
    description: 'Insert a single document. Returns an operation receipt.',
    inputSchema: z.object({
      collection: collectionSchema,
      doc: z.record(z.unknown()).describe('Document to insert'),
    }),
  },
  strictdb_insert_many: {
    description: 'Insert multiple documents. Returns an operation receipt.',
    inputSchema: z.object({
      collection: collectionSchema,
      docs: z.array(z.record(z.unknown())).describe('Array of documents to insert'),
    }),
  },
  strictdb_update_one: {
    description: 'Update a single document matching the filter. Returns an operation receipt.',
    inputSchema: z.object({
      collection: collectionSchema,
      filter: filterSchema,
      update: updateSchema,
      upsert: z.boolean().optional().describe('Create document if not found'),
    }),
  },
  strictdb_update_many: {
    description: 'Update all documents matching the filter. Returns an operation receipt.',
    inputSchema: z.object({
      collection: collectionSchema,
      filter: filterSchema,
      update: updateSchema,
    }),
  },
  strictdb_delete_one: {
    description: 'Delete a single document matching the filter. Returns an operation receipt.',
    inputSchema: z.object({
      collection: collectionSchema,
      filter: filterSchema,
    }),
  },
  strictdb_delete_many: {
    description: 'Delete all documents matching the filter. Requires non-empty filter.',
    inputSchema: z.object({
      collection: collectionSchema,
      filter: filterSchema,
    }),
  },
  strictdb_describe: {
    description: 'Discover the schema of a collection. Call this BEFORE writing any query.',
    inputSchema: z.object({
      collection: collectionSchema,
    }),
  },
  strictdb_validate: {
    description: 'Dry-run validate an operation without executing it.',
    inputSchema: z.object({
      collection: collectionSchema,
      filter: filterSchema.optional(),
      update: updateSchema.optional(),
      doc: z.record(z.unknown()).optional(),
    }),
  },
  strictdb_explain: {
    description: 'Show the native query that would be executed.',
    inputSchema: z.object({
      collection: collectionSchema,
      filter: filterSchema.optional(),
      sort: z.record(z.union([z.literal(1), z.literal(-1)])).optional(),
      limit: z.number().int().positive().optional(),
    }),
  },
  strictdb_status: {
    description: 'Check database connection health.',
    inputSchema: z.object({}),
  },
  strictdb_batch: {
    description: 'Execute multiple operations in a single optimized batch.',
    inputSchema: z.object({
      operations: z.array(z.object({
        operation: z.enum(['insertOne', 'insertMany', 'updateOne', 'updateMany', 'deleteOne', 'deleteMany']),
        collection: collectionSchema,
        doc: z.record(z.unknown()).optional(),
        docs: z.array(z.record(z.unknown())).optional(),
        filter: filterSchema.optional(),
        update: updateSchema.optional(),
      })),
    }),
  },
} as const;
