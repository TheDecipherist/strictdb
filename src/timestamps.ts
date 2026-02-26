/**
 * StrictDB — Automatic Timestamp Injection
 *
 * Pure utility functions for injecting created_at / updated_at timestamps.
 * Immutable — always returns new objects, never mutates input.
 */

import type { TimestampFieldNames } from './types.js';

export interface ResolvedTimestampConfig {
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Resolve user-provided timestamp config into a normalized form.
 */
export function resolveTimestampConfig(
  config?: boolean | TimestampFieldNames,
): ResolvedTimestampConfig {
  if (!config) {
    return { enabled: false, createdAt: 'created_at', updatedAt: 'updated_at' };
  }

  if (config === true) {
    return { enabled: true, createdAt: 'created_at', updatedAt: 'updated_at' };
  }

  return {
    enabled: true,
    createdAt: config.createdAt ?? 'created_at',
    updatedAt: config.updatedAt ?? 'updated_at',
  };
}

/**
 * Inject created_at and updated_at into an insert document.
 * User-provided values are preserved (never overwritten).
 */
export function injectInsertTimestamps<T extends Record<string, unknown>>(
  doc: T,
  config: ResolvedTimestampConfig,
  now?: Date,
): T {
  if (!config.enabled) return doc;

  const timestamp = now ?? new Date();
  const result = { ...doc };

  if (!(config.createdAt in result)) {
    (result as Record<string, unknown>)[config.createdAt] = timestamp;
  }
  if (!(config.updatedAt in result)) {
    (result as Record<string, unknown>)[config.updatedAt] = timestamp;
  }

  return result;
}

/**
 * Inject updated_at into an update operation's $set.
 * User-provided values in $set are preserved. Never adds created_at on updates.
 */
export function injectUpdateTimestamps<T extends Record<string, unknown>>(
  update: T,
  config: ResolvedTimestampConfig,
  now?: Date,
): T {
  if (!config.enabled) return update;

  const timestamp = now ?? new Date();
  const result = { ...update };
  const existing$set = (result as Record<string, unknown>)['$set'] as Record<string, unknown> | undefined;

  if (existing$set) {
    if (!(config.updatedAt in existing$set)) {
      (result as Record<string, unknown>)['$set'] = {
        ...existing$set,
        [config.updatedAt]: timestamp,
      };
    }
  } else {
    (result as Record<string, unknown>)['$set'] = {
      [config.updatedAt]: timestamp,
    };
  }

  return result;
}
