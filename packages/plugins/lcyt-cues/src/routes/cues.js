/**
 * Cue rules CRUD + events log route.
 *
 * Mounted at /cues in the main server.
 *
 * Routes:
 *   GET    /cues/rules          — list cue rules for the session's API key
 *   POST   /cues/rules          — create a new cue rule
 *   PUT    /cues/rules/:id      — update a cue rule
 *   DELETE /cues/rules/:id      — delete a cue rule
 *   GET    /cues/events         — list recent cue events (rundown log)
 */

import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import logger from 'lcyt/logger';
import {
  listCueRules, getCueRule, insertCueRule, updateCueRule, deleteCueRule,
  getRecentCueEvents,
} from '../db.js';

function isSafeRegex(pattern) {
  if (!pattern) return false;
  if (pattern.length > 200) return false;
  // Reject simple nested quantifier patterns like '(.+)+', '(.*)+', '(.+){2,}'
  const nested = /\((?:[^)]{0,200})[+*{]/.test(pattern) && /\)[+*{]/.test(pattern);
  if (nested) return false;
  return true;
}


/**
 * @param {import('better-sqlite3').Database} db
 * @param {import('express').RequestHandler} auth — JWT Bearer auth middleware
 * @param {import('../cue-engine.js').CueEngine} engine
 * @returns {import('express').Router}
 */
export function createCueRouter(db, auth, engine) {
  const router = Router();

  // ── Rules CRUD ────────────────────────────────────────────────────────────

  /** GET /cues/rules — list all rules for the authenticated session's API key */
  router.get('/rules', auth, (req, res) => {
    const apiKey = req.session?.apiKey;
    if (!apiKey) return res.status(401).json({ error: 'Not authenticated' });
    const rules = listCueRules(db, apiKey);
    // Parse action JSON for the response
    const parsed = rules.map(r => ({
      ...r,
      action: (() => { try { return JSON.parse(r.action); } catch { logger.warn(`[cues] Malformed action JSON for rule ${r.id}`); return {}; } })(),
    }));
    return res.json({ rules: parsed });
  });

  /** POST /cues/rules — create a new cue rule */
  router.post('/rules', auth, (req, res) => {
    const apiKey = req.session?.apiKey;
    if (!apiKey) return res.status(401).json({ error: 'Not authenticated' });

    const { name, match_type, pattern, action, enabled, cooldown_ms, fuzzy_threshold } = req.body || {};
    if (!name || !pattern) {
      return res.status(400).json({ error: 'name and pattern are required' });
    }
    const validTypes = ['phrase', 'regex', 'section', 'fuzzy'];
    if (match_type && !validTypes.includes(match_type)) {
      return res.status(400).json({ error: `match_type must be one of: ${validTypes.join(', ')}` });
    }

    // Validate regex pattern if match_type is regex
    if (match_type === 'regex') {
      if (!isSafeRegex(pattern)) return res.status(400).json({ error: 'Invalid or unsafe regex pattern' });
      try { new RegExp(pattern); } catch {
        return res.status(400).json({ error: 'Invalid regex pattern' });
      }
    }

    // Validate fuzzy_threshold
    if (fuzzy_threshold !== undefined) {
      const t = parseFloat(fuzzy_threshold);
      if (isNaN(t) || t < 0 || t > 1) {
        return res.status(400).json({ error: 'fuzzy_threshold must be between 0 and 1' });
      }
    }

    const id = randomUUID();
    insertCueRule(db, {
      id,
      api_key: apiKey,
      name,
      match_type: match_type || 'phrase',
      pattern,
      action: action || {},
      enabled: enabled !== undefined ? (enabled ? 1 : 0) : 1,
      cooldown_ms: cooldown_ms || 0,
      fuzzy_threshold: fuzzy_threshold ?? 0.75,
    });

    engine.invalidate(apiKey);
    return res.status(201).json({ id, ok: true });
  });

  /** PUT /cues/rules/:id — update a cue rule */
  router.put('/rules/:id', auth, (req, res) => {
    const apiKey = req.session?.apiKey;
    if (!apiKey) return res.status(401).json({ error: 'Not authenticated' });

    const rule = getCueRule(db, req.params.id);
    if (!rule) return res.status(404).json({ error: 'Rule not found' });
    if (rule.api_key !== apiKey) return res.status(403).json({ error: 'Forbidden' });

    const { name, match_type, pattern, action, enabled, cooldown_ms, fuzzy_threshold } = req.body || {};

    // Validate regex pattern if the rule is (or will remain) a regex rule
    const isRegexRule = match_type === 'regex' || (!match_type && rule.match_type === 'regex');
    if (isRegexRule && pattern) {
      if (!isSafeRegex(pattern)) return res.status(400).json({ error: 'Invalid or unsafe regex pattern' });
      try { new RegExp(pattern); } catch {
        return res.status(400).json({ error: 'Invalid regex pattern' });
      }
    }

    // Validate fuzzy_threshold
    if (fuzzy_threshold !== undefined) {
      const t = parseFloat(fuzzy_threshold);
      if (isNaN(t) || t < 0 || t > 1) {
        return res.status(400).json({ error: 'fuzzy_threshold must be between 0 and 1' });
      }
    }

    updateCueRule(db, req.params.id, {
      name, match_type, pattern, action,
      enabled: enabled !== undefined ? (enabled ? 1 : 0) : undefined,
      cooldown_ms,
      fuzzy_threshold,
    });

    engine.invalidate(apiKey);
    return res.json({ ok: true });
  });

  /** DELETE /cues/rules/:id — delete a cue rule */
  router.delete('/rules/:id', auth, (req, res) => {
    const apiKey = req.session?.apiKey;
    if (!apiKey) return res.status(401).json({ error: 'Not authenticated' });

    const rule = getCueRule(db, req.params.id);
    if (!rule) return res.status(404).json({ error: 'Rule not found' });
    if (rule.api_key !== apiKey) return res.status(403).json({ error: 'Forbidden' });

    deleteCueRule(db, req.params.id);
    engine.invalidate(apiKey);
    return res.json({ ok: true });
  });

  // ── Events log ────────────────────────────────────────────────────────────

  /** GET /cues/events — list recent cue events (rundown) */
  router.get('/events', auth, (req, res) => {
    const apiKey = req.session?.apiKey;
    if (!apiKey) return res.status(401).json({ error: 'Not authenticated' });
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const events = getRecentCueEvents(db, apiKey, limit);
    // Parse action JSON for the response
    const parsed = events.map(e => ({
      ...e,
      action: (() => { try { return JSON.parse(e.action); } catch { logger.warn(`[cues] Malformed action JSON for event ${e.id}`); return {}; } })(),
    }));
    return res.json({ events: parsed });
  });

  return router;
}
