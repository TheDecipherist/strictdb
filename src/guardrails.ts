/**
 * StrictDB Guardrails — Dangerous operation protection
 *
 * Prevents accidental destructive operations like:
 * - deleteMany with empty filter (deletes all documents)
 * - updateMany with empty filter (modifies all documents)
 * - queryMany without limit (unbounded result set)
 * - deleteOne with empty filter (deletes arbitrary document)
 */

import { StrictDBError } from './errors.js';
import type { Backend } from './types.js';
import type { StrictDBEventEmitter } from './events.js';

export interface GuardrailContext {
  enabled: boolean;
  limitRequired: boolean;
  emptyFilter: boolean;
  emitter: StrictDBEventEmitter;
}

/**
 * Check if an operation is safe to execute.
 * Throws StrictDBError with code GUARDRAIL_BLOCKED if blocked.
 */
export function checkGuardrails(
  ctx: GuardrailContext,
  operation: string,
  collection: string,
  filter: Record<string, unknown>,
  options?: { limit?: number; confirm?: string },
): void {
  if (!ctx.enabled) return;

  const isEmpty = isEmptyFilter(filter);

  switch (operation) {
    case 'deleteMany':
      if (ctx.emptyFilter && isEmpty && options?.confirm !== 'DELETE_ALL') {
        emitAndThrow(ctx, collection, operation,
          'deleteMany requires a non-empty filter to prevent accidental data loss.',
          `To delete all documents: db.deleteMany('${collection}', { _id: { $exists: true } }, { confirm: 'DELETE_ALL' })`,
        );
      }
      break;

    case 'updateMany':
      if (ctx.emptyFilter && isEmpty && options?.confirm !== 'UPDATE_ALL') {
        emitAndThrow(ctx, collection, operation,
          'updateMany requires a non-empty filter to prevent accidental mass updates.',
          `To update all documents: db.updateMany('${collection}', { _id: { $exists: true } }, update, { confirm: 'UPDATE_ALL' })`,
        );
      }
      break;

    case 'deleteOne':
      if (ctx.emptyFilter && isEmpty) {
        emitAndThrow(ctx, collection, operation,
          'deleteOne requires a non-empty filter. An empty filter would delete an arbitrary document.',
          `Specify a filter to identify the document: db.deleteOne('${collection}', { id: "..." })`,
        );
      }
      break;

    case 'queryMany':
      if (ctx.limitRequired && options?.limit === undefined) {
        emitAndThrow(ctx, collection, operation,
          'queryMany without a limit could return millions of rows.',
          `Always include a limit: db.queryMany('${collection}', filter, { limit: 100 })`,
        );
      }
      break;
  }
}

/**
 * Check if an aggregate pipeline is safe to execute.
 * Blocks pipelines without $limit (unless they have $count, $group, $merge, $out).
 */
export function checkPipelineGuardrails(
  ctx: GuardrailContext,
  collection: string,
  pipeline: Record<string, unknown>[],
): void {
  if (!ctx.enabled) return;

  const hasLimit = pipeline.some(s => '$limit' in s);
  const hasCount = pipeline.some(s => '$count' in s);
  const hasGroup = pipeline.some(s => '$group' in s);
  const hasMerge = pipeline.some(s => '$merge' in s || '$out' in s);

  if (ctx.limitRequired && !hasLimit && !hasCount && !hasGroup && !hasMerge) {
    emitAndThrow(ctx, collection, 'aggregate',
      `aggregate pipeline without $limit could return unbounded results from ${collection}.`,
      `Add a { $limit: N } stage to your pipeline, or use $group/$count for bounded aggregations.`,
    );
  }
}

/**
 * Check bulkWrite operations for dangerous patterns.
 */
export function checkBulkWriteGuardrails(
  ctx: GuardrailContext,
  collection: string,
  operations: Array<Record<string, unknown>>,
): void {
  if (!ctx.enabled) return;

  for (const op of operations) {
    if (ctx.emptyFilter && op['deleteMany']) {
      const del = op['deleteMany'] as Record<string, unknown>;
      const filter = del['filter'] as Record<string, unknown> | undefined;
      if (!filter || Object.keys(filter).length === 0) {
        emitAndThrow(ctx, collection, 'bulkWrite',
          'bulkWrite contains deleteMany with empty filter — would delete all documents.',
          `Add a filter to the deleteMany operation, or use { confirm: 'DELETE_ALL' } on the regular deleteMany method.`,
        );
      }
    }
    if (ctx.emptyFilter && op['deleteOne']) {
      const del = op['deleteOne'] as Record<string, unknown>;
      const filter = del['filter'] as Record<string, unknown> | undefined;
      if (!filter || Object.keys(filter).length === 0) {
        emitAndThrow(ctx, collection, 'bulkWrite',
          'bulkWrite contains deleteOne with empty filter — would delete an arbitrary document.',
          `Add a filter to identify the document to delete.`,
        );
      }
    }
    if (ctx.emptyFilter && op['updateMany']) {
      const upd = op['updateMany'] as Record<string, unknown>;
      const filter = upd['filter'] as Record<string, unknown> | undefined;
      if (!filter || Object.keys(filter).length === 0) {
        emitAndThrow(ctx, collection, 'bulkWrite',
          'bulkWrite contains updateMany with empty filter — would update all documents.',
          `Add a filter to the updateMany operation.`,
        );
      }
    }
  }
}

function isEmptyFilter(filter: Record<string, unknown>): boolean {
  return !filter || Object.keys(filter).length === 0;
}

function emitAndThrow(
  ctx: GuardrailContext,
  collection: string,
  operation: string,
  message: string,
  fix: string,
): never {
  ctx.emitter.emit('guardrail-blocked', { collection, operation, reason: message });

  throw new StrictDBError({
    code: 'GUARDRAIL_BLOCKED',
    message,
    fix,
    backend: 'mongo' as Backend, // Will be overridden by caller context
    collection,
    operation,
  });
}
