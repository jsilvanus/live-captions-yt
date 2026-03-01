import { Router } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { getDomainUsageStats } from '../db.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_ALLOWED_DOMAINS = 'lcyt.fi,www.lcyt.fi';

/**
 * Parse ALLOWED_DOMAINS env var.
 * @returns {'*' | string[]}
 */
function parseAllowedDomains() {
  const raw = process.env.ALLOWED_DOMAINS ?? DEFAULT_ALLOWED_DOMAINS;
  return raw === '*' ? '*' : raw.split(',').map(d => d.trim()).filter(Boolean);
}

/**
 * Factory for the /usage router.
 *
 * GET /usage — Return per-domain caption and session statistics.
 *
 * Auth:
 *   - If USAGE_PUBLIC env var is set: no authentication required (public endpoint)
 *   - Otherwise: requires X-Admin-Key header (same key as /keys admin routes)
 *
 * Query parameters:
 *   from        YYYY-MM-DD  Start date, inclusive. Defaults to today.
 *   to          YYYY-MM-DD  End date, inclusive. Defaults to today.
 *   granularity hour|day    Time bucket size. Defaults to "day".
 *   domain      string      Filter to a specific domain.
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {Router}
 */
export function createUsageRouter(db) {
  const router = Router();

  router.get('/', (req, res) => {
    // Auth: skip if USAGE_PUBLIC is set, otherwise require admin key
    if (!process.env.USAGE_PUBLIC) {
      const adminKey = process.env.ADMIN_KEY;
      if (!adminKey) {
        return res.status(503).json({ error: 'Usage stats are not publicly available. Set USAGE_PUBLIC or ADMIN_KEY.' });
      }
      const provided = req.headers['x-admin-key'];
      if (!provided) {
        return res.status(401).json({ error: 'X-Admin-Key header required' });
      }
      const adminBuf = Buffer.from(adminKey);
      const providedBuf = Buffer.from(provided);
      if (adminBuf.length !== providedBuf.length || !timingSafeEqual(adminBuf, providedBuf)) {
        return res.status(403).json({ error: 'Invalid admin key' });
      }
    }

    const today = new Date().toISOString().slice(0, 10);
    const from = req.query.from || today;
    const to = req.query.to || today;
    const granularity = req.query.granularity === 'hour' ? 'hour' : 'day';
    const domain = req.query.domain || undefined;

    if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
      return res.status(400).json({ error: 'from and to must be YYYY-MM-DD' });
    }
    if (from > to) {
      return res.status(400).json({ error: 'from must be <= to' });
    }

    // Enforce ALLOWED_DOMAINS on the stats view
    const allowedDomains = parseAllowedDomains();
    if (domain && allowedDomains !== '*' && !allowedDomains.includes(domain)) {
      return res.status(403).json({ error: 'Domain not allowed' });
    }

    const rows = getDomainUsageStats(db, { from, to, granularity, domain });
    const data = allowedDomains === '*' ? rows : rows.filter(r => allowedDomains.includes(r.domain));

    return res.status(200).json({
      from,
      to,
      granularity,
      public: Boolean(process.env.USAGE_PUBLIC),
      data,
    });
  });

  return router;
}
