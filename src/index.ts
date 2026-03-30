/**
 * StrictDB — Public API Entry Point
 *
 * One unified API for MongoDB, PostgreSQL, MySQL, MSSQL, SQLite, and Elasticsearch.
 */

// Main class
export { StrictDB } from './strictdb.js';

// Error class
export { StrictDBError } from './errors.js';

// SQL Mode 2 types
export type { SqlOptions, SqlMode2Result } from './sql/index.js';
export type { ExplainPlan, SqlMode2Dialect } from './sql/types.js';

// Types
export type {
  AggregateOptions,
  Backend,
  GuardrailConfig,
  BatchOperation,
  CollectionDescription,
  CollectionSchema,
  ConfirmOptions,
  ConnectionStatus,
  Driver,
  ExplainResult,
  FilterOperators,
  FilterValue,
  IndexDefinition,
  LogicalFilter,
  LookupOptions,
  OperationReceipt,
  PoolPreset,
  Projection,
  QueryOptions,
  ReconnectConfig,
  SanitizeRule,
  SortDirection,
  SortSpec,
  SqlDialect,
  SqlTranslation,
  StrictDBConfig,
  StrictDBEvents,
  StrictErrorCode,
  StrictFilter,
  TimestampFieldNames,
  NativeBulkWriteOp,
  UpdateOperators,
  ValidationResult,
} from './types.js';
