/**
 * Setup/Production tier write-gating (plan_project_roles.md, decided
 * 2026-07-26), shared by routes/cameras.js, routes/mixers.js,
 * routes/encoders.js, and routes/bridge.js — each of those routers mixes
 * Setup-tier CRUD with Production-tier live-control verbs on the *same*
 * router, so gating is applied per-route at each router's own mount site,
 * not blanket-applied here. This module only owns the one shared gate
 * factory so the four callers don't each reimplement it slightly differently.
 *
 * lcyt-production has no direct access to lcyt-backend's project_members
 * table (plugin boundary), so the actual role check is injected from the
 * composition root as `deps.checkProjectRole` — same shape as
 * ai-providers-project.js's requireExplicitAdmin / roles.js's requireSetup
 * (both in lcyt-agent).
 *
 * Deliberately keyed off `req.session?.apiKey` (not
 * `req.auth?.projectId`/`req.project?.projectId`) — matching the
 * lcyt-agent plugin convention (roles.js, ai-providers-project.js), not
 * lcyt-backend's own middleware/project-access.js internals. This also has a
 * load-bearing side effect specific to this plugin: routes/cameras.js's
 * WHIP/thumbnail carve-out (isUnauthenticatedCameraRoute) and
 * routes/mixers.js's kiosk carve-out (isUnauthenticatedMixerRoute) mean
 * `opts.auth` never runs at all for some requests — including
 * credential-less POST /:id/switch/:inputNumber from LcytMixerPage.jsx's
 * kiosk "cut" button — so req.session is never populated for those. This
 * gate fails OPEN (next()) whenever req.session?.apiKey is absent, exactly
 * mirroring middleware/project-access.js's requireProjectRole() "no
 * resolvable project id is the route handler's own 400 to raise, not this
 * gate's 403" reasoning — that is what preserves the kiosk's pre-existing
 * fully-open behavior (see cameras-routes.test.js / mixers-routes.test.js's
 * "historical open behavior" tests) instead of a hard regression to 403.
 *
 * Once req.session.apiKey IS present (auth ran — a real operator/admin
 * session, or a test's fake auth), this fails CLOSED: no injected
 * deps.checkProjectRole, no req.user.userId (a plain session JWT never
 * carries one), or a resolved role below the tier's minimum all 403 — same
 * fail-closed convention as the 2026-07-20 interim fix.
 *
 * @param {{ checkProjectRole?: (tier: string, apiKey: string, userId: number) => boolean }} deps
 * @param {'setup'|'production'} tier
 * @returns {import('express').RequestHandler}
 */
export function requireTier(deps, tier) {
  const label = tier === 'setup' ? 'admin/owner' : 'operator+';
  return function requireTierMiddleware(req, res, next) {
    const apiKey = req.session?.apiKey;
    if (!apiKey) return next();
    const userId = req.user?.userId;
    if (typeof deps.checkProjectRole !== 'function' || !userId || !deps.checkProjectRole(tier, apiKey, userId)) {
      return res.status(403).json({ error: `Explicit project ${label} access required` });
    }
    next();
  };
}
