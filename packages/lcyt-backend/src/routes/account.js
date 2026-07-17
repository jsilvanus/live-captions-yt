/**
 * Account router group — user & project management.
 *
 * Mounts: /auth, /keys, /keys/:key/features, /keys/:key/members, /keys/:key/slug, /keys/:key/device-roles
 *
 * No SessionStore dependency; all routes talk to the DB only.
 */
import { Router } from 'express';
import { createAuthRouter } from './auth.js';
import { createKeysRouter } from './keys.js';
import { createProjectFeaturesRouter } from './project-features.js';
import { createProjectMembersRouter } from './project-members.js';
import { createProjectSlugRouter } from './project-slug.js';
import { createDeviceRolesRouter } from './device-roles.js';
import { createProjectObservabilityRouter } from './project-observability.js';

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} jwtSecret
 * @param {{ loginEnabled?: boolean }} [opts]
 * @returns {Router}
 */
export function createAccountRouters(db, jwtSecret, { loginEnabled = true } = {}) {
  const router = Router();
  router.use('/auth', createAuthRouter(db, jwtSecret, { loginEnabled }));
  router.use('/keys', createKeysRouter(db, { loginEnabled, jwtSecret }));
  // Sub-key routes — routers use mergeParams:true so :key propagates correctly
  router.use('/keys/:key/features', createProjectFeaturesRouter(db, { loginEnabled, jwtSecret }));
  router.use('/keys/:key/members',  createProjectMembersRouter(db, { loginEnabled, jwtSecret }));
  router.use('/keys/:key/slug',     createProjectSlugRouter(db, { loginEnabled, jwtSecret }));
  // Project audit trail + usage rollups (plan_metering_audit §5.5, §6.1)
  router.use('/keys/:key',          createProjectObservabilityRouter(db, { loginEnabled, jwtSecret }));
  router.use('/keys/:key',          createDeviceRolesRouter(db, { loginEnabled, jwtSecret }));
  return router;
}
