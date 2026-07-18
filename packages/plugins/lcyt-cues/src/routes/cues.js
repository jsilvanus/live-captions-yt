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
 *   GET    /cues/defs           — list named conditions (Phase 9)
 *   POST   /cues/defs           — create a named condition
 *   PUT    /cues/defs/:id       — update a named condition
 *   DELETE /cues/defs/:id       — delete a named condition
 */

import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import logger from 'lcyt/logger';
import {
  listCueRules, getCueRule, insertCueRule, updateCueRule, deleteCueRule,
  getRecentCueEvents,
  listNamedConditions, getNamedCondition, getNamedConditionByName,
  insertNamedCondition, updateNamedCondition, deleteNamedCondition,
} from '../db.js';

function isSafeRegex(pattern) {
  if (!pattern) return false;
  if (pattern.length > 200) return false;
  // Reject simple nested quantifier patterns like '(.+)+', '(.*)+', '(.+){2,}'
  const nested = /\((?:[^)]{0,200})[+*{]/.test(pattern) && /\)[+*{]/.test(pattern);
  if (nested) return false;
  return true;
}

const VALID_MATCH_TYPES = ['phrase', 'regex', 'section', 'fuzzy', 'semantic', 'event_cue', 'music_start', 'music_stop', 'silence', 'composite', 'track'];

// Match types that require a non-empty `pattern` (composite rules carry
// their condition entirely in `condition_tree` instead).
const PATTERN_REQUIRED_MATCH_TYPES = ['regex', 'phrase', 'section', 'fuzzy', 'semantic', 'event_cue', 'silence', 'track'];

// ---------------------------------------------------------------------------
// Condition-tree validation (Phase 9 — shared by /cues/rules composite rules
// and /cues/defs named conditions)
// ---------------------------------------------------------------------------

const LEAF_MATCH_TYPES = new Set(['phrase', 'exact', 'regex', 'fuzzy', 'semantic', 'section', 'context', 'track', 'event', 'event_cue']);
const GROUP_OPS = new Set(['and', 'or', 'not']);

function isLeafNode(node) {
  if (!node || typeof node !== 'object') return false;
  if (node.type === 'ref' || node.ref) return false;
  if (node.type === 'match') return true;
  return Boolean(node.matchType || node.match_type || node.pattern !== undefined || node.value !== undefined || node.text !== undefined || node.path || node.key);
}

/** Validate a condition-tree node. Returns an error string, or null if valid. */
function validateConditionNode(node) {
  if (node === undefined || node === null) return 'condition node is required';
  if (typeof node === 'string') return node.length ? null : 'ref name must not be empty';
  if (typeof node !== 'object' || Array.isArray(node)) return 'condition node must be an object or a ref name string';

  if (node.type === 'ref' || node.ref) {
    const name = node.name || node.ref;
    if (!name || typeof name !== 'string') return 'ref node requires a "name" string';
    return null;
  }

  if (isLeafNode(node)) {
    const matchType = node.matchType || node.match_type || (node.type !== 'match' ? node.type : undefined) || 'phrase';
    if (!LEAF_MATCH_TYPES.has(matchType)) return `unknown leaf match type "${matchType}"`;
    return null;
  }

  const op = node.op || node.type;
  if (!GROUP_OPS.has(op)) return `unknown condition group op "${op}"`;
  const items = Array.isArray(node.children) ? node.children : Array.isArray(node.conditions) ? node.conditions : [];
  if (op === 'not' && items.length !== 1) return '"not" requires exactly one child';
  if (op !== 'not' && items.length === 0) return `"${op}" requires at least one child`;
  for (const child of items) {
    const err = validateConditionNode(child);
    if (err) return err;
  }
  return null;
}

/** Collect every ref/name target reachable from a condition-tree node. */
function collectRefNames(node, out = new Set()) {
  if (node == null) return out;
  if (typeof node === 'string') {
    out.add(node);
    return out;
  }
  if (typeof node !== 'object') return out;
  if (node.type === 'ref' || node.ref) {
    const name = node.name || node.ref;
    if (name) out.add(name);
    return out;
  }
  const items = Array.isArray(node.children) ? node.children : Array.isArray(node.conditions) ? node.conditions : [];
  for (const child of items) collectRefNames(child, out);
  return out;
}

/**
 * Detect whether `startName`'s tree (transitively, via `allDefs`) references
 * itself. `allDefs` must already include `startName -> tree` (the candidate
 * write being validated) alongside every other existing named condition.
 */
function detectCycle(startName, allDefs) {
  const visited = new Set();
  function visit(name) {
    if (visited.has(name)) return false;
    visited.add(name);
    const tree = allDefs.get(name);
    if (!tree) return false;
    for (const ref of collectRefNames(tree)) {
      if (ref === startName) return true;
      if (visit(ref)) return true;
    }
    return false;
  }
  return visit(startName);
}

/** True if any leaf in the tree is a `track:` leaf (used to pick a sane cooldown default). */
function treeContainsTrackLeaf(node) {
  if (!node || typeof node !== 'object') return false;
  if (node.type === 'ref' || node.ref) return false;
  const matchType = node.matchType || node.match_type || (node.type !== 'match' ? node.type : undefined);
  if (matchType === 'track') return true;
  const items = Array.isArray(node.children) ? node.children : Array.isArray(node.conditions) ? node.conditions : [];
  return items.some(treeContainsTrackLeaf);
}

/**
 * `track` rules (and composite rules with a `track:` leaf) fire on every
 * tracker state update — at fps30 that's far more often than caption
 * arrival, so unlike every other match type (default 0), these default to a
 * non-zero cooldown unless the caller explicitly set one.
 */
function defaultCooldownFor(matchType, conditionTree) {
  if (matchType === 'track') return 1000;
  if (matchType === 'composite' && treeContainsTrackLeaf(conditionTree)) return 1000;
  return 0;
}

function safeParseJSON(value, fallback) {
  if (value == null) return fallback;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function normalizeInlineCue(rawCue, index, apiKey) {
  const hasCompositeTree = rawCue?.tree || rawCue?.condition || rawCue?.conditionTree || rawCue?.definition;
  const matchType = rawCue?.match_type || rawCue?.matchType || (rawCue?.semantic ? 'semantic' : rawCue?.events ? 'event_cue' : hasCompositeTree ? 'composite' : 'phrase');
  const pattern = rawCue?.pattern ?? rawCue?.phrase ?? rawCue?.description ?? rawCue?.value ?? '';
  return {
    ...rawCue,
    id: rawCue?.id || `inline:${apiKey}:${index}:${pattern || 'cue'}`,
    name: rawCue?.name || rawCue?.label || pattern || `inline-cue-${index + 1}`,
    match_type: matchType,
    pattern,
    action: rawCue?.action ?? {},
    enabled: rawCue?.enabled !== false,
    cooldown_ms: rawCue?.cooldown_ms ?? rawCue?.cooldownMs ?? 0,
    fuzzy_threshold: rawCue?.fuzzy_threshold ?? rawCue?.fuzzyThreshold ?? 0.75,
    source: 'inline',
    fileName: rawCue?.fileName ?? rawCue?.file_name ?? null,
    fileId: rawCue?.fileId ?? rawCue?.file_id ?? null,
    line: rawCue?.line ?? null,
    tree: rawCue?.tree ?? rawCue?.condition ?? rawCue?.conditionTree ?? rawCue?.definition ?? null,
    cueDef: rawCue?.cueDef ?? rawCue?.definitionName ?? rawCue?.definition ?? null,
    condition: rawCue?.condition ?? rawCue?.tree ?? null,
  };
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {import('express').RequestHandler} auth — JWT Bearer auth middleware
 * @param {import('../cue-engine.js').CueEngine} engine
 * @returns {import('express').Router}
 */
export function createCueRouter(db, auth, engine) {
  const router = Router();

  // ── Inline sync ────────────────────────────────────────────────────────

  /** POST /cues/inline — replace the active inline cue snapshot for the session */
  router.post('/inline', auth, (req, res) => {
    const apiKey = req.session?.apiKey;
    if (!apiKey) return res.status(401).json({ error: 'Not authenticated' });

    const body = req.body || {};
    const cues = Array.isArray(body.cues) ? body.cues : [];
    if (body.cues !== undefined && !Array.isArray(body.cues)) {
      return res.status(400).json({ error: 'cues must be an array' });
    }

    const normalized = cues.map((cue, index) => normalizeInlineCue(cue, index, apiKey));
    engine.setInlineSnapshot(apiKey, {
      cues: normalized,
      cueDefs: body.cueDefs || body.definitions || body.cueDefinitions || {},
      fileName: body.fileName || body.file_name || null,
      fileId: body.fileId || body.file_id || null,
    });

    return res.json({ ok: true, count: normalized.length });
  });

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
    res.set('Cache-Control', 'private, max-age=30, stale-while-revalidate=60');
    return res.json({ rules: parsed });
  });

  /** POST /cues/rules — create a new cue rule */
  router.post('/rules', auth, (req, res) => {
    const apiKey = req.session?.apiKey;
    if (!apiKey) return res.status(401).json({ error: 'Not authenticated' });

    const { name, match_type, pattern, action, enabled, cooldown_ms, fuzzy_threshold, condition_tree } = req.body || {};
    const resolvedMatchType = match_type || 'phrase';
    if (!name) {
      return res.status(400).json({ error: 'name is required' });
    }
    if (!VALID_MATCH_TYPES.includes(resolvedMatchType)) {
      return res.status(400).json({ error: `match_type must be one of: ${VALID_MATCH_TYPES.join(', ')}` });
    }
    if (PATTERN_REQUIRED_MATCH_TYPES.includes(resolvedMatchType) && (pattern === undefined || pattern === null || pattern === '')) {
      return res.status(400).json({ error: 'pattern is required' });
    }
    if (resolvedMatchType === 'composite') {
      const treeError = validateConditionNode(condition_tree);
      if (treeError) return res.status(400).json({ error: `condition_tree: ${treeError}` });
    }

    // Validate regex pattern if match_type is regex
    if (resolvedMatchType === 'regex') {
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
      match_type: resolvedMatchType,
      pattern: pattern ?? '',
      action: action || {},
      enabled: enabled !== undefined ? (enabled ? 1 : 0) : 1,
      cooldown_ms: cooldown_ms !== undefined && cooldown_ms !== null ? cooldown_ms : defaultCooldownFor(resolvedMatchType, condition_tree),
      fuzzy_threshold: fuzzy_threshold ?? 0.75,
      condition_tree: resolvedMatchType === 'composite' ? condition_tree : undefined,
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

    const { name, match_type, pattern, action, enabled, cooldown_ms, fuzzy_threshold, condition_tree } = req.body || {};
    const resolvedMatchType = match_type || rule.match_type || 'phrase';

    if (!VALID_MATCH_TYPES.includes(resolvedMatchType)) {
      return res.status(400).json({ error: `match_type must be one of: ${VALID_MATCH_TYPES.join(', ')}` });
    }

    if (PATTERN_REQUIRED_MATCH_TYPES.includes(resolvedMatchType) && (pattern === undefined || pattern === null || pattern === '')) {
      return res.status(400).json({ error: 'pattern is required' });
    }
    if (resolvedMatchType === 'composite' && condition_tree !== undefined) {
      const treeError = validateConditionNode(condition_tree);
      if (treeError) return res.status(400).json({ error: `condition_tree: ${treeError}` });
    }

    // Validate regex pattern if the rule is (or will remain) a regex rule
    const isRegexRule = resolvedMatchType === 'regex';
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

    // Only apply the track/composite-with-track cooldown default when the rule
    // is newly becoming that type and no explicit cooldown was given — never
    // clobber an existing custom cooldown on an unrelated field update.
    let resolvedCooldown = cooldown_ms;
    if (resolvedCooldown === undefined && match_type && match_type !== rule.match_type) {
      const defaultCooldown = defaultCooldownFor(resolvedMatchType, condition_tree ?? safeParseJSON(rule.condition_tree, null));
      if (defaultCooldown > 0) resolvedCooldown = defaultCooldown;
    }

    updateCueRule(db, req.params.id, {
      name, match_type, pattern, action,
      enabled: enabled !== undefined ? (enabled ? 1 : 0) : undefined,
      cooldown_ms: resolvedCooldown,
      fuzzy_threshold,
      condition_tree,
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

  // ── Named conditions CRUD (Phase 9) ────────────────────────────────────────

  /** GET /cues/defs — list named conditions for the authenticated session's API key */
  router.get('/defs', auth, (req, res) => {
    const apiKey = req.session?.apiKey;
    if (!apiKey) return res.status(401).json({ error: 'Not authenticated' });
    const defs = listNamedConditions(db, apiKey).map(d => ({
      ...d,
      condition_tree: safeParseJSON(d.condition_tree, null),
    }));
    res.set('Cache-Control', 'private, max-age=30, stale-while-revalidate=60');
    return res.json({ defs });
  });

  /** POST /cues/defs — create a new named condition */
  router.post('/defs', auth, (req, res) => {
    const apiKey = req.session?.apiKey;
    if (!apiKey) return res.status(401).json({ error: 'Not authenticated' });

    const { name, condition_tree, source } = req.body || {};
    if (!name || typeof name !== 'string') {
      return res.status(400).json({ error: 'name is required' });
    }
    if (getNamedConditionByName(db, apiKey, name)) {
      return res.status(409).json({ error: `A named condition "${name}" already exists` });
    }
    const treeError = validateConditionNode(condition_tree);
    if (treeError) return res.status(400).json({ error: `condition_tree: ${treeError}` });

    const allDefs = new Map(listNamedConditions(db, apiKey).map(d => [d.name, safeParseJSON(d.condition_tree, null)]));
    allDefs.set(name, condition_tree);
    if (detectCycle(name, allDefs)) {
      return res.status(400).json({ error: `Condition "${name}" would create a reference cycle` });
    }

    const id = randomUUID();
    insertNamedCondition(db, {
      id,
      api_key: apiKey,
      name,
      condition_tree,
      source: source === 'inline' ? 'inline' : 'api',
    });

    engine.invalidate(apiKey);
    return res.status(201).json({ id, ok: true });
  });

  /** PUT /cues/defs/:id — update a named condition */
  router.put('/defs/:id', auth, (req, res) => {
    const apiKey = req.session?.apiKey;
    if (!apiKey) return res.status(401).json({ error: 'Not authenticated' });

    const existing = getNamedCondition(db, req.params.id);
    if (!existing) return res.status(404).json({ error: 'Named condition not found' });
    if (existing.api_key !== apiKey) return res.status(403).json({ error: 'Forbidden' });

    const { name, condition_tree, source } = req.body || {};
    const resolvedName = name || existing.name;

    if (condition_tree !== undefined) {
      const treeError = validateConditionNode(condition_tree);
      if (treeError) return res.status(400).json({ error: `condition_tree: ${treeError}` });
    }
    if (name && name !== existing.name) {
      const dupe = getNamedConditionByName(db, apiKey, name);
      if (dupe && dupe.id !== existing.id) {
        return res.status(409).json({ error: `A named condition "${name}" already exists` });
      }
    }

    const treeForCycleCheck = condition_tree !== undefined ? condition_tree : safeParseJSON(existing.condition_tree, null);
    const allDefs = new Map(
      listNamedConditions(db, apiKey)
        .filter(d => d.id !== existing.id)
        .map(d => [d.name, safeParseJSON(d.condition_tree, null)])
    );
    allDefs.set(resolvedName, treeForCycleCheck);
    if (detectCycle(resolvedName, allDefs)) {
      return res.status(400).json({ error: `Condition "${resolvedName}" would create a reference cycle` });
    }

    updateNamedCondition(db, req.params.id, { name, condition_tree, source });
    engine.invalidate(apiKey);
    return res.json({ ok: true });
  });

  /** DELETE /cues/defs/:id — delete a named condition */
  router.delete('/defs/:id', auth, (req, res) => {
    const apiKey = req.session?.apiKey;
    if (!apiKey) return res.status(401).json({ error: 'Not authenticated' });

    const existing = getNamedCondition(db, req.params.id);
    if (!existing) return res.status(404).json({ error: 'Named condition not found' });
    if (existing.api_key !== apiKey) return res.status(403).json({ error: 'Forbidden' });

    deleteNamedCondition(db, req.params.id);
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
    res.set('Cache-Control', 'private, max-age=15');
    return res.json({ events: parsed });
  });

  return router;
}
