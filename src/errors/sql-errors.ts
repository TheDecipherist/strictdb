/**
 * SQL Error Mapping
 */

import { StrictDBError } from '../errors.js';

export function mapSqlError(err: unknown, collection?: string, operation?: string): StrictDBError {
  const e = err as Record<string, unknown>;
  const code = (e['code'] as string) ?? '';
  const message = (e['message'] as string) ?? String(err);

  // PostgreSQL 23505, MySQL ER_DUP_ENTRY
  if (code === '23505' || code === 'ER_DUP_ENTRY' || message.includes('UNIQUE constraint failed')) {
    return new StrictDBError({
      code: 'DUPLICATE_KEY',
      message: `Duplicate key violation in "${collection ?? 'unknown'}".`,
      fix: `A row with this value already exists. Use db.updateOne() to update instead, or check for existence with db.queryOne() first.`,
      backend: 'sql',
      originalError: err,
      collection,
      operation,
    });
  }

  // Connection refused
  if (code === 'ECONNREFUSED' || message.includes('ECONNREFUSED') || message.includes('connect ENOTFOUND')) {
    return new StrictDBError({
      code: 'CONNECTION_FAILED',
      message: `Cannot connect to SQL database.`,
      fix: `Verify the DATABASE_URL is correct and the database server is running.`,
      backend: 'sql',
      originalError: err,
      collection,
      operation,
      retryable: true,
    });
  }

  // PostgreSQL 57014 query_canceled (timeout)
  if (code === '57014' || message.includes('canceling statement due to statement timeout')) {
    return new StrictDBError({
      code: 'TIMEOUT',
      message: `SQL query timed out on "${collection ?? 'unknown'}".`,
      fix: `Add a filter to narrow results, add an index, or increase the statement timeout.`,
      backend: 'sql',
      originalError: err,
      collection,
      operation,
      retryable: true,
    });
  }

  // Authentication
  if (code === '28P01' || code === '28000' || message.includes('password authentication failed')) {
    return new StrictDBError({
      code: 'AUTHENTICATION_FAILED',
      message: `SQL authentication failed.`,
      fix: `Check your database username and password in the connection URI.`,
      backend: 'sql',
      originalError: err,
      collection,
      operation,
    });
  }

  // Table not found
  if (code === '42P01' || message.includes('no such table') || message.includes('does not exist')) {
    return new StrictDBError({
      code: 'COLLECTION_NOT_FOUND',
      message: `Table "${collection ?? 'unknown'}" not found.`,
      fix: `Run db.ensureCollections() to create tables from registered schemas, or check the table name.`,
      backend: 'sql',
      originalError: err,
      collection,
      operation,
    });
  }

  // Pool exhausted
  if (message.includes('timeout exceeded') && message.includes('pool')) {
    return new StrictDBError({
      code: 'POOL_EXHAUSTED',
      message: `SQL connection pool exhausted.`,
      fix: `Increase pool size with { pool: 'high' } or ensure connections are being released properly.`,
      backend: 'sql',
      originalError: err,
      collection,
      operation,
      retryable: true,
    });
  }

  // Fallback
  return new StrictDBError({
    code: 'INTERNAL_ERROR',
    message: `SQL error on "${collection ?? 'unknown'}": ${message}`,
    fix: `Check the original error for details.`,
    backend: 'sql',
    originalError: err,
    collection,
    operation,
  });
}
