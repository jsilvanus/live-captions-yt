/**
 * The one message every part of the system exchanges.
 *
 *   { v: 1, state, detail?, checkedAt, ttlMs }
 *
 * `checkedAt` is epoch milliseconds on the sender's clock. A receiver must NOT
 * compare it with its own clock (the two may differ); it computes the deadline
 * from the moment it received the reading: `receivedAt + ttlMs`.
 */
import { isState } from './states.js';

export const READING_VERSION = 1;
export const DEFAULT_TTL_MS = 15_000;

export function makeReading({ state, detail, checkedAt, ttlMs = DEFAULT_TTL_MS }) {
  const reading = { v: READING_VERSION, state, checkedAt: checkedAt ?? Date.now(), ttlMs };
  if (detail) reading.detail = String(detail);
  return reading;
}

/** Validate a reading received from elsewhere. Returns `{ ok, reading?, error? }`. */
export function parseReading(kind, input) {
  if (!input || typeof input !== 'object') return { ok: false, error: 'reading must be an object' };
  if (input.v !== READING_VERSION) return { ok: false, error: `unsupported reading version ${input.v}` };
  if (!isState(kind, input.state)) return { ok: false, error: `state ${input.state} is not valid for kind ${kind}` };
  const ttlMs = Number(input.ttlMs);
  if (!Number.isFinite(ttlMs) || ttlMs < 1000 || ttlMs > 3_600_000) {
    return { ok: false, error: 'ttlMs must be between 1000 and 3600000' };
  }
  const checkedAt = Number(input.checkedAt);
  if (!Number.isFinite(checkedAt)) return { ok: false, error: 'checkedAt must be epoch milliseconds' };
  const reading = { v: READING_VERSION, state: input.state, checkedAt, ttlMs };
  if (typeof input.detail === 'string' && input.detail) reading.detail = input.detail.slice(0, 200);
  return { ok: true, reading };
}

/**
 * The state to show right now: the reading's own state while it is fresh, the
 * kind's `UNKNOWN` once `receivedAt + ttlMs` has passed. This is the deadman.
 */
export function effectiveState(reading, receivedAt, now) {
  if (!reading) return 'UNKNOWN';
  return now - receivedAt > reading.ttlMs ? 'UNKNOWN' : reading.state;
}
