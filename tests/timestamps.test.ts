/**
 * Timestamp Tests — Automatic created_at / updated_at injection
 */

import { describe, it, expect } from 'vitest';
import {
  resolveTimestampConfig,
  injectInsertTimestamps,
  injectUpdateTimestamps,
} from '../src/timestamps.js';

describe('resolveTimestampConfig', () => {
  it('returns disabled for undefined', () => {
    const cfg = resolveTimestampConfig(undefined);
    expect(cfg.enabled).toBe(false);
  });

  it('returns disabled for false', () => {
    const cfg = resolveTimestampConfig(false);
    expect(cfg.enabled).toBe(false);
  });

  it('returns defaults for true', () => {
    const cfg = resolveTimestampConfig(true);
    expect(cfg.enabled).toBe(true);
    expect(cfg.createdAt).toBe('created_at');
    expect(cfg.updatedAt).toBe('updated_at');
  });

  it('uses custom field names', () => {
    const cfg = resolveTimestampConfig({ createdAt: 'born', updatedAt: 'modified' });
    expect(cfg.enabled).toBe(true);
    expect(cfg.createdAt).toBe('born');
    expect(cfg.updatedAt).toBe('modified');
  });

  it('defaults updatedAt when only createdAt provided', () => {
    const cfg = resolveTimestampConfig({ createdAt: 'born' });
    expect(cfg.enabled).toBe(true);
    expect(cfg.createdAt).toBe('born');
    expect(cfg.updatedAt).toBe('updated_at');
  });

  it('defaults createdAt when only updatedAt provided', () => {
    const cfg = resolveTimestampConfig({ updatedAt: 'modified' });
    expect(cfg.enabled).toBe(true);
    expect(cfg.createdAt).toBe('created_at');
    expect(cfg.updatedAt).toBe('modified');
  });
});

describe('injectInsertTimestamps', () => {
  const config = resolveTimestampConfig(true);
  const now = new Date('2025-06-01T00:00:00Z');

  it('adds both fields to empty doc', () => {
    const result = injectInsertTimestamps({}, config, now);
    expect(result).toEqual({ created_at: now, updated_at: now });
  });

  it('adds both fields alongside existing data', () => {
    const result = injectInsertTimestamps({ name: 'Alice' }, config, now);
    expect(result).toEqual({ name: 'Alice', created_at: now, updated_at: now });
  });

  it('preserves user-provided created_at', () => {
    const custom = new Date('2020-01-01');
    const result = injectInsertTimestamps({ created_at: custom }, config, now);
    expect(result.created_at).toBe(custom);
    expect(result.updated_at).toBe(now);
  });

  it('preserves user-provided updated_at', () => {
    const custom = new Date('2020-01-01');
    const result = injectInsertTimestamps({ updated_at: custom }, config, now);
    expect(result.created_at).toBe(now);
    expect(result.updated_at).toBe(custom);
  });

  it('preserves even undefined user-provided value', () => {
    const result = injectInsertTimestamps({ created_at: undefined }, config, now);
    expect(result.created_at).toBeUndefined();
  });

  it('does not mutate original doc', () => {
    const doc = { name: 'Bob' };
    const result = injectInsertTimestamps(doc, config, now);
    expect(doc).toEqual({ name: 'Bob' });
    expect(result).not.toBe(doc);
  });

  it('returns input reference when disabled', () => {
    const disabled = resolveTimestampConfig(false);
    const doc = { name: 'Alice' };
    const result = injectInsertTimestamps(doc, disabled, now);
    expect(result).toBe(doc);
  });

  it('uses custom field names', () => {
    const custom = resolveTimestampConfig({ createdAt: 'born', updatedAt: 'modified' });
    const result = injectInsertTimestamps({ name: 'Alice' }, custom, now);
    expect(result).toEqual({ name: 'Alice', born: now, modified: now });
  });
});

describe('injectUpdateTimestamps', () => {
  const config = resolveTimestampConfig(true);
  const now = new Date('2025-06-01T00:00:00Z');

  it('injects updated_at into existing $set', () => {
    const update = { $set: { role: 'admin' } };
    const result = injectUpdateTimestamps(update, config, now);
    expect(result.$set).toEqual({ role: 'admin', updated_at: now });
  });

  it('creates $set when not present', () => {
    const update = { $inc: { loginCount: 1 } };
    const result = injectUpdateTimestamps(update, config, now);
    expect(result.$set).toEqual({ updated_at: now });
    expect(result.$inc).toEqual({ loginCount: 1 });
  });

  it('preserves user-provided updated_at in $set', () => {
    const custom = new Date('2020-01-01');
    const update = { $set: { updated_at: custom, role: 'admin' } };
    const result = injectUpdateTimestamps(update, config, now);
    expect(result.$set.updated_at).toBe(custom);
  });

  it('does not mutate original update', () => {
    const update = { $set: { role: 'admin' } };
    const result = injectUpdateTimestamps(update, config, now);
    expect(update.$set).toEqual({ role: 'admin' });
    expect(result).not.toBe(update);
  });

  it('returns input reference when disabled', () => {
    const disabled = resolveTimestampConfig(false);
    const update = { $set: { role: 'admin' } };
    const result = injectUpdateTimestamps(update, disabled, now);
    expect(result).toBe(update);
  });

  it('uses custom field names', () => {
    const custom = resolveTimestampConfig({ updatedAt: 'modified' });
    const update = { $set: { role: 'admin' } };
    const result = injectUpdateTimestamps(update, custom, now);
    expect(result.$set).toEqual({ role: 'admin', modified: now });
  });

  it('never adds created_at on updates', () => {
    const update = { $set: { role: 'admin' } };
    const result = injectUpdateTimestamps(update, config, now);
    expect('created_at' in (result.$set as Record<string, unknown>)).toBe(false);
  });
});
