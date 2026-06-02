import axios from 'axios';
import type {
  PayfyioSecurityEvent,
  SecurityEventHandler,
  SecuritySeverity,
} from './security';

const SEVERITY_RANK: Record<SecuritySeverity, number> = {
  info: 0,
  warn: 1,
  critical: 2,
};

/**
 * Drops events below `minSeverity` and de-duplicates by (type + provider +
 * severity) within `windowMs`, so a burst of the same signal doesn't fan out
 * into hundreds of notifications. Shared by the built-in notifiers; exported
 * so integrators can wrap their own handler with the same guard.
 */
export function throttle(
  handler: SecurityEventHandler,
  opts: { minSeverity?: SecuritySeverity; windowMs?: number } = {},
): SecurityEventHandler {
  const minRank = SEVERITY_RANK[opts.minSeverity ?? 'warn'];
  const windowMs = opts.windowMs ?? 5 * 60 * 1000; // 5 minutes
  const lastSeen = new Map<string, number>();

  return (event: PayfyioSecurityEvent) => {
    if (SEVERITY_RANK[event.severity] < minRank) return;
    const key = `${event.type}|${event.provider ?? ''}|${event.severity}`;
    const now = Date.now();
    const prev = lastSeen.get(key);
    if (prev !== undefined && now - prev < windowMs) return;
    lastSeen.set(key, now);
    return handler(event);
  };
}

export interface WebhookNotifierOptions {
  /** URL that receives a JSON POST of the event. */
  url: string;
  /** Extra headers (e.g. an auth token). */
  headers?: Record<string, string>;
  /** Only notify at/above this severity. Default 'warn'. */
  minSeverity?: SecuritySeverity;
  /** De-dupe window for identical events, ms. Default 5 min. Set 0 to disable. */
  throttleMs?: number;
  /** Request timeout, ms. Default 5000. */
  timeoutMs?: number;
}

/**
 * A {@link SecurityEventHandler} that POSTs the event as JSON to a webhook.
 * Pair it with your own endpoint that emails / Slacks / records the alert —
 * payfyio stays dependency-light (axios only) and never sends mail itself.
 *
 * @example
 * new Payfyio({
 *   providers: { ... },
 *   securityNotifiers: [
 *     webhookNotifier({ url: 'https://ops.example.com/payfyio-alerts', minSeverity: 'critical' }),
 *   ],
 * });
 */
export function webhookNotifier(opts: WebhookNotifierOptions): SecurityEventHandler {
  const send: SecurityEventHandler = async (event) => {
    try {
      await axios.post(opts.url, event, {
        headers: { 'Content-Type': 'application/json', ...opts.headers },
        timeout: opts.timeoutMs ?? 5000,
      });
    } catch (err) {
      console.error('[payfyio] webhookNotifier failed to deliver event:', (err as Error)?.message);
    }
  };

  if (opts.throttleMs === 0) {
    return (event) => {
      if (SEVERITY_RANK[event.severity] < SEVERITY_RANK[opts.minSeverity ?? 'warn']) return;
      return send(event);
    };
  }
  return throttle(send, { minSeverity: opts.minSeverity, windowMs: opts.throttleMs });
}

/**
 * A {@link SecurityEventHandler} that writes the event to the console. Useful
 * in development or as a floor of visibility in production logs.
 */
export function consoleNotifier(
  opts: { minSeverity?: SecuritySeverity } = {},
): SecurityEventHandler {
  const minRank = SEVERITY_RANK[opts.minSeverity ?? 'warn'];
  return (event: PayfyioSecurityEvent) => {
    if (SEVERITY_RANK[event.severity] < minRank) return;
    const line = `[payfyio][security][${event.severity}] ${event.type}${
      event.provider ? ` (${event.provider})` : ''
    }: ${event.message}`;
    if (event.severity === 'critical') {
      console.error(line, event.metadata ?? {});
    } else {
      console.warn(line, event.metadata ?? {});
    }
  };
}
