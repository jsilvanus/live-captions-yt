import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Download tokens for handoff files. A token covers one handoff (`scope` = group id) and expires,
 * so a manifest URL can be given to another system without giving it a login.
 */
export function signHandoffToken(secret, groupId, expiresAtMs) {
  const mac = createHmac('sha256', secret).update(`handoff:${groupId}:${expiresAtMs}`).digest('hex');
  return `${expiresAtMs}.${mac}`;
}

export function verifyHandoffToken(secret, groupId, token, nowMs = Date.now()) {
  if (typeof token !== 'string') return false;
  const [exp, mac] = token.split('.');
  const expiresAt = Number(exp);
  if (!Number.isFinite(expiresAt) || !mac || expiresAt < nowMs) return false;
  const expected = createHmac('sha256', secret).update(`handoff:${groupId}:${expiresAt}`).digest('hex');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
