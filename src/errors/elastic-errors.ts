/**
 * Elasticsearch Error Mapping
 */

import { StrictDBError } from '../errors.js';

export function mapElasticError(err: unknown, collection?: string, operation?: string): StrictDBError {
  const e = err as Record<string, unknown>;
  const statusCode = (e['statusCode'] as number) ?? (e['status'] as number);
  const message = (e['message'] as string) ?? String(err);
  const meta = e['meta'] as Record<string, unknown> | undefined;
  const body = meta?.['body'] as Record<string, unknown> | undefined;
  const errorType = (body?.['error'] as Record<string, unknown>)?.['type'] as string | undefined;

  // 409 version conflict (duplicate key equivalent)
  if (statusCode === 409) {
    return new StrictDBError({
      code: 'DUPLICATE_KEY',
      message: `Document version conflict in "${collection ?? 'unknown'}".`,
      fix: `The document was modified concurrently. Retry the operation or use db.queryOne() to get the latest version first.`,
      backend: 'elastic',
      originalError: err,
      collection,
      operation,
    });
  }

  // 401/403 authentication
  if (statusCode === 401 || statusCode === 403) {
    return new StrictDBError({
      code: 'AUTHENTICATION_FAILED',
      message: `Elasticsearch authentication failed (HTTP ${statusCode}).`,
      fix: `Check your Elasticsearch API key or credentials in the config.`,
      backend: 'elastic',
      originalError: err,
      collection,
      operation,
    });
  }

  // 404 index not found
  if (statusCode === 404 || errorType === 'index_not_found_exception') {
    return new StrictDBError({
      code: 'COLLECTION_NOT_FOUND',
      message: `Index "${collection ?? 'unknown'}" not found in Elasticsearch.`,
      fix: `Run db.ensureCollections() to create the index, or check the index name.`,
      backend: 'elastic',
      originalError: err,
      collection,
      operation,
    });
  }

  // Connection errors
  if (message.includes('ConnectionError') || message.includes('ECONNREFUSED') || message.includes('connect ENOTFOUND')) {
    return new StrictDBError({
      code: 'CONNECTION_FAILED',
      message: `Cannot connect to Elasticsearch.`,
      fix: `Verify the Elasticsearch URI is correct and the cluster is running. Check network access.`,
      backend: 'elastic',
      originalError: err,
      collection,
      operation,
      retryable: true,
    });
  }

  // Timeout
  if (message.includes('TimeoutError') || message.includes('Request timed out')) {
    return new StrictDBError({
      code: 'TIMEOUT',
      message: `Elasticsearch query timed out on "${collection ?? 'unknown'}".`,
      fix: `Add a filter to narrow results or increase the request timeout.`,
      backend: 'elastic',
      originalError: err,
      collection,
      operation,
      retryable: true,
    });
  }

  // Fallback
  return new StrictDBError({
    code: 'INTERNAL_ERROR',
    message: `Elasticsearch error on "${collection ?? 'unknown'}": ${message}`,
    fix: `Check the original error for details.`,
    backend: 'elastic',
    originalError: err,
    collection,
    operation,
  });
}
