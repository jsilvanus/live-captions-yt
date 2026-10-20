/**
 * /outputs — egress outputs of a project (plan plan_egress_outputs.md).
 *
 *   GET    /outputs        { outputs: [...] }
 *   POST   /outputs        { name, sourceType, sourceId, dsk?, cropEnabled?, audioSource?, enabled?, sortOrder? } → 201 output
 *   PATCH  /outputs/:id    any of the same fields
 *   DELETE /outputs/:id    409 while another output or a relay slot uses it
 *
 * Crop settings of an output live under /crop (`outputId` query or body field). Session Bearer; writes are Setup tier.
 */

import { Router } from 'express';
import logger from 'lcyt/logger';
import { listOutputs, createOutput, updateOutput, deleteOutput } from '../db/outputs.js';

export function createOutputsRouter(db, auth, requireSetup = (req, res, next) => next()) {
  const router = Router();
  router.use(auth);

  router.get('/', async (req, res) => {
    try {
      res.json({ outputs: await listOutputs(db, req.session.apiKey) });
    } catch (err) {
      logger.error(`[outputs] list failed: ${err.message}`);
      res.status(500).json({ error: 'Could not list outputs' });
    }
  });

  const reply = (res, r, okStatus = 200) => (r.ok
    ? res.status(okStatus).json(r.output ?? { ok: true })
    : res.status(r.status).json({ error: r.error }));

  router.post('/', requireSetup, async (req, res) => {
    try { reply(res, await createOutput(db, req.session.apiKey, req.body), 201); }
    catch (err) { logger.error(`[outputs] create failed: ${err.message}`); res.status(500).json({ error: 'Could not create output' }); }
  });

  router.patch('/:id', requireSetup, async (req, res) => {
    try { reply(res, await updateOutput(db, req.session.apiKey, req.params.id, req.body)); }
    catch (err) { logger.error(`[outputs] update failed: ${err.message}`); res.status(500).json({ error: 'Could not update output' }); }
  });

  router.delete('/:id', requireSetup, async (req, res) => {
    try { reply(res, await deleteOutput(db, req.session.apiKey, req.params.id)); }
    catch (err) { logger.error(`[outputs] delete failed: ${err.message}`); res.status(500).json({ error: 'Could not delete output' }); }
  });

  return router;
}
