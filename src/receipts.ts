/**
 * StrictDB Operation Receipts — Structured write operation results
 *
 * Every write returns OperationReceipt. Never void. Never driver-specific.
 */

import type { Backend, OperationReceipt } from './types.js';

export function createReceipt(opts: {
  operation: OperationReceipt['operation'];
  collection: string;
  backend: Backend;
  startTime: number;
  matchedCount?: number;
  modifiedCount?: number;
  insertedCount?: number;
  deletedCount?: number;
  success?: boolean;
  insertedId?: string;
  insertedIds?: string[];
  upsertedId?: string;
}): OperationReceipt {
  const receipt: OperationReceipt = {
    operation: opts.operation,
    collection: opts.collection,
    success: opts.success ?? true,
    matchedCount: opts.matchedCount ?? 0,
    modifiedCount: opts.modifiedCount ?? 0,
    insertedCount: opts.insertedCount ?? 0,
    deletedCount: opts.deletedCount ?? 0,
    duration: Date.now() - opts.startTime,
    backend: opts.backend,
  };

  // Only include ID fields when present (keeps receipts clean for non-applicable operations)
  if (opts.insertedId !== undefined) receipt.insertedId = opts.insertedId;
  if (opts.insertedIds !== undefined) receipt.insertedIds = opts.insertedIds;
  if (opts.upsertedId !== undefined) receipt.upsertedId = opts.upsertedId;

  return receipt;
}
