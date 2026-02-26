/**
 * Event System Tests
 */

import { describe, it, expect, vi } from 'vitest';
import { StrictDBEventEmitter } from '../src/events.js';

describe('StrictDBEventEmitter', () => {
  it('emits and receives typed events', () => {
    const emitter = new StrictDBEventEmitter();
    const handler = vi.fn();
    emitter.on('connected', handler);
    emitter.emit('connected', { backend: 'mongo', dbName: 'test', label: 'default' });
    expect(handler).toHaveBeenCalledWith({ backend: 'mongo', dbName: 'test', label: 'default' });
  });

  it('supports once listeners', () => {
    const emitter = new StrictDBEventEmitter();
    const handler = vi.fn();
    emitter.once('connected', handler);
    emitter.emit('connected', { backend: 'sql', dbName: 'test', label: 'SQL' });
    emitter.emit('connected', { backend: 'sql', dbName: 'test', label: 'SQL' });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('supports off (removing listeners)', () => {
    const emitter = new StrictDBEventEmitter();
    const handler = vi.fn();
    emitter.on('connected', handler);
    emitter.off('connected', handler);
    emitter.emit('connected', { backend: 'mongo', dbName: 'test', label: 'default' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('emits all event types', () => {
    const emitter = new StrictDBEventEmitter();

    const handlers: Record<string, ReturnType<typeof vi.fn>> = {};
    const events = ['connected', 'disconnected', 'reconnecting', 'reconnected', 'error', 'operation', 'slow-query', 'pool-status', 'guardrail-blocked', 'shutdown'] as const;

    for (const event of events) {
      handlers[event] = vi.fn();
      emitter.on(event, handlers[event]!);
    }

    emitter.emit('connected', { backend: 'mongo', dbName: 'test', label: 'default' });
    emitter.emit('shutdown', { exitCode: 0 });
    emitter.emit('guardrail-blocked', { collection: 'users', operation: 'deleteMany', reason: 'empty filter' });

    expect(handlers['connected']).toHaveBeenCalled();
    expect(handlers['shutdown']).toHaveBeenCalled();
    expect(handlers['guardrail-blocked']).toHaveBeenCalled();
  });
});
