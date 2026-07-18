/**
 * Device role JWT verification middleware (Item 4 — Phase 4).
 * Checks that a device role is still active on every request, not just at login.
 *
 * Device JWTs carry a 1-hour TTL but a deactivated/expired role should revoke access
 * immediately. This middleware ensures the role is still active + not time-expired.
 */

import jwt from 'jsonwebtoken';
import { isDeviceRoleActive } from '../db/device-roles.js';

/**
 * Create middleware that verifies device JWT is still valid.
 * Device JWTs should be present if the request was authenticated via device login.
 * @param {import('better-sqlite3').Database} db
 * @param {string} jwtSecret
 * @returns {import('express').RequestHandler}
 */
export function createDeviceAuthMiddleware(db, jwtSecret) {
  return (req, res, next) => {
    // Only check if this request has device authentication (req.auth.kind === 'device').
    // Other requests (user, session, admin) skip this check.
    if (!req.auth || req.auth.kind !== 'device') {
      return next();
    }

    const roleId = req.auth.roleId;
    if (!roleId) {
      return res.status(401).json({ error: 'Invalid device authentication' });
    }

    // Check that the device role is still active (not deactivated and not expired).
    if (!isDeviceRoleActive(db, roleId)) {
      return res.status(401).json({ error: 'Device role is inactive or expired' });
    }

    next();
  };
}
