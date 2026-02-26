/**
 * Guardrail Tests — Dangerous operation protection
 */

import { describe, it, expect, vi } from 'vitest';
import { checkGuardrails } from '../src/guardrails.js';
import { StrictDBEventEmitter } from '../src/events.js';
import { StrictDBError } from '../src/errors.js';

function makeCtx() {
  return { enabled: true, emitter: new StrictDBEventEmitter() };
}

describe('checkGuardrails', () => {
  it('blocks deleteMany with empty filter', () => {
    expect(() => checkGuardrails(makeCtx(), 'deleteMany', 'users', {}))
      .toThrow(StrictDBError);
  });

  it('allows deleteMany with confirm DELETE_ALL', () => {
    expect(() => checkGuardrails(makeCtx(), 'deleteMany', 'users', {}, { confirm: 'DELETE_ALL' }))
      .not.toThrow();
  });

  it('allows deleteMany with non-empty filter', () => {
    expect(() => checkGuardrails(makeCtx(), 'deleteMany', 'users', { role: 'banned' }))
      .not.toThrow();
  });

  it('blocks updateMany with empty filter', () => {
    expect(() => checkGuardrails(makeCtx(), 'updateMany', 'users', {}))
      .toThrow(StrictDBError);
  });

  it('allows updateMany with confirm UPDATE_ALL', () => {
    expect(() => checkGuardrails(makeCtx(), 'updateMany', 'users', {}, { confirm: 'UPDATE_ALL' }))
      .not.toThrow();
  });

  it('blocks deleteOne with empty filter', () => {
    expect(() => checkGuardrails(makeCtx(), 'deleteOne', 'users', {}))
      .toThrow(StrictDBError);
  });

  it('allows deleteOne with filter', () => {
    expect(() => checkGuardrails(makeCtx(), 'deleteOne', 'users', { id: '123' }))
      .not.toThrow();
  });

  it('blocks queryMany without limit', () => {
    expect(() => checkGuardrails(makeCtx(), 'queryMany', 'users', {}))
      .toThrow(StrictDBError);
  });

  it('allows queryMany with limit', () => {
    expect(() => checkGuardrails(makeCtx(), 'queryMany', 'users', {}, { limit: 100 }))
      .not.toThrow();
  });

  it('does nothing when guardrails disabled', () => {
    const ctx = { enabled: false, emitter: new StrictDBEventEmitter() };
    expect(() => checkGuardrails(ctx, 'deleteMany', 'users', {})).not.toThrow();
  });

  it('emits guardrail-blocked event', () => {
    const ctx = makeCtx();
    const handler = vi.fn();
    ctx.emitter.on('guardrail-blocked', handler);

    expect(() => checkGuardrails(ctx, 'deleteMany', 'users', {})).toThrow();
    expect(handler).toHaveBeenCalledWith({
      collection: 'users',
      operation: 'deleteMany',
      reason: expect.stringContaining('non-empty filter'),
    });
  });

  it('error includes fix with correct syntax', () => {
    try {
      checkGuardrails(makeCtx(), 'deleteMany', 'users', {});
      expect.fail('Should have thrown');
    } catch (e) {
      const err = e as StrictDBError;
      expect(err.code).toBe('GUARDRAIL_BLOCKED');
      expect(err.fix).toContain('DELETE_ALL');
    }
  });
});
