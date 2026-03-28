/**
 * CueEngine — evaluates cue rules against incoming caption text.
 *
 * Loads rules from the DB for a given API key, tests each caption against
 * enabled rules, and fires matching cue events. Respects per-rule cooldowns
 * so the same cue does not fire repeatedly within a short window.
 *
 * Usage:
 *   const engine = new CueEngine(db);
 *   const fired = engine.evaluate(apiKey, captionText);
 *   // fired = [{ rule, matched }]
 */

import { listCueRules, insertCueEvent } from './db.js';

export class CueEngine {
  /**
   * @param {import('better-sqlite3').Database} db
   */
  constructor(db) {
    /** @type {import('better-sqlite3').Database} */
    this._db = db;

    /**
     * Per-rule last-fired timestamps for cooldown enforcement.
     * Map<ruleId, number (epoch ms)>
     */
    this._lastFired = new Map();

    /** Per-API-key cached rule list. Invalidated on CRUD. Map<apiKey, Array> */
    this._ruleCache = new Map();
  }

  /** Invalidate the rule cache for a given API key (call after CRUD). */
  invalidate(apiKey) {
    this._ruleCache.delete(apiKey);
  }

  /**
   * Load (and cache) enabled rules for an API key.
   * @param {string} apiKey
   * @returns {Array<object>}
   */
  _loadRules(apiKey) {
    if (this._ruleCache.has(apiKey)) return this._ruleCache.get(apiKey);
    const rules = listCueRules(this._db, apiKey).filter(r => r.enabled);
    // Pre-compile regex patterns once
    for (const rule of rules) {
      if (rule.match_type === 'regex') {
        try {
          rule._compiledRe = new RegExp(rule.pattern, 'i');
        } catch {
          rule._compiledRe = null;
        }
      }
    }
    this._ruleCache.set(apiKey, rules);
    return rules;
  }

  /**
   * Evaluate all enabled rules against a caption text string.
   *
   * @param {string} apiKey
   * @param {string} text — the caption text (already stripped of other metacodes)
   * @param {object} [codes] — current persistent codes (section, speaker, etc.)
   * @returns {Array<{ rule: object, matched: string }>} — list of fired rules
   */
  evaluate(apiKey, text, codes = {}) {
    if (!text && !codes) return [];
    const rules = this._loadRules(apiKey);
    const now = Date.now();
    const fired = [];

    for (const rule of rules) {
      // Cooldown check
      if (rule.cooldown_ms > 0) {
        const last = this._lastFired.get(rule.id);
        if (last && (now - last) < rule.cooldown_ms) continue;
      }

      let matched = null;

      switch (rule.match_type) {
        case 'phrase': {
          const idx = (text || '').toLowerCase().indexOf(rule.pattern.toLowerCase());
          if (idx >= 0) matched = rule.pattern;
          break;
        }
        case 'regex': {
          if (rule._compiledRe) {
            const m = rule._compiledRe.exec(text || '');
            if (m) matched = m[0];
          }
          break;
        }
        case 'section': {
          if (codes.section && codes.section.toLowerCase() === rule.pattern.toLowerCase()) {
            matched = codes.section;
          }
          break;
        }
        default:
          break;
      }

      if (matched !== null) {
        this._lastFired.set(rule.id, now);
        fired.push({ rule, matched });

        // Persist the cue event
        try {
          let action = {};
          try { action = JSON.parse(rule.action); } catch { /* ignore */ }
          insertCueEvent(this._db, apiKey, {
            rule_id: rule.id,
            rule_name: rule.name,
            matched,
            action,
          });
        } catch (err) {
          console.warn('[cues] Failed to insert cue_event:', err?.message);
        }
      }
    }

    return fired;
  }
}
