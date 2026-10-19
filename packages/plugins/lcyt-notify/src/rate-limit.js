// Sliding-window rate limiter and per-key cooldown for notify sends.
// In-memory and per process: the notify log in the database is the durable record.

/**
 * Allow at most `limit` events per `windowMs` for each key.
 * @param {{ limit: number, windowMs: number, now?: () => number }} opts
 */
export function createRateLimiter({ limit, windowMs, now = Date.now }) {
  const hits = new Map();
  return {
    /** Returns true and records the hit when allowed; false when over the limit. */
    take(key) {
      const t = now();
      const recent = (hits.get(key) || []).filter((ts) => t - ts < windowMs);
      if (recent.length >= limit) {
        hits.set(key, recent);
        return false;
      }
      recent.push(t);
      hits.set(key, recent);
      return true;
    },
  };
}

/**
 * Suppress a repeated (key) for `cooldownMs` after it was last allowed.
 * @param {{ cooldownMs: number, now?: () => number }} opts
 */
export function createCooldown({ cooldownMs, now = Date.now }) {
  const last = new Map();
  return {
    /** Returns true and starts the cooldown when allowed; false while cooling down. */
    take(key) {
      const t = now();
      const prev = last.get(key);
      if (prev !== undefined && t - prev < cooldownMs) return false;
      last.set(key, t);
      return true;
    },
  };
}
