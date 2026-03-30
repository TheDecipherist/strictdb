/**
 * MongoDB Error Mapping
 */

import { StrictDBError } from '../errors.js';

export function mapMongoError(err: unknown, collection?: string, operation?: string): StrictDBError {
  const e = err as Record<string, unknown>;
  const code = e['code'] as number | undefined;
  const message = e['message'] as string | undefined ?? String(err);

  // E11000 duplicate key
  if (code === 11000) {
    const match = message.match(/index: (\S+)/);
    const indexName = match?.[1] ?? 'unknown';
    return new StrictDBError({
      code: 'DUPLICATE_KEY',
      message: `Duplicate key violation on index "${indexName}" in "${collection ?? 'unknown'}".`,
      fix: `A document with this value already exists. Use db.updateOne() to update instead, or check for existence with db.queryOne() first.`,
      backend: 'mongo',
      originalError: err,
      collection,
      operation,
    });
  }

  // Topology closed / connection lost
  if (message.includes('topology was destroyed') || message.includes('TopologyDescription') || message.includes('Server selection timed out')) {
    return new StrictDBError({
      code: 'CONNECTION_LOST',
      message: `MongoDB connection lost.`,
      fix: `Connection will auto-reconnect. If persistent, check the MongoDB URI and network connectivity.`,
      backend: 'mongo',
      originalError: err,
      collection,
      operation,
      retryable: true,
    });
  }

  // Authentication
  if (code === 18 || message.includes('Authentication failed') || message.includes('EAUTH')) {
    return new StrictDBError({
      code: 'AUTHENTICATION_FAILED',
      message: `MongoDB authentication failed.`,
      fix: `Check your MongoDB username and password in the connection URI.`,
      backend: 'mongo',
      originalError: err,
      collection,
      operation,
    });
  }

  // Connection refused
  if (message.includes('ECONNREFUSED') || message.includes('connect ENOTFOUND')) {
    return new StrictDBError({
      code: 'CONNECTION_FAILED',
      message: `Cannot connect to MongoDB.`,
      fix: `Verify the MongoDB URI is correct and the server is running. Check firewall and network access.`,
      backend: 'mongo',
      originalError: err,
      collection,
      operation,
      retryable: true,
    });
  }

  // Timeout
  if (message.includes('timed out') || message.includes('maxTimeMS')) {
    return new StrictDBError({
      code: 'TIMEOUT',
      message: `MongoDB query timed out on "${collection ?? 'unknown'}".`,
      fix: `Add a filter to narrow results, add an index, or increase the timeout.`,
      backend: 'mongo',
      originalError: err,
      collection,
      operation,
      retryable: true,
    });
  }

  // Fallback
  return new StrictDBError({
    code: 'INTERNAL_ERROR',
    message: `MongoDB error on "${collection ?? 'unknown'}": ${message}`,
    fix: `Check the original error for details.`,
    backend: 'mongo',
    originalError: err,
    collection,
    operation,
  });
}
