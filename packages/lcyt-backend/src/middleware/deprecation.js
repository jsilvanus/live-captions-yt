import logger from 'lcyt/logger';

const WARN_INTERVAL_MS = 10 * 60 * 1000;

/**
 * Mark a route as deprecated: sets `Deprecation: true` and a `Link` header
 * pointing at the removal plan, and logs a warning (throttled per route so a
 * busy nginx-rtmp does not flood the log). The request is still handled.
 *
 * @param {string} label    Short name used in the log, e.g. '/rtmp'
 * @param {string} message  What to use instead
 * @param {{ planUrl?: string, now?: () => number }} [opts]
 * @returns {import('express').RequestHandler}
 */
export function deprecatedRoute(label, message, { planUrl = DEFAULT_PLAN_URL, now = Date.now } = {}) {
  let lastWarn = -Infinity;
  return (req, res, next) => {
    res.set('Deprecation', 'true');
    res.set('Link', `<${planUrl}>; rel="deprecation"`);
    const t = now();
    if (t - lastWarn >= WARN_INTERVAL_MS) {
      lastWarn = t;
      logger.warn(`[deprecated] ${req.method} ${label} was called — ${message}`);
    }
    next();
  };
}

export const DEFAULT_PLAN_URL =
  'https://github.com/jsilvanus/live-captions-yt/blob/main/docs/plans/plan_nginx_rtmp_deprecation.md';

export const NGINX_RTMP_MESSAGE =
  'nginx-rtmp callbacks are deprecated; use MediaMTX (see docs/plans/plan_nginx_rtmp_deprecation.md)';
