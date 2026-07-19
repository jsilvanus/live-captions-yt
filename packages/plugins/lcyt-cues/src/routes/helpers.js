/**
 * Shared route helpers for lcyt-cues' Express router. Duplicated from
 * lcyt-actions/lcyt-connectors for the same reason: lcyt-backend depends on
 * this plugin, so the plugin cannot depend back on lcyt-backend without a
 * cycle.
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
