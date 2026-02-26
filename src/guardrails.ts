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
      if (isEmpty && options?.confirm !== 'DELETE_ALL') {
        emitAndThrow(ctx, collection, operation,
          'deleteMany requires a non-empty filter to prevent accidental data loss.',
          `To delete all documents: db.deleteMany('${collection}', { _id: { $exists: true } }, { confirm: 'DELETE_ALL' })`,
        );
      }
      break;

    case 'updateMany':
      if (isEmpty && options?.confirm !== 'UPDATE_ALL') {
        emitAndThrow(ctx, collection, operation,
          'updateMany requires a non-empty filter to prevent accidental mass updates.',
          `To update all documents: db.updateMany('${collection}', { _id: { $exists: true } }, update, { confirm: 'UPDATE_ALL' })`,
        );
      }
      break;

    case 'deleteOne':
      if (isEmpty) {
        emitAndThrow(ctx, collection, operation,
          'deleteOne requires a non-empty filter. An empty filter would delete an arbitrary document.',
          `Specify a filter to identify the document: db.deleteOne('${collection}', { id: "..." })`,
        );
      }
      break;

    case 'queryMany':
      if (options?.limit === undefined) {
        emitAndThrow(ctx, collection, operation,
          'queryMany without a limit could return millions of rows.',
          `Always include a limit: db.queryMany('${collection}', filter, { limit: 100 })`,
        );
      }
      break;
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
