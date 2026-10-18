/**
 * Jobs panel routes, mounted at /jobs behind `scopedAuth('jobs')`.
 *
 *   GET /jobs        → { jobs: PanelJob[], counts: { running, queued } }
 *   GET /jobs/strip  → { enabled: true, fleet, local, app, stt, live }
 *   POST /jobs/:id/cancel → { ok: true } | 404 unknown/foreign | 409 not cancellable (live, relay, ...)
 *                          Only rows with `cancellable: true` (allow-list CANCELLABLE_PURPOSES in lcyt-compute).
 *
 * LCYT has no job table: the rows are the project's running ffmpeg runs (lcyt-compute accounting)
 * and its live session on the auditor STT service. An admin user sees every project's.
 * See lcyt-compute/src/jobs-panel.js for where the data comes from.
 */
import { Router } from 'express';

/**
 * @param {import('express').RequestHandler} auth  scopedAuth('jobs'): sets req.session.apiKey (the project)
 * @param {ReturnType<import('lcyt-compute/jobs-panel').createJobsPanelService>} service
 */
export function createJobsRouter(auth, service) {
  const router = Router();

  const scopeOf = (req) => ({ projectId: req.session?.apiKey || null, isAdmin: req.user?.isAdmin === true });

  router.get('/', auth, async (req, res) => {
    try {
      res.json(await service.jobs(scopeOf(req)));
    } catch (err) {
      res.status(500).json({ error: 'Could not read the jobs' });
    }
  });

  router.get('/strip', auth, async (req, res) => {
    try {
      res.json(await service.strip(scopeOf(req)));
    } catch (err) {
      res.status(500).json({ error: 'Could not read the fleet status' });
    }
  });

  router.post('/:id/cancel', auth, async (req, res) => {
    try {
      const result = await service.cancel(req.params.id, scopeOf(req));
      if (!result.ok) return res.status(result.status).json({ error: result.error });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: 'Could not cancel the job' });
    }
  });

  return router;
}
