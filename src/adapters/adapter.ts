/**
 * StrictDB Abstract Adapter Interface
 *
 * Every backend implements this interface. The main StrictDB class
 * delegates all operations to the active adapter.
 */

import type {
  Backend,
  ConnectionStatus,
  ConfirmOptions,
  Driver,
  LookupOptions,
  OperationReceipt,
  QueryOptions,
  StrictFilter,
  UpdateOperators,
} from '../types.js';

export interface DatabaseAdapter {
  readonly backend: Backend;
  readonly driver: Driver;

  // ─── Lifecycle ────────────────────────────────────────────────────
  connect(): Promise<void>;
  close(): Promise<void>;
  status(): ConnectionStatus;

  // ─── Read Operations ──────────────────────────────────────────────
  queryOne<T>(collection: string, filter: StrictFilter<T>, options?: QueryOptions<T>): Promise<T | null>;
  queryMany<T>(collection: string, filter: StrictFilter<T>, options?: QueryOptions<T>): Promise<T[]>;
  queryWithLookup<T>(collection: string, options: LookupOptions<T>): Promise<T | null>;
  count<T>(collection: string, filter?: StrictFilter<T>): Promise<number>;

  // ─── Write Operations ─────────────────────────────────────────────
  insertOne<T>(collection: string, doc: T): Promise<OperationReceipt>;
  insertMany<T>(collection: string, docs: T[]): Promise<OperationReceipt>;
  updateOne<T>(collection: string, filter: StrictFilter<T>, update: UpdateOperators<T>, upsert?: boolean): Promise<OperationReceipt>;
  updateMany<T>(collection: string, filter: StrictFilter<T>, update: UpdateOperators<T>): Promise<OperationReceipt>;
  deleteOne<T>(collection: string, filter: StrictFilter<T>, options?: ConfirmOptions): Promise<OperationReceipt>;
  deleteMany<T>(collection: string, filter: StrictFilter<T>, options?: ConfirmOptions): Promise<OperationReceipt>;

  // ─── Schema ───────────────────────────────────────────────────────
  ensureCollections?(definitions: Array<{ name: string; sql?: string; mapping?: Record<string, unknown> }>): Promise<void>;
  ensureIndexes?(indexes: Array<{ collection: string; fields: Record<string, 1 | -1>; unique?: boolean; sparse?: boolean; expireAfterSeconds?: number }>): Promise<void>;

  // ─── Introspection ────────────────────────────────────────────────
  describeCollection?(collection: string): Promise<Array<{ name: string; type: string; required: boolean }>>;
  getDocumentCount?(collection: string): Promise<number>;
  getIndexes?(collection: string): Promise<Array<{ fields: Record<string, 1 | -1>; unique?: boolean }>>;

  // ─── Transactions ────────────────────────────────────────────────
  withTransaction?<T>(fn: (txAdapter: DatabaseAdapter) => Promise<T>): Promise<T>;

  // ─── Raw Access ───────────────────────────────────────────────────
  raw(): unknown;
}
