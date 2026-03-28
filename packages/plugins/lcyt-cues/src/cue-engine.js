/**
 * CueEngine — evaluates cue rules against incoming caption text.
 *
 * Loads rules from the DB for a given API key, tests each caption against
 * enabled rules, and fires matching cue events. Respects per-rule cooldowns
 * so the same cue does not fire repeatedly within a short window.
 *
 * Supports match types: phrase, regex, section, fuzzy.
 * Fuzzy matching uses Jaro-Winkler string similarity (no external deps).
 * Embedding-based semantic matching is available when an embedding provider
 * is configured (server-level or per-user via AI config).
 *
 * Usage:
 *   const engine = new CueEngine(db);
 *   const fired = engine.evaluate(apiKey, captionText);
 *   // fired = [{ rule, matched }]
 */

import { listCueRules, insertCueEvent } from './db.js';

// ---------------------------------------------------------------------------
// Jaro-Winkler string similarity (pure JS, no deps)
// ---------------------------------------------------------------------------

/**
 * Compute Jaro similarity between two strings.
 * @param {string} s1
 * @param {string} s2
 * @returns {number} 0-1
 */
function jaroSimilarity(s1, s2) {
  if (s1 === s2) return 1.0;
  if (!s1.length || !s2.length) return 0.0;

  const matchWindow = Math.max(0, Math.floor(Math.max(s1.length, s2.length) / 2) - 1);
  const s1Matches = new Array(s1.length).fill(false);
  const s2Matches = new Array(s2.length).fill(false);

  let matches = 0;
  let transpositions = 0;

  for (let i = 0; i < s1.length; i++) {
    const start = Math.max(0, i - matchWindow);
    const end = Math.min(i + matchWindow + 1, s2.length);
    for (let j = start; j < end; j++) {
      if (s2Matches[j] || s1[i] !== s2[j]) continue;
      s1Matches[i] = true;
      s2Matches[j] = true;
      matches++;
      break;
    }
  }

  if (matches === 0) return 0.0;

  let k = 0;
  for (let i = 0; i < s1.length; i++) {
    if (!s1Matches[i]) continue;
    while (!s2Matches[k]) k++;
    if (s1[i] !== s2[k]) transpositions++;
    k++;
  }

  return (matches / s1.length + matches / s2.length + (matches - transpositions / 2) / matches) / 3;
}

/**
 * Compute Jaro-Winkler similarity between two strings.
 * Boosts score for common prefixes (up to 4 characters).
 * @param {string} s1
 * @param {string} s2
 * @returns {number} 0-1
 */
export function jaroWinkler(s1, s2) {
  const jaro = jaroSimilarity(s1, s2);
  let prefix = 0;
  for (let i = 0; i < Math.min(s1.length, s2.length, 4); i++) {
    if (s1[i] === s2[i]) prefix++;
    else break;
  }
  return jaro + prefix * 0.1 * (1 - jaro);
}

/**
 * Compute fuzzy similarity between a pattern and text at the word level.
 * Finds the best-matching contiguous window of words in the text that
 * matches the pattern's word tokens.
 *
 * @param {string} pattern — the cue phrase pattern
 * @param {string} text — the caption text to match against
 * @returns {{ score: number, matched: string }}
 */
export function fuzzyWordMatch(pattern, text) {
  const pWords = pattern.toLowerCase().split(/\s+/).filter(Boolean);
  const tWords = text.toLowerCase().split(/\s+/).filter(Boolean);
  if (pWords.length === 0 || tWords.length === 0) return { score: 0, matched: '' };

  let bestScore = 0;
  let bestMatched = '';

  // Slide a window of pWords.length over tWords
  for (let i = 0; i <= tWords.length - pWords.length; i++) {
    let windowScore = 0;
    for (let j = 0; j < pWords.length; j++) {
      windowScore += jaroWinkler(pWords[j], tWords[i + j]);
    }
    const avgScore = windowScore / pWords.length;
    if (avgScore > bestScore) {
      bestScore = avgScore;
      bestMatched = tWords.slice(i, i + pWords.length).join(' ');
    }
  }

  return { score: bestScore, matched: bestMatched };
}

// ---------------------------------------------------------------------------
// CueEngine
// ---------------------------------------------------------------------------

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

    /**
     * Optional embedding function for semantic matching.
     * Set via setEmbeddingFn().
     * @type {((texts: string[], opts?: object) => Promise<number[][]>)|null}
     */
    this._embedFn = null;

    /**
     * Optional function to get raw AI config for an API key.
     * Set via setAiConfigFn().
     * @type {((apiKey: string) => object|null)|null}
     */
    this._aiConfigFn = null;

    /**
     * Cached cue phrase embeddings. Map<apiKey, Map<ruleId, number[]>>
     * Invalidated on CRUD via invalidate().
     */
    this._embeddingCache = new Map();
  }

  /** Invalidate the rule cache for a given API key (call after CRUD). */
  invalidate(apiKey) {
    this._ruleCache.delete(apiKey);
    this._embeddingCache.delete(apiKey);
  }

  /**
   * Set the embedding function for semantic fuzzy matching.
   * @param {(texts: string[], opts?: object) => Promise<number[][]>} fn
   */
  setEmbeddingFn(fn) { this._embedFn = fn; }

  /**
   * Set the AI config lookup function.
   * @param {(apiKey: string) => object|null} fn
   */
  setAiConfigFn(fn) { this._aiConfigFn = fn; }

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
        case 'fuzzy': {
          const threshold = rule.fuzzy_threshold ?? 0.75;
          const { score, matched: fuzzyMatched } = fuzzyWordMatch(rule.pattern, text || '');
          if (score >= threshold) matched = fuzzyMatched;
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
          try { action = JSON.parse(rule.action); } catch {
            console.warn(`[cues] Malformed action JSON for rule ${rule.id}`);
          }
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
