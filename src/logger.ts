/**
 * StrictDB Logger — Structured operation logging
 *
 * Emits operation events with timing, receipt, and optionally the native query.
 */

import type { OperationReceipt } from './types.js';
import type { StrictDBEventEmitter } from './events.js';

export interface LoggerConfig {
  enabled: boolean;
  verbose: boolean;
  slowQueryMs: number;
}

export class StrictDBLogger {
  private config: LoggerConfig;
  private emitter: StrictDBEventEmitter;

  constructor(config: LoggerConfig, emitter: StrictDBEventEmitter) {
    this.config = config;
    this.emitter = emitter;
  }

  /**
   * Log a completed operation.
   */
  logOperation(receipt: OperationReceipt, _nativeQuery?: string | object): void {
    if (!this.config.enabled) return;

    this.emitter.emit('operation', {
      collection: receipt.collection,
      operation: receipt.operation,
      durationMs: receipt.duration,
      receipt,
    });

    // Check slow query threshold
    if (receipt.duration >= this.config.slowQueryMs) {
      this.emitter.emit('slow-query', {
        collection: receipt.collection,
        operation: receipt.operation,
        durationMs: receipt.duration,
        threshold: this.config.slowQueryMs,
      });
    }
  }
}
