/**
 * /translation/config routes — server-persisted translation vendor + language
 * configuration (plan/selfservice_config_backend §1).
 *
 * Session Bearer auth, same as /stt/config.
 *
 * Routes:
 *   GET    /translation/config                — { vendor, targets } combined read
 *   PUT    /translation/config/vendor         — update vendor row
 *   POST   /translation/config/targets        — create a translation target
 *   PUT    /translation/config/targets/:id    — update a translation target
 *   DELETE /translation/config/targets/:id    — delete a translation target
 */

import { Router } from 'express';
import {
  getTranslationVendorConfig, setTranslationVendorConfig,
  getTranslationTargets, createTranslationTarget, updateTranslationTarget, deleteTranslationTarget,
} from '../db/translation-config.js';

/**
 * @param {import('express').RequestHandler} auth  Session JWT Bearer middleware
 * @param {import('better-sqlite3').Database} db
 * @returns {import('express').Router}
 */
export function createTranslationRouter(auth, db) {
  const router = Router();

  router.get('/config', auth, (req, res) => {
    const apiKey = req.session.apiKey;
    res.json({
      vendor:  getTranslationVendorConfig(db, apiKey),
      targets: getTranslationTargets(db, apiKey),
    });
  });

  router.put('/config/vendor', auth, (req, res) => {
    const { vendor, vendorApiKey, libreUrl, libreKey, showOriginal } = req.body || {};
    const result = setTranslationVendorConfig(db, req.session.apiKey, { vendor, vendorApiKey, libreUrl, libreKey, showOriginal });
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.json({ ok: true, vendor: result.config });
  });

  router.post('/config/targets', auth, (req, res) => {
    const { id, enabled, lang, target, format, captionTargetId, showOriginal } = req.body || {};
    const result = createTranslationTarget(db, req.session.apiKey, { id, enabled, lang, target, format, captionTargetId, showOriginal });
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.status(201).json({ ok: true, target: result.target });
  });

  router.put('/config/targets/:id', auth, (req, res) => {
    const { enabled, lang, target, format, captionTargetId, showOriginal } = req.body || {};
    const result = updateTranslationTarget(db, req.session.apiKey, req.params.id, { enabled, lang, target, format, captionTargetId, showOriginal });
    if (!result.ok) return res.status(result.status || 400).json({ error: result.error });
    res.json({ ok: true, target: result.target });
  });

  router.delete('/config/targets/:id', auth, (req, res) => {
    const deleted = deleteTranslationTarget(db, req.session.apiKey, req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Translation target not found' });
    res.json({ ok: true });
  });

  return router;
}
