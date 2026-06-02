/**
 * Security event hook for payfyio.
 *
 * payfyio runs inside *your* server. It never phones home. Instead it surfaces
 * security-relevant signals (a forged 3DS callback, repeated provider errors,
 * a misconfiguration) to a callback you provide, so you can log/alert/email on
 * your own infrastructure and stop a problem before it affects your customers.
 *
 * What is intentionally NOT included in an event: full card numbers, CVV,
 * expiry, secret keys, or raw provider credentials. Keep it that way when you
 * add metadata.
 */

export type SecurityEventType =
  /** A 3DS callback failed signature/hash verification — possible forgery attempt. */
  | 'callback_verification_failed'
  /** A provider returned an HTTP error (4xx/5xx) or the request failed. High rates suggest probing or an outage. */
  | 'provider_http_error'
  /** A provider was constructed with missing/invalid configuration. */
  | 'config_invalid'
  /** A non-idempotent request timed out and was deliberately NOT retried (possible silent double-charge risk). */
  | 'retry_suppressed'
  /** Catch-all for integrator-emitted custom signals. */
  | 'custom';

export type SecuritySeverity = 'info' | 'warn' | 'critical';

export interface PayfyioSecurityEvent {
  type: SecurityEventType;
  severity: SecuritySeverity;
  /** Provider that produced the event, when applicable (e.g. 'paytr'). */
  provider?: string;
  /** Short, human-readable explanation. Safe to log. */
  message: string;
  /** Small, non-sensitive context. NEVER put PAN/CVV/secrets here. */
  metadata?: Record<string, unknown>;
  /** ISO timestamp; set by the emitter if omitted. */
  timestamp: string;
}

/** May be sync or async. Throwing/rejecting must never break the payment flow. */
export type SecurityEventHandler = (
  event: PayfyioSecurityEvent,
) => void | Promise<void>;

const DEFAULT_SEVERITY: Record<SecurityEventType, SecuritySeverity> = {
  callback_verification_failed: 'critical',
  provider_http_error: 'warn',
  config_invalid: 'warn',
  retry_suppressed: 'info',
  custom: 'info',
};

/**
 * Fan-out for security events. Best-effort: a handler that throws or rejects is
 * isolated and logged to the console, never propagated to the caller. This is
 * deliberate — observability must not be able to fail a payment.
 */
export class SecurityEventEmitter {
  private readonly handlers: SecurityEventHandler[];

  constructor(handlers: SecurityEventHandler[] = []) {
    this.handlers = handlers.filter((h): h is SecurityEventHandler => typeof h === 'function');
  }

  get hasHandlers(): boolean {
    return this.handlers.length > 0;
  }

  /**
   * Emit an event to all handlers. Fire-and-forget: returns immediately and
   * swallows any handler error. `timestamp` and `severity` are filled in when
   * not supplied.
   */
  emit(
    event: Omit<PayfyioSecurityEvent, 'timestamp' | 'severity'> &
      Partial<Pick<PayfyioSecurityEvent, 'timestamp' | 'severity'>>,
  ): void {
    if (!this.handlers.length) return;
    const full: PayfyioSecurityEvent = {
      severity: event.severity ?? DEFAULT_SEVERITY[event.type] ?? 'info',
      timestamp: event.timestamp ?? new Date().toISOString(),
      ...event,
    };
    for (const handler of this.handlers) {
      try {
        const r = handler(full);
        if (r && typeof (r as Promise<void>).catch === 'function') {
          (r as Promise<void>).catch((err) => reportHandlerError(err));
        }
      } catch (err) {
        reportHandlerError(err);
      }
    }
  }
}

function reportHandlerError(err: unknown): void {
  console.error('[payfyio] security event handler threw:', err);
}
