/**
 * StrictDB — All shared types and interfaces
 *
 * This is the ONLY file every other file imports.
 * No circular dependencies. No file imports from an adapter.
 */

import type { z } from 'zod';

// ─── Backend & Driver ────────────────────────────────────────────────────────

export type Backend = 'mongo' | 'sql' | 'elastic';
export type Driver = 'mongodb' | 'pg' | 'mysql2' | 'mssql' | 'sqlite' | 'elasticsearch';
export type SqlDialect = 'pg' | 'mysql2' | 'mssql' | 'sqlite';

// ─── Filter Operators (MongoDB-style, universal) ─────────────────────────────

export type FilterValue<T> = T | FilterOperators<T>;

export interface FilterOperators<T> {
  $eq?: T;
  $ne?: T;
  $gt?: T;
  $gte?: T;
  $lt?: T;
  $lte?: T;
  $in?: T[];
  $nin?: T[];
  $exists?: boolean;
  $regex?: string | RegExp;
  $options?: string;
  $not?: FilterOperators<T>;
  $size?: number;
}

export interface LogicalFilter<T> {
  $and?: StrictFilter<T>[];
  $or?: StrictFilter<T>[];
  $nor?: StrictFilter<T>[];
}

export type StrictFilter<T> = {
  [K in keyof T]?: FilterValue<T[K]>;
} & LogicalFilter<T>;

// ─── Update Operators ────────────────────────────────────────────────────────

export interface UpdateOperators<T> {
  $set?: Partial<T>;
  $inc?: { [K in keyof T]?: number };
  $unset?: { [K in keyof T]?: true };
  $push?: { [K in keyof T]?: T[K] extends Array<infer U> ? U : never };
  $pull?: { [K in keyof T]?: T[K] extends Array<infer U> ? U | StrictFilter<U> : never };
}

// ─── Sort, Projection, Pagination ────────────────────────────────────────────

export type SortDirection = 1 | -1 | 'asc' | 'desc';
export type SortSpec<T> = { [K in keyof T]?: SortDirection };
export type Projection<T> = { [K in keyof T]?: 1 | 0 };

export interface QueryOptions<T> {
  sort?: SortSpec<T>;
  limit?: number;
  skip?: number;
  projection?: Projection<T>;
}

// ─── Lookup (Joins) ─────────────────────────────────────────────────────────

export interface LookupOptions<T> {
  match: StrictFilter<T>;
  lookup: {
    from: string;
    localField: string;
    foreignField: string;
    as: string;
    type?: 'left' | 'inner';
  };
  unwind?: string;
  sort?: SortSpec<T>;
  limit?: number;
}

// ─── Index Definition ────────────────────────────────────────────────────────

export interface IndexDefinition {
  collection: string;
  fields: Record<string, 1 | -1>;
  unique?: boolean;
  sparse?: boolean;
  expireAfterSeconds?: number;
}

// ─── Operation Receipt ───────────────────────────────────────────────────────

export interface OperationReceipt {
  operation: 'insertOne' | 'insertMany' | 'updateOne' | 'updateMany' | 'deleteOne' | 'deleteMany' | 'batch';
  collection: string;
  success: boolean;
  matchedCount: number;
  modifiedCount: number;
  insertedCount: number;
  deletedCount: number;
  duration: number;
  backend: Backend;
}

// ─── Validation Result ───────────────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean;
  errors: Array<{
    field: string;
    message: string;
    expected: string;
    received: string;
  }>;
}

// ─── Collection Description ──────────────────────────────────────────────────

export interface CollectionDescription {
  name: string;
  backend: Backend;
  fields: Array<{
    name: string;
    type: string;
    required: boolean;
    enum?: string[];
  }>;
  indexes: IndexDefinition[];
  documentCount: number;
  exampleFilter: Record<string, unknown>;
}

// ─── Connection Config ───────────────────────────────────────────────────────

export type PoolPreset = 'high' | 'standard' | 'low';

export interface ReconnectConfig {
  enabled?: boolean;
  maxAttempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffMultiplier?: number;
}

export interface TimestampFieldNames {
  createdAt?: string;
  updatedAt?: string;
}

export interface SanitizeRule {
  /** Field(s) to target. Omit or '*' for all string fields. */
  field?: string | string[];
  /** Transform the value. Return the new value. */
  transform: (value: unknown, field: string, collection: string) => unknown;
}

export interface StrictDBConfig {
  uri: string;
  pool?: PoolPreset;
  dbName?: string;
  label?: string;
  schema?: boolean;
  sanitize?: boolean;
  sanitizeRules?: SanitizeRule[];
  reconnect?: ReconnectConfig | boolean;
  slowQueryMs?: number;
  guardrails?: boolean;
  logging?: boolean | 'verbose';
  timestamps?: boolean | TimestampFieldNames;
  elastic?: {
    apiKey?: string;
    caFingerprint?: string;
    sniffOnStart?: boolean;
  };
}

// ─── Schema Types ────────────────────────────────────────────────────────────

export interface CollectionSchema<T = unknown> {
  name: string;
  schema: z.ZodType<T>;
  indexes?: IndexDefinition[];
}

// ─── Batch Operations ────────────────────────────────────────────────────────

export type BatchOperation =
  | { operation: 'insertOne'; collection: string; doc: Record<string, unknown> }
  | { operation: 'insertMany'; collection: string; docs: Record<string, unknown>[] }
  | { operation: 'updateOne'; collection: string; filter: StrictFilter<Record<string, unknown>>; update: UpdateOperators<Record<string, unknown>>; upsert?: boolean }
  | { operation: 'updateMany'; collection: string; filter: StrictFilter<Record<string, unknown>>; update: UpdateOperators<Record<string, unknown>> }
  | { operation: 'deleteOne'; collection: string; filter: StrictFilter<Record<string, unknown>> }
  | { operation: 'deleteMany'; collection: string; filter: StrictFilter<Record<string, unknown>> };

// ─── Error Codes ─────────────────────────────────────────────────────────────

export type StrictErrorCode =
  | 'CONNECTION_FAILED'
  | 'CONNECTION_LOST'
  | 'AUTHENTICATION_FAILED'
  | 'TIMEOUT'
  | 'POOL_EXHAUSTED'
  | 'DUPLICATE_KEY'
  | 'VALIDATION_ERROR'
  | 'COLLECTION_NOT_FOUND'
  | 'QUERY_ERROR'
  | 'GUARDRAIL_BLOCKED'
  | 'UNKNOWN_OPERATOR'
  | 'SCHEMA_MISMATCH'
  | 'UNSUPPORTED_OPERATION'
  | 'INTERNAL_ERROR';

// ─── Event Types ─────────────────────────────────────────────────────────────

export interface StrictDBEvents {
  connected: { backend: string; dbName: string; label: string };
  disconnected: { backend: string; reason: string; timestamp: Date };
  reconnecting: { backend: string; attempt: number; maxAttempts: number; delayMs: number };
  reconnected: { backend: string; attempt: number; downtimeMs: number };
  error: { code: StrictErrorCode; message: string; fix: string; backend: Backend };
  operation: { collection: string; operation: string; durationMs: number; receipt: OperationReceipt };
  'slow-query': { collection: string; operation: string; durationMs: number; threshold: number };
  'pool-status': { active: number; idle: number; waiting: number; max: number };
  'guardrail-blocked': { collection: string; operation: string; reason: string };
  shutdown: { exitCode: number };
}

// ─── Connection Status ───────────────────────────────────────────────────────

export interface ConnectionStatus {
  state: 'connected' | 'disconnected' | 'reconnecting' | 'closed';
  backend: Backend;
  driver: Driver;
  uri: string;
  dbName: string;
  uptimeMs: number;
  pool: { active: number; idle: number; waiting: number; max: number };
  reconnect: { enabled: boolean; attempts: number; lastDisconnect?: Date };
}

// ─── SQL Translation Result ──────────────────────────────────────────────────

export interface SqlTranslation {
  clause: string;
  values: unknown[];
}

// ─── Explain Result ──────────────────────────────────────────────────────────

export interface ExplainResult {
  backend: Backend;
  native: string | object;
}

// ─── Confirm Options (for guardrail override) ────────────────────────────────

export interface ConfirmOptions {
  confirm?: 'DELETE_ALL' | 'UPDATE_ALL';
}
