/**
 * Per-job ingest token: a perception job proves to the backend that it is the
 * job that was dispatched for exactly this (project, camera, feed kind), instead
 * of every job holding the global BACKEND_INTERNAL_TOKEN. The token is an HMAC of
 * the job scope, so the backend needs no token table and a restart does not
 * invalidate running jobs. A leaked token can only post for its own job's scope.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

/** @param {{ apiKey: string, cameraId?: string|null, feedKind?: string|null, jobId: string }} scope */
function scopeString({ apiKey, cameraId, feedKind, jobId }) {
  return [apiKey, cameraId ?? '', feedKind ?? '', jobId].join('|');
}

export function mintIngestToken(secret, scope) {
  return createHmac('sha256', secret).update(scopeString(scope)).digest('hex');
}

export function verifyIngestToken(secret, scope, token) {
  if (!secret || typeof token !== 'string' || !scope?.apiKey || !scope?.jobId) return false;
  const expected = Buffer.from(mintIngestToken(secret, scope));
  const given = Buffer.from(token);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
