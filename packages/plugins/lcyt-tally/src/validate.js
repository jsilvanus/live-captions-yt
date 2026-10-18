import { validateLightConfig, findOutputClash } from '../vendor/stream-light/core/config.js';

/**
 * Validate a light config from a request body.
 * ttlMs/activeMs/idleMs are not stored (the table has no column for them), so they are dropped.
 * @returns {{ ok: true, value: object } | { ok: false, errors: string[] }}
 */
export function validateConfig(body) {
  const res = validateLightConfig({ ...body, id: undefined });
  if (!res.ok) return res;
  const { ttlMs, activeMs, idleMs, id, ...value } = res.value;
  return { ok: true, value };
}

/** Two enabled lights of one project must not drive the same lamp. Returns an error text or null. */
export function clashError(existingConfigs, candidate) {
  const others = existingConfigs.filter((c) => c.id !== candidate.id);
  const clash = findOutputClash([...others, candidate]);
  return clash ? `Lights "${clash[0]}" and "${clash[1]}" would drive the same lamp` : null;
}
