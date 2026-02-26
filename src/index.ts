/**
 * StrictDB — Public API Entry Point
 *
 * One unified API for MongoDB, PostgreSQL, MySQL, MSSQL, SQLite, and Elasticsearch.
 */

// Main class
export { StrictDB } from './strictdb.js';

// Error class
export { StrictDBError } from './errors.js';

// Types
export type {
  Backend,
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
  UpdateOperators,
  ValidationResult,
} from './types.js';
