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
import logger from 'lcyt/logger';

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

function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const av = Number(a[i]) || 0;
    const bv = Number(b[i]) || 0;
    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
  }
  if (!normA || !normB) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function getValueAtPath(obj, path) {
  if (!obj || !path) return undefined;
  const parts = String(path).split('.').filter(Boolean);
  let current = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = current[part];
  }
  return current;
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
     * Optional function to evaluate event cues via the AI agent.
     * Set via setAgentEvaluateFn().
     * @type {((apiKey: string, description: string, opts?: object) => Promise<{ matched: boolean, confidence: number, reasoning: string }>)|null}
     */
    this._agentEvaluateFn = null;

    /**
     * Cached cue phrase embeddings. Map<apiKey, Map<ruleId, number[]>>
     * Invalidated on CRUD via invalidate().
     */
    this._embeddingCache = new Map();

    /**
     * Silence tracking state per API key.
     * Map<apiKey, { silenceStart: number|null, timer: NodeJS.Timeout|null, currentLabel: string }>
     */
    this._silenceState = new Map();

    /**
     * Inline cues synced from the active rundown file.
     * Map<apiKey, { cues: Array<object>, cueDefs: object, fileName: string|null, fileId: string|null }>
     */
    this._inlineState = new Map();
  }

  /** Invalidate the rule cache for a given API key (call after CRUD). */
  invalidate(apiKey) {
    this._ruleCache.delete(apiKey);
    this._embeddingCache.delete(apiKey);
  }

  /** Replace the inline cue snapshot for an API key. */
  setInlineSnapshot(apiKey, snapshot = {}) {
    const cues = Array.isArray(snapshot.cues) ? snapshot.cues : [];
    const entry = {
      cues: cues.map((cue, index) => ({
        ...cue,
        id: cue.id || `inline:${apiKey}:${cue.line ?? index}:${cue.phrase || cue.pattern || cue.description || cue.name || 'cue'}`,
        name: cue.name || cue.label || cue.phrase || cue.pattern || cue.description || `inline-cue-${index + 1}`,
        match_type: cue.match_type || cue.matchType || (cue.semantic ? 'semantic' : cue.events ? 'event_cue' : 'phrase'),
        pattern: cue.pattern || cue.phrase || cue.description || cue.value || '',
        action: cue.action || {},
        enabled: cue.enabled !== false,
        cooldown_ms: cue.cooldown_ms ?? cue.cooldownMs ?? 0,
        fuzzy_threshold: cue.fuzzy_threshold ?? cue.fuzzyThreshold ?? 0.75,
        source: 'inline',
        fileName: cue.fileName ?? snapshot.fileName ?? null,
        fileId: cue.fileId ?? snapshot.fileId ?? null,
        line: cue.line ?? null,
        tree: cue.tree ?? null,
        cueDef: cue.cueDef ?? null,
      })),
      cueDefs: snapshot.cueDefs || snapshot.definitions || {},
      fileName: snapshot.fileName || null,
      fileId: snapshot.fileId || null,
      updatedAt: Date.now(),
    };
    this._inlineState.set(apiKey, entry);
  }

  /** Clear any inline cues for an API key. */
  clearInlineSnapshot(apiKey) {
    this._inlineState.delete(apiKey);
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
   * Set the agent event cue evaluation function.
   * @param {(apiKey: string, description: string, opts?: object) => Promise<{ matched: boolean, confidence: number, reasoning: string }>} fn
   */
  setAgentEvaluateFn(fn) { this._agentEvaluateFn = fn; }

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

  _evaluateLeafCondition(node, ctx = {}) {
    if (!node || typeof node !== 'object') return false;
    const matchType = node.matchType || node.match_type || node.type || 'phrase';
    const pattern = node.pattern ?? node.value ?? node.text ?? '';
    const text = String(ctx.text || '');
    const codes = ctx.codes || {};
    switch (matchType) {
      case 'phrase':
        return text.toLowerCase().includes(String(pattern).toLowerCase());
      case 'regex': {
        try { return new RegExp(String(pattern), 'i').test(text); } catch { return false; }
      }
      case 'fuzzy': {
        const threshold = node.fuzzy_threshold ?? node.threshold ?? 0.75;
        return fuzzyWordMatch(String(pattern), text).score >= threshold;
      }
      case 'section':
        return String(getValueAtPath(codes, node.path || node.key || 'section') || '').toLowerCase() === String(pattern).toLowerCase();
      case 'context': {
        const actual = getValueAtPath(codes, node.path || node.key || '');
        if (actual == null) return false;
        const actualText = String(actual);
        const patternText = String(pattern);
        if (node.fuzzy) {
          const threshold = node.fuzzy_threshold ?? node.threshold ?? 0.75;
          return fuzzyWordMatch(patternText, actualText).score >= threshold;
        }
        if (node.operator === 'contains') return actualText.toLowerCase().includes(patternText.toLowerCase());
        return actualText.toLowerCase() === patternText.toLowerCase();
      }
      default:
        return false;
    }
  }

  _evaluateCompositeCondition(node, ctx = {}, defs = {}) {
    if (!node) return false;
    if (typeof node === 'string') {
      return this._evaluateCompositeCondition(defs[node], ctx, defs);
    }
    if (node.type === 'ref' || node.ref) {
      const name = node.name || node.ref;
      return this._evaluateCompositeCondition(name ? defs[name] : null, ctx, defs);
    }
    if (node.type === 'match' || node.matchType || node.match_type || node.pattern || node.value || node.text || node.path || node.key) {
      return this._evaluateLeafCondition(node, ctx);
    }
    const op = node.op || node.type || 'and';
    const items = Array.isArray(node.children) ? node.children : Array.isArray(node.conditions) ? node.conditions : [];
    switch (op) {
      case 'and':
        return items.every(child => this._evaluateCompositeCondition(child, ctx, defs));
      case 'or':
        return items.some(child => this._evaluateCompositeCondition(child, ctx, defs));
      case 'not': {
        const child = items[0];
        return !this._evaluateCompositeCondition(child, ctx, defs);
      }
      default:
        return false;
    }
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
            logger.warn(`[cues] Malformed action JSON for rule ${rule.id}`);
          }
          insertCueEvent(this._db, apiKey, {
            rule_id: rule.id,
            rule_name: rule.name,
            matched,
            action,
          });
        } catch (err) {
          logger.warn('[cues] Failed to insert cue_event:', err?.message);
        }
      }
    }

    return fired;
  }

  /**
   * Evaluate inline cues synced from the active rundown file.
   *
   * Inline cues are ephemeral and live alongside DB-backed rules, but they are
   * sourced from the current active file rather than the CRUD rule table.
   *
   * @param {string} apiKey
   * @param {string} text — the caption text that triggered evaluation
   * @param {object} [codes] — current persistent codes (unused for now)
   * @param {(results: Array<{ rule: object, matched: string }>) => void} [onFired] — callback for matches
   * @returns {Promise<Array<{ rule: object, matched: string }>>}
   */
  async evaluateInlineCues(apiKey, text, codes = {}, onFired) {
    const snapshot = this._inlineState.get(apiKey) || { cues: [] };
    const rules = (snapshot.cues || []).filter(rule => rule.enabled !== false);
    if (!rules.length) return [];

    const now = Date.now();
    const fired = [];

    for (const rule of rules) {
      if (rule.cooldown_ms > 0) {
        const last = this._lastFired.get(rule.id);
        if (last && (now - last) < rule.cooldown_ms) continue;
      }

      let matched = null;
      try {
        switch (rule.match_type) {
          case 'semantic': {
            const threshold = rule.fuzzy_threshold ?? 0.75;
            if (rule.pattern && text) {
              if (this._embedFn) {
                try {
                  const vectors = await Promise.resolve(this._embedFn([rule.pattern, text], { apiKey, rule }));
                  const first = Array.isArray(vectors) ? vectors[0] : null;
                  const second = Array.isArray(vectors) ? vectors[1] : null;
                  if (first && second) {
                    const similarity = cosineSimilarity(first, second);
                    if (similarity >= threshold) matched = rule.pattern;
                  }
                } catch (err) {
                  logger.warn(`[cues] Inline semantic eval failed for rule ${rule.id}:`, err?.message);
                }
              }
              if (matched === null) {
                const { score } = fuzzyWordMatch(rule.pattern, text || '');
                if (score >= threshold) matched = rule.pattern;
              }
            }
            break;
          }
          case 'event_cue': {
            if (!this._agentEvaluateFn || !rule.pattern) break;
            const TIMEOUT_MS = parseInt(process.env.CUE_EVENT_TIMEOUT_MS || '5000', 10);
            const result = await Promise.race([
              Promise.resolve(this._agentEvaluateFn(apiKey, rule.pattern, { confidenceThreshold: rule.fuzzy_threshold ?? 0.7 })),
              new Promise((_, rej) => setTimeout(() => rej(new Error('event-eval-timeout')), TIMEOUT_MS)),
            ]);
            if (result?.matched) {
              matched = `event_cue:${rule.pattern} (${result.confidence?.toFixed?.(2) ?? '0.00'})`;
            }
            break;
          }
          case 'composite': {
            const snapshot = this._inlineState.get(apiKey) || { cueDefs: {} };
            const defs = snapshot.cueDefs || {};
            const tree = rule.tree || rule.condition || rule.definition || (rule.cueDef ? { type: 'ref', name: rule.cueDef } : null);
            const resolved = this._evaluateCompositeCondition(tree, { text, codes, apiKey, rule }, defs);
            if (resolved) matched = rule.pattern || rule.name || 'composite';
            break;
          }
          default:
            break;
        }
      } catch (err) {
        logger.warn(`[cues] Inline cue evaluation failed for rule ${rule.id}:`, err?.message);
      }

      if (matched !== null) {
        this._lastFired.set(rule.id, now);
        fired.push({ rule, matched });
        try {
          let action = {};
          try { action = JSON.parse(rule.action); } catch {
            logger.warn(`[cues] Malformed action JSON for inline rule ${rule.id}`);
          }
          insertCueEvent(this._db, apiKey, {
            rule_id: rule.id,
            rule_name: rule.name,
            matched,
            action,
          });
        } catch (err) {
          logger.warn('[cues] Failed to insert inline cue_event:', err?.message);
        }
      }
    }

    if (fired.length > 0) {
      onFired?.(fired);
    }

    return fired;
  }

  /**
   * Evaluate event cue rules asynchronously via the AI agent.
   *
   * Event cue rules have match_type 'event_cue'. They describe an event
   * condition in their pattern field and delegate to the AI agent to determine
   * whether the event has occurred based on the current context window.
   *
   * @param {string} apiKey
   * @param {string} text — the caption text that triggered evaluation
   * @param {(results: Array<{ rule: object, matched: string }>) => void} [onFired] — callback for matches
   * @returns {Promise<void>}
   */
  async evaluateEventCues(apiKey, text, onFired) {
    if (!this._agentEvaluateFn) return;
    const rules = this._loadRules(apiKey);
    const now = Date.now();

    for (const rule of rules) {
      if (rule.match_type !== 'event_cue') continue;

      // Cooldown check
      if (rule.cooldown_ms > 0) {
        const last = this._lastFired.get(rule.id);
        if (last && (now - last) < rule.cooldown_ms) continue;
      }

      try {
        const TIMEOUT_MS = parseInt(process.env.CUE_EVENT_TIMEOUT_MS || "5000", 10);
        try {
          const evPromise = this._agentEvaluateFn(apiKey, rule.pattern, { confidenceThreshold: rule.fuzzy_threshold ?? 0.7 });
          const result = await Promise.race([
            evPromise,
            new Promise((_, rej) => setTimeout(() => rej(new Error("event-eval-timeout")), TIMEOUT_MS))
          ]);

        if (result.matched) {
          this._lastFired.set(rule.id, Date.now());
          const matched = `event_cue:${rule.pattern} (${result.confidence.toFixed(2)})`;

          // Persist the cue event
          try {
            let action = {};
            try { action = JSON.parse(rule.action); } catch {
              logger.warn(`[cues] Malformed action JSON for rule ${rule.id}`);
            }
            insertCueEvent(this._db, apiKey, {
              rule_id: rule.id,
              rule_name: rule.name,
              matched,
              action,
            });
          } catch (err) {
            logger.warn('[cues] Failed to insert cue_event:', err?.message);
          }

          onFired?.([{ rule, matched }]);
        }
      } catch (err) {
        logger.warn(`[cues] Event cue evaluation error for rule ${rule.id}:`, err?.message);
      }
    } catch (e) { throw e; }
    }
  }

  /**
   * Evaluate sound-state cue rules against a sound_label event.
   *
   * Supported match types:
   *   - 'music_start' — fires when label transitions TO 'music'
   *   - 'music_stop'  — fires when label transitions FROM 'music' to speech/silence
   *   - 'silence'     — fires when silence has lasted >= `pattern` seconds
   *                     (pattern is the minimum silence duration, e.g. "5")
   *
   * For silence rules: when silence is detected, a timer is started. If silence
   * persists for the specified duration, the rule fires. If the silence is broken
   * (label changes to speech/music), the timer is cancelled.
   *
   * @param {string} apiKey
   * @param {string} label — current sound label ('music', 'speech', 'silence')
   * @param {(results: Array<{ rule: object, matched: string }>) => void} [onFired] — callback for async silence timer results
   * @returns {Array<{ rule: object, matched: string }>} — immediately fired rules (music_start/music_stop)
   */
  evaluateSoundEvent(apiKey, label, onFired) {
    const rules = this._loadRules(apiKey);
    const now = Date.now();
    const fired = [];

    // Get or create silence tracking state for this API key
    let state = this._silenceState.get(apiKey);
    if (!state) {
      state = { silenceStart: null, timer: null, currentLabel: '' };
      this._silenceState.set(apiKey, state);
    }

    const prevLabel = state.currentLabel;
    state.currentLabel = label;

    // Cancel pending silence timer if silence is broken
    if (label !== 'silence' && state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
      state.silenceStart = null;
    }

    for (const rule of rules) {
      // Cooldown check
      if (rule.cooldown_ms > 0) {
        const last = this._lastFired.get(rule.id);
        if (last && (now - last) < rule.cooldown_ms) continue;
      }

      let matched = null;

      switch (rule.match_type) {
        case 'music_start':
          if (label === 'music' && prevLabel !== 'music') {
            matched = 'music_start';
          }
          break;
        case 'music_stop':
          if (label !== 'music' && prevLabel === 'music') {
            matched = 'music_stop';
          }
          break;
        case 'silence': {
          // Only trigger silence timer when silence starts or is ongoing
          if (label === 'silence') {
            const minSeconds = parseFloat(rule.pattern) || 5;
            if (!state.silenceStart) {
              state.silenceStart = now;
            }
            // Set a timer to fire the cue after the minimum silence duration
            if (!state.timer) {
              const ruleRef = rule;
              const remainingMs = Math.max(0, (minSeconds * 1000) - (now - state.silenceStart));
              state.timer = setTimeout(() => {
                state.timer = null;
                // Check if silence is still active
                if (state.currentLabel === 'silence') {
                  this._lastFired.set(ruleRef.id, Date.now());
                  const result = { rule: ruleRef, matched: `silence:${minSeconds}s` };

                  // Persist the cue event
                  try {
                    let action = {};
                    try { action = JSON.parse(ruleRef.action); } catch {
                      logger.warn(`[cues] Malformed action JSON for rule ${ruleRef.id}`);
                    }
                    insertCueEvent(this._db, apiKey, {
                      rule_id: ruleRef.id,
                      rule_name: ruleRef.name,
                      matched: result.matched,
                      action,
                    });
                  } catch (err) {
                    logger.warn('[cues] Failed to insert cue_event:', err?.message);
                  }

                  onFired?.([result]);
                }
              }, remainingMs);
            }
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
          try { action = JSON.parse(rule.action); } catch {
            logger.warn(`[cues] Malformed action JSON for rule ${rule.id}`);
          }
          insertCueEvent(this._db, apiKey, {
            rule_id: rule.id,
            rule_name: rule.name,
            matched,
            action,
          });
        } catch (err) {
          logger.warn('[cues] Failed to insert cue_event:', err?.message);
        }
      }
    }

    return fired;
  }

  /**
   * Clean up all silence timers (call on shutdown).
   */
  clearSilenceTimers() {
    for (const [, state] of this._silenceState) {
      if (state.timer) clearTimeout(state.timer);
    }
    this._silenceState.clear();
  }
}
