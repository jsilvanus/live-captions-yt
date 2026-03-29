/**
 * AI configuration routes — now part of the lcyt-agent plugin.
 *
 * Routes:
 *   GET  /ai/config  — get AI config for the session's API key
 *   PUT  /ai/config  — update AI config
 *   GET  /ai/status  — get server-level AI capability info
 */

import { Router } from 'express';
import { getAiConfig, setAiConfig, VALID_PROVIDERS } from '../ai-config.js';
import { isServerEmbeddingAvailable } from '../embeddings.js';

/**
 * @param {import('better-sqlite3').Database} db
 * @param {import('express').RequestHandler} auth — JWT Bearer auth middleware
 * @returns {import('express').Router}
 */
export function createAiRouter(db, auth) {
  const router = Router();

  /** GET /ai/config — get AI config for the authenticated session's API key */
  router.get('/config', auth, (req, res) => {
    const apiKey = req.session?.apiKey;
    if (!apiKey) return res.status(401).json({ error: 'Not authenticated' });

    const config = getAiConfig(db, apiKey);
    const defaults = {
      embeddingProvider: 'none',
      embeddingModel: '',
      embeddingApiKey: '',
      embeddingApiUrl: '',
      fuzzyThreshold: 0.75,
    };

    res.set('Cache-Control', 'private, max-age=300, stale-while-revalidate=600');
    return res.json({ config: config || defaults });
  });

  /** PUT /ai/config — update AI config */
  router.put('/config', auth, (req, res) => {
    const apiKey = req.session?.apiKey;
    if (!apiKey) return res.status(401).json({ error: 'Not authenticated' });

    const { embeddingProvider, embeddingModel, embeddingApiKey, embeddingApiUrl, fuzzyThreshold } = req.body || {};

    if (embeddingProvider !== undefined && !VALID_PROVIDERS.includes(embeddingProvider)) {
      return res.status(400).json({ error: `embeddingProvider must be one of: ${VALID_PROVIDERS.join(', ')}` });
    }

    if (fuzzyThreshold !== undefined) {
      const t = parseFloat(fuzzyThreshold);
      if (isNaN(t) || t < 0 || t > 1) {
        return res.status(400).json({ error: 'fuzzyThreshold must be between 0 and 1' });
      }
    }

    setAiConfig(db, apiKey, {
      embeddingProvider,
      embeddingModel,
      embeddingApiKey,
      embeddingApiUrl,
      fuzzyThreshold: fuzzyThreshold !== undefined ? parseFloat(fuzzyThreshold) : undefined,
    });

    return res.json({ ok: true });
  });

  /** GET /ai/status — server-level AI capability info (no auth required for feature detection) */
  router.get('/status', (req, res) => {
    res.set('Cache-Control', 'private, max-age=3600, stale-while-revalidate=3600');
    return res.json({
      serverEmbeddingAvailable: isServerEmbeddingAvailable(),
      serverEmbeddingModel: process.env.EMBEDDING_MODEL || 'text-embedding-3-small',
      providers: VALID_PROVIDERS,
    });
  });

  return router;
}
