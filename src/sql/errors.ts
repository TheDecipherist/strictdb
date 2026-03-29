/**
 * SQL Mode 2 — Error Factories
 *
 * Every SQL error includes: code, message, fix, sql.
 * All follow the StrictDB self-correcting error pattern.
 */

import { StrictDBError } from '../errors.js';
import type { StrictErrorCode } from '../types.js';

interface SqlErrorOpts {
  sql: string;
  detail?: string;
}

function sqlError(code: StrictErrorCode, message: string, fix: string, sql: string): StrictDBError {
  const err = new StrictDBError({
    code,
    message,
    fix,
    backend: 'mongo',
    operation: 'sql',
  });
  // Attach sql to the error for SQL-specific context
  (err as unknown as Record<string, unknown>)['sql'] = sql;
  return err;
}

export function parseError(opts: SqlErrorOpts): StrictDBError {
  const msg = opts.detail
    ? `SQL syntax error: ${opts.detail}`
    : 'SQL syntax error';
  return sqlError(
    'SQL_PARSE_ERROR' as StrictErrorCode,
    msg,
    'Check SQL syntax. Ensure all keywords are spelled correctly and clauses are in the right order.',
    opts.sql,
  );
}

export function unsupportedError(construct: string, opts: SqlErrorOpts): StrictDBError {
  return sqlError(
    'SQL_UNSUPPORTED' as StrictErrorCode,
    `${construct} is not supported in Mode 2`,
    `Use db.queryMany() with MongoDB-style filters for this operation, or check the supported SQL constructs.`,
    opts.sql,
  );
}

export function modeUnavailableError(backend: string, opts: SqlErrorOpts): StrictDBError {
  return sqlError(
    'SQL_MODE_UNAVAILABLE' as StrictErrorCode,
    `db.sql() without { raw: true } is only available when connected to MongoDB`,
    `Add { raw: true } to pass this SQL directly to the ${backend} driver, or connect to a MongoDB URI to use the full Mode 2 execution engine`,
    opts.sql,
  );
}

export function rawUnavailableError(opts: SqlErrorOpts): StrictDBError {
  return sqlError(
    'SQL_RAW_UNAVAILABLE' as StrictErrorCode,
    '{ raw: true } is not valid when connected to MongoDB',
    'Remove { raw: true } -- Mode 2 executes SQL natively against MongoDB without raw passthrough',
    opts.sql,
  );
}

export function suggestRawError(backend: string, opts: SqlErrorOpts): StrictDBError {
  return sqlError(
    'SQL_SUGGEST_RAW' as StrictErrorCode,
    `db.sql() without { raw: true } is only available when connected to MongoDB`,
    `Add { raw: true } to pass this SQL directly to the ${backend} driver, or use db.queryMany() for cross-database compatible queries`,
    opts.sql,
  );
}

export function nullComparisonError(opts: SqlErrorOpts): StrictDBError {
  return sqlError(
    'SQL_NULL_COMPARISON' as StrictErrorCode,
    '= NULL is not valid SQL. NULL comparisons require IS NULL or IS NOT NULL',
    'Replace = NULL with IS NULL, or != NULL with IS NOT NULL',
    opts.sql,
  );
}

export function paramMismatchError(expected: number, actual: number, opts: SqlErrorOpts): StrictDBError {
  return sqlError(
    'SQL_PARAM_MISMATCH' as StrictErrorCode,
    `SQL has ${expected} parameter placeholders but ${actual} values were provided in params`,
    'params array length must match the number of ? or $N placeholders in the SQL string',
    opts.sql,
  );
}

export function transactionFailedError(statement: string, reason: string, opts: SqlErrorOpts): StrictDBError {
  return sqlError(
    'SQL_TRANSACTION_FAILED' as StrictErrorCode,
    `Transaction aborted -- ${statement} failed: ${reason}`,
    'Check that the documents being modified exist before starting the transaction',
    opts.sql,
  );
}

export function invalidObjectIdError(value: string, opts: SqlErrorOpts): StrictDBError {
  return sqlError(
    'SQL_INVALID_OBJECTID' as StrictErrorCode,
    `"${value}" looks like an ObjectId but contains invalid hex characters`,
    'ObjectId values must be exactly 24 hexadecimal characters (0-9, a-f). Check the value being passed.',
    opts.sql,
  );
}

export function guardrailBlockedError(message: string, fix: string, sql: string): StrictDBError {
  return sqlError('GUARDRAIL_BLOCKED', message, fix, sql);
}
