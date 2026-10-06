import { RATE_LIMIT } from "@/config";

/**
 * Fixed-window rate limiter held in process memory.
 *
 * Deliberately simple, with known limits recorded in DECISIONS.md: the counters
 * reset when the server restarts, and each instance counts separately, so this
 * is only correct on a single long-running Node server.
 */
type Window = { count: number; resetAt: number };

const windows = new Map<string, Window>();

/** Drops expired windows so the map cannot grow without bound. */
function sweep(now: number): void {
  for (const [key, window] of windows) {
    if (window.resetAt <= now) windows.delete(key);
  }
}

/**
 * The client's address: the first entry of `x-forwarded-for` (the original
 * client, when a proxy is in front), falling back to the connection address.
 */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

export type RateLimitResult =
  | { allowed: true; remaining: number }
  | { allowed: false; retryAfterSeconds: number };

export function checkRateLimit(key: string, now = Date.now()): RateLimitResult {
  // Sweeping on every call is affordable at this scale and keeps the map small.
  sweep(now);

  const windowMs = RATE_LIMIT.windowSeconds * 1000;
  const existing = windows.get(key);

  if (!existing || existing.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: RATE_LIMIT.max - 1 };
  }

  if (existing.count >= RATE_LIMIT.max) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }

  existing.count += 1;
  return { allowed: true, remaining: RATE_LIMIT.max - existing.count };
}

/** Test seam: lets the evidence script start from a clean window. */
export function resetRateLimits(): void {
  windows.clear();
}
