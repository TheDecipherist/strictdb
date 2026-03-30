/**
 * StrictDB Error System — Normalized errors with self-correcting fix instructions
 *
 * All database errors are caught, normalized into StrictDBError instances,
 * and include AI-readable fix instructions for automatic recovery.
 */

import type { Backend, StrictErrorCode } from './types.js';
import { mapMongoError } from './errors/mongo-errors.js';
import { mapSqlError } from './errors/sql-errors.js';
import { mapElasticError } from './errors/elastic-errors.js';

// Re-export backend mappers so existing imports keep working
export { mapMongoError } from './errors/mongo-errors.js';
export { mapSqlError } from './errors/sql-errors.js';
export { mapElasticError } from './errors/elastic-errors.js';

// Re-export helper functions
export { unknownMethodError, unknownOperatorError, collectionNotFoundError } from './errors/helpers.js';

// ─── StrictDBError ───────────────────────────────────────────────────────────

export class StrictDBError extends Error {
  readonly code: StrictErrorCode;
  readonly backend: Backend;
  readonly originalError: unknown;
  readonly collection?: string;
  readonly operation?: string;
  readonly retryable: boolean;
  readonly timestamp: Date;
  readonly fix: string;

  constructor(opts: {
    code: StrictErrorCode;
    message: string;
    fix: string;
    backend: Backend;
    originalError?: unknown;
    collection?: string;
    operation?: string;
    retryable?: boolean;
  }) {
    super(`${opts.message} Fix: ${opts.fix}`);
    this.name = 'StrictDBError';
    this.code = opts.code;
    this.backend = opts.backend;
    this.originalError = opts.originalError;
    this.collection = opts.collection;
    this.operation = opts.operation;
    this.retryable = opts.retryable ?? false;
    this.timestamp = new Date();
    this.fix = opts.fix;
  }
}

// ─── Error Code Metadata ─────────────────────────────────────────────────────

export const ERROR_RETRYABLE: Record<StrictErrorCode, boolean> = {
  CONNECTION_FAILED: true,
  CONNECTION_LOST: true,
  AUTHENTICATION_FAILED: false,
  TIMEOUT: true,
  POOL_EXHAUSTED: true,
  DUPLICATE_KEY: false,
  VALIDATION_ERROR: false,
  COLLECTION_NOT_FOUND: false,
  QUERY_ERROR: false,
  GUARDRAIL_BLOCKED: false,
  UNKNOWN_OPERATOR: false,
  SCHEMA_MISMATCH: false,
  UNSUPPORTED_OPERATION: false,
  PIPELINE_STAGE_UNSUPPORTED: false,
  INTERNAL_ERROR: false,
  SQL_PARSE_ERROR: false,
  SQL_UNSUPPORTED: false,
  SQL_MODE_UNAVAILABLE: false,
  SQL_RAW_UNAVAILABLE: false,
  SQL_SUGGEST_RAW: false,
  SQL_NULL_COMPARISON: false,
  SQL_PARAM_MISMATCH: false,
  SQL_TRANSACTION_FAILED: false,
  SQL_INVALID_OBJECTID: false,
};

// ─── Generic Error Mapper ────────────────────────────────────────────────────

export function mapNativeError(
  backend: Backend,
  err: unknown,
  collection?: string,
  operation?: string,
): StrictDBError {
  if (err instanceof StrictDBError) return err;

  switch (backend) {
    case 'mongo':
      return mapMongoError(err, collection, operation);
    case 'sql':
      return mapSqlError(err, collection, operation);
    case 'elastic':
      return mapElasticError(err, collection, operation);
  }
}
