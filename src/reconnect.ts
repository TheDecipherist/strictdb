/**
 * StrictDB Reconnect Manager — Exponential backoff reconnection
 *
 * Handles auto-reconnect for all backends with jittered exponential backoff.
 */

import type { Backend, ReconnectConfig } from './types.js';
import type { StrictDBEventEmitter } from './events.js';

const DEFAULTS: Required<ReconnectConfig> = {
  enabled: true,
  maxAttempts: 10,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
};

export class ReconnectManager {
  private config: Required<ReconnectConfig>;
  private emitter: StrictDBEventEmitter;
  private backend: string;
  private attempts = 0;
  private disconnectedAt: Date | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private _stopped = false;

  constructor(
    config: ReconnectConfig | boolean | undefined,
    emitter: StrictDBEventEmitter,
    backend: string,
  ) {
    if (config === false) {
      this.config = { ...DEFAULTS, enabled: false };
    } else if (config === true || config === undefined) {
      this.config = { ...DEFAULTS };
    } else {
      this.config = { ...DEFAULTS, ...config };
    }
    this.emitter = emitter;
    this.backend = backend;
  }

  get enabled(): boolean {
    return this.config.enabled;
  }

  get attemptCount(): number {
    return this.attempts;
  }

  get lastDisconnect(): Date | undefined {
    return this.disconnectedAt ?? undefined;
  }

  /**
   * Start reconnect loop. Calls connectFn on each attempt.
   * Returns when connected or max attempts exceeded.
   */
  async reconnect(connectFn: () => Promise<void>): Promise<boolean> {
    if (!this.config.enabled || this._stopped) return false;

    this.disconnectedAt = new Date();
    this.attempts = 0;

    this.emitter.emit('disconnected', {
      backend: this.backend,
      reason: 'Connection lost',
      timestamp: this.disconnectedAt,
    });

    while (this.attempts < this.config.maxAttempts && !this._stopped) {
      this.attempts++;
      const delay = this.calculateDelay();

      this.emitter.emit('reconnecting', {
        backend: this.backend,
        attempt: this.attempts,
        maxAttempts: this.config.maxAttempts,
        delayMs: delay,
      });

      await this.sleep(delay);

      if (this._stopped) return false;

      try {
        await connectFn();
        const downtimeMs = Date.now() - this.disconnectedAt!.getTime();

        this.emitter.emit('reconnected', {
          backend: this.backend,
          attempt: this.attempts,
          downtimeMs,
        });

        this.attempts = 0;
        this.disconnectedAt = null;
        return true;
      } catch {
        // Continue to next attempt
      }
    }

    // Max attempts exceeded
    this.emitter.emit('error', {
      code: 'CONNECTION_LOST',
      message: `Reconnect failed after ${this.attempts} attempts.`,
      fix: `Check the database server and network connectivity. Max attempts: ${this.config.maxAttempts}.`,
      backend: this.backend as Backend,
    });

    return false;
  }

  stop(): void {
    this._stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  reset(): void {
    this.attempts = 0;
    this.disconnectedAt = null;
    this._stopped = false;
  }

  private calculateDelay(): number {
    const baseDelay = this.config.initialDelayMs * Math.pow(this.config.backoffMultiplier, this.attempts - 1);
    const capped = Math.min(baseDelay, this.config.maxDelayMs);
    // Add jitter (±25%)
    const jitter = capped * (0.75 + Math.random() * 0.5);
    return Math.round(jitter);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => {
      this.timer = setTimeout(resolve, ms);
    });
  }
}
