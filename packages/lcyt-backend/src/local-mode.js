import jwt from 'jsonwebtoken';
import { createUser } from './db/users.js';
import { createKey } from './db/keys.js';
import { addMember } from './db/project-members.js';
import { extractAuthToken } from './middleware/auth.js';

/**
 * Local install mode (`LCYT_INSTALL_MODE=local`): a single-user install on the
 * operator's own machine (e.g. Docker Desktop) with no login. Every request
 * that carries no credentials of its own is treated as the built-in local
 * administrator, who owns every project. Credentials that are sent (tokens,
 * API keys, MCP tokens) are still verified as usual.
 *
 * Off by default. Never use it on a server reachable by other people.
 */

export const LOCAL_USER_EMAIL = 'local@lcyt.localhost';
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

/** @param {NodeJS.ProcessEnv} [env] */
export function isLocalMode(env = process.env) {
  const mode = String(env.LCYT_INSTALL_MODE ?? '').trim().toLowerCase();
  if (mode === '' || mode === 'server') return false;
  if (mode === 'local') return true;
  throw new Error(`Invalid LCYT_INSTALL_MODE "${env.LCYT_INSTALL_MODE}" (expected "local" or "server")`);
}

/**
 * Where local mode may listen. Defaults to loopback. A non-loopback `HOST`
 * (including 0.0.0.0, which a container needs) is refused unless
 * `LCYT_LOCAL_ALLOW_REMOTE=1` says the operator limits exposure some other
 * way (for example a compose port mapping bound to 127.0.0.1).
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ host: string, exposed: boolean, error?: string }}
 */
export function resolveLocalBind(env = process.env) {
  const host = (env.HOST || '127.0.0.1').trim();
  const allowRemote = ['1', 'true'].includes(String(env.LCYT_LOCAL_ALLOW_REMOTE ?? '').toLowerCase());
  const loopback = LOOPBACK_HOSTS.has(host);
  if (loopback) return { host, exposed: false };
  if (allowRemote) return { host, exposed: true };
  return {
    host,
    exposed: true,
    error: `LCYT_INSTALL_MODE=local has no login, but HOST=${host} is not a loopback address. `
      + 'Bind to 127.0.0.1, or set LCYT_LOCAL_ALLOW_REMOTE=1 if access is restricted another way '
      + '(e.g. a Docker port mapping on 127.0.0.1).',
  };
}

/** Create (once) the local admin user and its default project. */
export function ensureLocalIdentity(db) {
  let user = db.prepare('SELECT id FROM users WHERE email = ?').get(LOCAL_USER_EMAIL);
  if (!user) {
    // No usable password: the account can only be reached through local mode.
    user = createUser(db, { email: LOCAL_USER_EMAIL, passwordHash: '!local-mode', name: 'Local user' });
    db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(user.id);
  }
  const userId = Number(user.id);
  let key = db.prepare('SELECT key FROM api_keys WHERE user_id = ? AND active = 1 ORDER BY rowid LIMIT 1').get(userId);
  if (!key) key = createKey(db, { owner: 'Local project', user_id: userId });
  addMember(db, key.key, userId, 'owner');
  return { userId, email: LOCAL_USER_EMAIL, projectId: key.key };
}

const OWN_ALL_PROJECTS = `
  INSERT INTO project_members (api_key, user_id, access_level)
  SELECT key, ?, 'owner' FROM api_keys
  WHERE active = 1 AND key NOT IN (SELECT api_key FROM project_members WHERE user_id = ?)`;

/**
 * Express middleware: requests without credentials get the local admin's
 * token. Mount after the body parser and before every auth-gated router.
 */
export function createLocalModeMiddleware(db, jwtSecret, identity) {
  const token = jwt.sign(
    { type: 'user', kind: 'project', userId: identity.userId, email: identity.email, isAdmin: true,
      siteRole: 'admin', projectId: identity.projectId, projectRole: 'owner' },
    jwtSecret,
    { expiresIn: '30d' },
  );
  const ownAll = db.prepare(OWN_ALL_PROJECTS);
  const middleware = (req, _res, next) => {
    const hasAdminKey = Boolean(req.headers['x-admin-key']);
    if (!extractAuthToken(req) && !hasAdminKey) {
      req.headers.authorization = `Bearer ${token}`;
      // Projects created since the last request (any route) belong to the local user too.
      ownAll.run(identity.userId, identity.userId);
    }
    next();
  };
  middleware.token = token;
  return middleware;
}
