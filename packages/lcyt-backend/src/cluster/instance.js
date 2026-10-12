import { hostname } from 'node:os';
import { randomBytes } from 'node:crypto';

let cached = null;

/**
 * Identity of this backend process, shown in /health, logs and the `instances` table.
 * `INSTANCE_ID` (env) wins; otherwise `<hostname>-<pid>-<random>`, new on every start so a
 * restarted process never inherits the leases of its dead predecessor.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
export function getInstanceId(env = process.env) {
  if (cached) return cached;
  const fromEnv = (env.INSTANCE_ID || '').trim();
  cached = fromEnv || `${hostname()}-${process.pid}-${randomBytes(3).toString('hex')}`;
  return cached;
}

/** Test hook: forget the cached id. */
export function resetInstanceId() {
  cached = null;
}
