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
export async function ensureLocalIdentity(db) {
  let user = await db.users.findUnique({ where: { email: LOCAL_USER_EMAIL }, select: { id: true } });
  if (!user) {
    // No usable password: the account can only be reached through local mode.
    user = await createUser(db, { email: LOCAL_USER_EMAIL, passwordHash: '!local-mode', name: 'Local user' });
    await db.users.updateMany({ where: { id: user.id }, data: { is_admin: 1 } });
  }
  const userId = Number(user.id);
  let key = await db.api_keys.findFirst({ where: { user_id: userId, active: 1 }, orderBy: { id: 'asc' }, select: { key: true } });
  if (!key) key = await createKey(db, { owner: 'Local project', user_id: userId });
  await addMember(db, key.key, userId, 'owner');
  return { userId, email: LOCAL_USER_EMAIL, projectId: key.key };
}

/** Make the local user owner of every active project it is not yet a member of. */
async function ownAllProjects(db, userId) {
  const projects = await db.api_keys.findMany({
    where: { active: 1, project_members: { none: { user_id: userId } } },
    select: { key: true },
  });
  if (!projects.length) return;
  await db.$transaction(async (tx) => {
    for (const { key } of projects) {
      await tx.project_members.upsert({
        where: { api_key_user_id: { api_key: key, user_id: userId } },
        create: { api_key: key, user_id: userId, access_level: 'owner' },
        update: {},
      });
    }
  });
}

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
  const middleware = async (req, _res, next) => {
    const hasAdminKey = Boolean(req.headers['x-admin-key']);
    if (!extractAuthToken(req) && !hasAdminKey) {
      req.headers.authorization = `Bearer ${token}`;
      // Projects created since the last request (any route) belong to the local user too.
      try { await ownAllProjects(db, identity.userId); } catch (err) { return next(err); }
    }
    next();
  };
  middleware.token = token;
  return middleware;
}
