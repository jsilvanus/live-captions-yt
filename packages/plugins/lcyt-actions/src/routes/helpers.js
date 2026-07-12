/**
 * Shared route helpers for lcyt-actions' Express router. Duplicated from
 * lcyt-connectors for the same reason: lcyt-backend depends on this plugin, so
 * the plugin cannot depend back on lcyt-backend without a cycle.
 */

/**
 * Reads `req.session.apiKey` (set by lcyt-backend's session auth middleware),
 * 401ing if absent.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @returns {string|null}
 */
export function requireApiKey(req, res) {
  const apiKey = req.session?.apiKey;
  if (!apiKey) {
    res.status(401).json({ error: 'Not authenticated' });
    return null;
  }
  return apiKey;
}

/** lowercase, digits, single hyphens; must start alphanumeric. */
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

export function isValidSlug(slug) {
  return typeof slug === 'string' && slug.length > 0 && slug.length <= 64 && SLUG_RE.test(slug);
}
