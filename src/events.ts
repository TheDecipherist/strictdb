/**
 * StrictDB Event System — Typed event emitter
 *
 * All lifecycle, operation, and error events flow through this.
 */

import { EventEmitter } from 'events';
import type { StrictDBEvents } from './types.js';

export class StrictDBEventEmitter extends EventEmitter {
  on<E extends keyof StrictDBEvents>(
    event: E,
    listener: (payload: StrictDBEvents[E]) => void,
  ): this {
    return super.on(event, listener as (...args: unknown[]) => void);
  }

  once<E extends keyof StrictDBEvents>(
    event: E,
    listener: (payload: StrictDBEvents[E]) => void,
  ): this {
    return super.once(event, listener as (...args: unknown[]) => void);
  }

  emit<E extends keyof StrictDBEvents>(
    event: E,
    payload: StrictDBEvents[E],
  ): boolean {
    return super.emit(event, payload);
  }

  off<E extends keyof StrictDBEvents>(
    event: E,
    listener: (payload: StrictDBEvents[E]) => void,
  ): this {
    return super.off(event, listener as (...args: unknown[]) => void);
  }
}
