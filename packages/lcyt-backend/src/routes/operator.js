/**
 * Operator routes (Phase 2 — plan_unified_external_control.md).
 *
 * REST API for managing the hosted operator (start/stop/status, confirm/reject
 * pending actions). The operator itself subscribes to EventBus and accumulates
 * context autonomously; these routes are the human control surface.
 *
 * Auth: project-scoped with `operator` resource scope.
 */

import { Router } from 'express';

/**
 * @param {import('../operator-manager.js').OperatorManager} operatorManager
 * @returns {Router}
 */
export function createOperatorRouter(operatorManager) {
  const router = Router();

  // POST /operator/start — start the operator for the caller's project
  router.post('/start', (req, res) => {
    const projectId = req.auth?.projectId;
    if (!projectId) return res.status(401).json({ error: 'Not authorized' });

    const { topics, mode, cooldownMs, systemPrompt } = req.body || {};
    const result = operatorManager.start(projectId, { topics, mode, cooldownMs, systemPrompt });

    if (!result.ok) return res.status(409).json(result);
    return res.status(201).json(result);
  });

  // POST /operator/stop — stop the operator
  router.post('/stop', (req, res) => {
    const projectId = req.auth?.projectId;
    if (!projectId) return res.status(401).json({ error: 'Not authorized' });

    const result = operatorManager.stop(projectId);
    if (!result.ok) return res.status(404).json(result);
    return res.json(result);
  });

  // GET /operator/status — get operator status
  router.get('/status', (req, res) => {
    const projectId = req.auth?.projectId;
    if (!projectId) return res.status(401).json({ error: 'Not authorized' });

    return res.json(operatorManager.status(projectId));
  });

  // GET /operator/pending — list pending actions
  router.get('/pending', (req, res) => {
    const projectId = req.auth?.projectId;
    if (!projectId) return res.status(401).json({ error: 'Not authorized' });

    return res.json({ actions: operatorManager.listPending(projectId) });
  });

  // POST /operator/pending/:id/confirm — confirm a pending action
  router.post('/pending/:id/confirm', async (req, res) => {
    const projectId = req.auth?.projectId;
    if (!projectId) return res.status(401).json({ error: 'Not authorized' });

    const result = await operatorManager.confirmAction(projectId, req.params.id);
    if (!result.ok) return res.status(404).json(result);
    return res.json(result);
  });

  // POST /operator/pending/:id/reject — reject a pending action
  router.post('/pending/:id/reject', (req, res) => {
    const projectId = req.auth?.projectId;
    if (!projectId) return res.status(401).json({ error: 'Not authorized' });

    const result = operatorManager.rejectAction(projectId, req.params.id);
    if (!result.ok) return res.status(404).json(result);
    return res.json(result);
  });

  return router;
}
