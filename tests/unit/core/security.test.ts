import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SecurityEventEmitter } from '../../../src/core/security';
import { throttle, consoleNotifier } from '../../../src/core/notifiers';
import type { PayfyioSecurityEvent } from '../../../src/core/security';

describe('SecurityEventEmitter', () => {
  it('does nothing when no handlers are registered', () => {
    const emitter = new SecurityEventEmitter();
    expect(emitter.hasHandlers).toBe(false);
    // Should not throw.
    emitter.emit({ type: 'custom', message: 'noop' });
  });

  it('delivers events to all handlers with filled-in defaults', () => {
    const a = vi.fn();
    const b = vi.fn();
    const emitter = new SecurityEventEmitter([a, b]);
    emitter.emit({ type: 'callback_verification_failed', message: 'forged' });

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    const event: PayfyioSecurityEvent = a.mock.calls[0][0];
    expect(event.type).toBe('callback_verification_failed');
    // Default severity for a forged callback is critical.
    expect(event.severity).toBe('critical');
    expect(typeof event.timestamp).toBe('string');
  });

  it('respects an explicit severity override', () => {
    const handler = vi.fn();
    const emitter = new SecurityEventEmitter([handler]);
    emitter.emit({ type: 'custom', message: 'x', severity: 'critical' });
    expect(handler.mock.calls[0][0].severity).toBe('critical');
  });

  it('isolates a throwing handler so others still run', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const bad = vi.fn(() => {
      throw new Error('boom');
    });
    const good = vi.fn();
    const emitter = new SecurityEventEmitter([bad, good]);

    expect(() => emitter.emit({ type: 'custom', message: 'x' })).not.toThrow();
    expect(good).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('swallows a rejecting async handler', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const rejecting = vi.fn(async () => {
      throw new Error('async boom');
    });
    const emitter = new SecurityEventEmitter([rejecting]);
    emitter.emit({ type: 'custom', message: 'x' });
    // Let the rejected microtask settle.
    await Promise.resolve();
    await Promise.resolve();
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});

describe('throttle', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('drops events below minSeverity', () => {
    const handler = vi.fn();
    const guarded = throttle(handler, { minSeverity: 'warn' });
    guarded({ type: 'custom', severity: 'info', message: 'x', timestamp: 't' });
    expect(handler).not.toHaveBeenCalled();
    guarded({ type: 'custom', severity: 'warn', message: 'x', timestamp: 't' });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('de-dupes identical events within the window, then allows again after', () => {
    const handler = vi.fn();
    const guarded = throttle(handler, { minSeverity: 'info', windowMs: 1000 });
    const ev = (): PayfyioSecurityEvent => ({
      type: 'provider_http_error',
      severity: 'warn',
      provider: 'paytr',
      message: 'x',
      timestamp: 't',
    });

    guarded(ev());
    guarded(ev());
    guarded(ev());
    expect(handler).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1001);
    guarded(ev());
    expect(handler).toHaveBeenCalledTimes(2);
  });
});

describe('consoleNotifier', () => {
  it('routes critical to console.error and warn to console.warn', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const notify = consoleNotifier({ minSeverity: 'info' });

    notify({ type: 'callback_verification_failed', severity: 'critical', message: 'a', timestamp: 't' });
    notify({ type: 'provider_http_error', severity: 'warn', message: 'b', timestamp: 't' });

    expect(err).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    err.mockRestore();
    warn.mockRestore();
  });
});
