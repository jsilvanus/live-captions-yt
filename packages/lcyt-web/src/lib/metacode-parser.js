// Metacode-aware file parser extracted from fileUtils.js
// Exports a single pure function: parseFileContent(rawText)
//
// ALL metacodes are inline markers — they can appear alongside content text
// and other metacodes on the same line.  They are stripped from the line and
// their key-value pairs are stored in lineCodes.  The remaining non-comment
// text becomes the sendable caption content.
//
// Examples:
//   <!-- section: Prayer --><!-- cue:Amen -->Let us pray.
//     → content "Let us pray.", lineCodes { section: 'Prayer', cue: 'Amen' }
//   <!-- timer: 5 -->
//     → content "", lineCodes { timer: 5 }
//   <!-- timer: 500ms -->  /  <!-- timer: 2m -->
//     → timer accepts explicit ms/s/m units (bare number = seconds), shared
//       with the `=>` TTL vocabulary via parseDuration().

import { RESERVED_METACODES, BOOLEAN_CODES } from './metacode-registry.js';
import { parseValueTtl } from './metacode-ttl.js';
import { parseActionItems } from './metacode-actions.js';
import { parseVarBlockMarker } from './metacode-varblocks.js';
const MULTI_META_RE = /<!--\s*([a-z][a-z0-9-]*(?:\[[^\]]*\])?)\s*:\s*([\s\S]*?)\s*-->/gi;
const CUE_DEF_RE = /<!--\s*cue-def\s*:\s*([a-z0-9_-]+)\s*:\s*([\s\S]*?)\s*-->/gi;
const STANZA_OPEN_RE = /^<!--\s*stanza\s*$/i;
const STANZA_INLINE_RE = /^<!--\s*stanza\s*:\s*([\s\S]*?)\s*-->$/i;
const EMPTY_SEND_RE = /^_(?:\s+(.+))?$/;

// Cue metacodes use a dedicated regex so the phrase value is captured
// separately from other metacode key-value pairs.
// Supports optional modifier asterisks: cue: (next), cue*: (skip), cue**: (any)
// Supports optional tilde for fuzzy matching: cue~: (fuzzy), cue*~: (skip+fuzzy)
// Supports bracket modifier: cue[semantic]: (embedding-based), cue[events]: (AI event)
const CUE_META_RE = /<!--\s*cue(\*{0,2})(~?)(\[(?:semantic|events)\])?\s*:\s*([\s\S]*?)\s*-->/gi;

// API Connector trigger metacodes — three tiers (see docs/plans/plan_api_connectors_variables.md §1.2):
//   <!-- !api:slug.slug -->   pointer tier  (fires on pointer arrival, fire-and-forget)
//   <!-- api:slug.slug -->    send tier     (fires at send, async, non-blocking)
//   <!-- api!:slug.slug -->   prefetch tier (background refresh while pointer is on the line,
//                                            small blocking fallback at send)
// Multiple triggers on one line are comma-separated, e.g. <!-- api!:weather.current,login.token -->.
// A dedicated regex is used (like cue) so a plain "api:" key isn't also picked up by MULTI_META_RE.
const API_TRIGGER_RE = /<!--\s*(!)?api(!)?\s*:\s*([\s\S]*?)\s*-->/gi;

// Named / composite actions (see docs/plans/plan_named_actions.md):
//   <!-- action: @intro | api:cam.preset1 -->   invoke (fires on send)
//   <!-- action-def: intro: audio:start | ... --> define a file-local named action
// Dedicated regexes so `action:`/`action-def:` aren't picked up by MULTI_META_RE.
// action-def is matched first (its `action-def:` prefix would not match ACTION_RE
// anyway, but stripping it first keeps things unambiguous).
const ACTION_DEF_RE = /<!--\s*action-def\s*:\s*([a-z0-9_-]+)\s*:\s*([\s\S]*?)\s*-->/gi;
const ACTION_RE = /<!--\s*action\s*:\s*([\s\S]*?)\s*-->/gi;

/**
 * Strip ALL HTML comment metacodes from a raw line and return the remaining
 * text content.  A generic pass that removes every `<!-- ... -->` block.
 */
function stripAllComments(raw) {
  let result = raw;
  // Loop until no more comment blocks remain (handles nested/overlapping markers)
  while (result.includes('<!--')) {
    const next = result.replace(/<!--[\s\S]*?-->/g, '');
    if (next === result) break; // no match → unclosed comment, stop
    result = next;
  }
  return result.trim();
}

function decodeEscapedNewlines(value) {
  return String(value ?? '').replace(/\\n/g, '\n');
}

function parseStanzaValue(value) {
  const text = decodeEscapedNewlines(value).trim();
  if (!text) return null;
  const lines = text.split(/\n|\|/).map(line => line.trim()).filter(Boolean);
  return lines.length > 0 ? lines.join('\n') : null;
}

function parseCueExpression(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;

  const hasCompositeSyntax = /\|/.test(text);
  const hasKeywordPrefix = /^(?:semantic|events?|fuzzy|exact|section|context|complex):/i.test(text) || text.startsWith('~~') || text.startsWith('~') || text.startsWith('@') || text.startsWith('#');
  if (!hasCompositeSyntax && !hasKeywordPrefix) return null;

  const tokens = [];
  let current = '';
  for (let i = 0; i < text.length; i++) {
    const next2 = text.slice(i, i + 2);
    if (next2 === '|+' || next2 === '|-') {
      if (current.trim()) {
        tokens.push({ type: 'term', value: current.trim() });
        current = '';
      }
      tokens.push({ type: 'op', value: next2 });
      i += 1;
      continue;
    }
    if (text[i] === '|') {
      if (current.trim()) {
        tokens.push({ type: 'term', value: current.trim() });
        current = '';
      }
      tokens.push({ type: 'op', value: '|' });
      continue;
    }
    if (text[i] === '(' || text[i] === ')') {
      if (current.trim()) {
        tokens.push({ type: 'term', value: current.trim() });
        current = '';
      }
      tokens.push({ type: 'paren', value: text[i] });
      continue;
    }
    current += text[i];
  }
  if (current.trim()) {
    tokens.push({ type: 'term', value: current.trim() });
  }

  let index = 0;
  const peek = () => tokens[index];
  const consume = () => tokens[index++];
  const parsePrimary = () => {
    const token = peek();
    if (!token) return null;
    if (token.type === 'paren' && token.value === '(') {
      consume();
      const inner = parseOr();
      if (!peek() || peek().type !== 'paren' || peek().value !== ')') {
        return inner;
      }
      consume();
      return inner;
    }
    if (token.type === 'term') {
      consume();
      const value = token.value.trim();
      if (value.startsWith('@')) {
        const name = value.slice(1).trim();
        return name ? { type: 'ref', name } : null;
      }
      return parseCueLeaf(value);
    }
    return null;
  };
  const parseUnary = () => {
    const token = peek();
    if (token?.type === 'op' && token.value === '|-') {
      consume();
      const child = parseUnary();
      return child ? { op: 'not', children: [child] } : null;
    }
    return parsePrimary();
  };
  const parseAnd = () => {
    let node = parseUnary();
    while (peek()?.type === 'op' && (peek().value === '|+' || peek().value === '|-')) {
      const op = consume().value;
      const right = parseUnary();
      if (!node || !right) break;
      node = op === '|+' ? { op: 'and', children: [node, right] } : { op: 'and', children: [node, { op: 'not', children: [right] }] };
    }
    return node;
  };
  const parseOr = () => {
    let node = parseAnd();
    while (peek()?.type === 'op' && peek().value === '|') {
      consume();
      const right = parseAnd();
      if (!node || !right) break;
      node = { op: 'or', children: [node, right] };
    }
    return node;
  };

  const tree = parseOr();
  if (!tree) return null;
  return tree;
}

function parseCueLeaf(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;

  let normalized = text;
  let semantic = false;
  let events = false;
  let fuzzy = false;

  if (normalized.startsWith('@')) {
    const name = normalized.slice(1).trim();
    if (!name) return null;
    return { type: 'ref', name };
  }

  if (normalized.startsWith('#')) {
    const name = normalized.slice(1).trim();
    if (!name) return null;
    return { type: 'match', matchType: 'event_cue', pattern: name };
  }

  if (normalized.startsWith('~~')) {
    semantic = true;
    // Tolerate both `~~word` and `~~:word` (the multi-line block grammar's
    // "~~: value" leaf marker, which also reaches here via the cue-def:
    // single-line fallback to this same expression parser).
    normalized = normalized.slice(2).replace(/^:/, '').trim();
  } else if (normalized.startsWith('~')) {
    fuzzy = true;
    normalized = normalized.slice(1).replace(/^:/, '').trim();
  }

  const keywordMatch = normalized.match(/^([a-z]+)(?::|\s+)(.*)$/i);
  if (keywordMatch) {
    const keyword = keywordMatch[1].toLowerCase();
    const payload = keywordMatch[2].trim();
    if (!payload) return null;
    switch (keyword) {
      case 'semantic':
        semantic = true;
        normalized = payload;
        break;
      case 'event':
      case 'events':
        events = true;
        normalized = payload;
        break;
      case 'fuzzy':
        fuzzy = true;
        normalized = payload;
        break;
      case 'exact':
      case 'phrase':
        normalized = payload;
        break;
      case 'complex':
        return { type: 'ref', name: payload };
      case 'section':
        return { type: 'match', matchType: 'section', pattern: payload };
      case 'track':
        return { type: 'match', matchType: 'track', pattern: payload };
      case 'regex':
        return { type: 'match', matchType: 'regex', pattern: payload };
      case 'context': {
        const [pathPart, ...patternParts] = payload.split('=');
        const path = pathPart?.trim() || '';
        const rawPattern = patternParts.join('=').trim();
        let fuzzy = false;
        let pattern = rawPattern;
        if (pattern.startsWith('~')) {
          fuzzy = true;
          pattern = pattern.slice(1).trim();
        }
        return { type: 'match', matchType: 'context', path, operator: 'equals', pattern, fuzzy };
      }
      default:
        normalized = payload;
        break;
    }
  }

  return {
    type: 'match',
    matchType: semantic ? 'semantic' : events ? 'event_cue' : fuzzy ? 'fuzzy' : 'phrase',
    pattern: normalized,
  };
}

// ---------------------------------------------------------------------------
// Multi-line composite block grammar (Phase 9, docs/plans/plan_cues.md
// "Composite block grammar") — an alternative, indentation-based authoring
// syntax for the same condition-tree shape parseCueExpression() already
// builds from the compact `|`-pipe syntax. A bare "<!-- cue(*{0,2}):" or
// "<!-- cue-def:name:" open line (nothing else on the line) starts a block;
// body lines are collected stanza-style until a closing "-->" — see
// CUE_BLOCK_OPEN_RE/CUE_DEF_BLOCK_OPEN_RE usage in parseFileContent() below.
// ---------------------------------------------------------------------------

const CUE_BLOCK_OPEN_RE = /^<!--\s*cue(\*{0,2})\s*:\s*$/i;
const CUE_DEF_BLOCK_OPEN_RE = /^<!--\s*cue-def\s*:\s*([a-z0-9_-]+)\s*:\s*$/i;

/** Parse one body line of an indented condition block into a leaf node. */
function parseBlockLeafLine(text) {
  const trimmed = text.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('@')) {
    const name = trimmed.slice(1).trim();
    return name ? { type: 'ref', name } : null;
  }

  let m = trimmed.match(/^~~\s*:\s*(.+)$/);
  if (m) return { type: 'match', matchType: 'semantic', pattern: m[1].trim() };
  m = trimmed.match(/^~\s*:\s*(.+)$/);
  if (m) return { type: 'match', matchType: 'fuzzy', pattern: m[1].trim() };

  m = trimmed.match(/^([a-z_]+)\s*:\s*(.+)$/i);
  if (m) {
    const keyword = m[1].toLowerCase();
    const payload = m[2].trim();
    if (!payload) return null;
    switch (keyword) {
      case 'exact':
      case 'phrase':
        return { type: 'match', matchType: 'phrase', pattern: payload };
      case 'fuzzy':
        return { type: 'match', matchType: 'fuzzy', pattern: payload };
      case 'semantic':
        return { type: 'match', matchType: 'semantic', pattern: payload };
      case 'section':
        return { type: 'match', matchType: 'section', pattern: payload };
      case 'track':
        return { type: 'match', matchType: 'track', pattern: payload };
      case 'regex':
        return { type: 'match', matchType: 'regex', pattern: payload };
      case 'event':
      case 'events':
      case 'event_cue':
        return { type: 'match', matchType: 'event_cue', pattern: payload };
      case 'ref':
        return { type: 'ref', name: payload.replace(/^@/, '') };
      case 'context': {
        const [pathPart, ...patternParts] = payload.split('=');
        const path = pathPart?.trim() || '';
        let pattern = patternParts.join('=').trim();
        let fuzzy = false;
        if (pattern.startsWith('~')) { fuzzy = true; pattern = pattern.slice(1).trim(); }
        return { type: 'match', matchType: 'context', path, operator: 'equals', pattern, fuzzy };
      }
      default:
        // Unknown keyword — treat the whole line as a literal phrase leaf
        // rather than silently dropping the author's condition.
        return { type: 'match', matchType: 'phrase', pattern: trimmed };
    }
  }

  // Bare word/phrase, no keyword prefix at all → implicit exact/phrase leaf
  // (mirrors the compact syntax's "word (bare, no prefix) → exact" rule).
  return { type: 'match', matchType: 'phrase', pattern: trimmed };
}

/**
 * Parse the body of a multi-line composite `cue:`/`cue-def:` block into a
 * condition-tree node, using 2-space indentation for and/or/not nesting.
 * A depth-0 sequence of bare leaf lines (no explicit and:/or:/not: header)
 * is treated as an implicit top-level `or:` — see plan_cues.md's "Composite
 * block grammar" section for the full grammar and examples.
 *
 * @param {string[]} bodyLines — raw (unstripped) lines between the open and
 *   close markers, indentation intact.
 * @returns {object|null} a condition-tree node, or null if the block was empty.
 */
function parseIndentedConditionBlock(bodyLines) {
  const entries = [];
  for (const raw of bodyLines) {
    const text = raw ?? '';
    if (!text.trim()) continue;
    const leading = text.match(/^( *)/)?.[1]?.length ?? 0;
    entries.push({ depth: Math.floor(leading / 2), text: text.trim() });
  }
  if (entries.length === 0) return null;

  const cursor = { i: 0 };
  function parseSiblings(depth) {
    const nodes = [];
    while (cursor.i < entries.length && entries[cursor.i].depth >= depth) {
      const entry = entries[cursor.i];
      if (entry.depth > depth) { cursor.i++; continue; } // orphaned deeper indent — skip defensively
      const groupMatch = entry.text.match(/^(and|or|not)\s*:?\s*$/i);
      if (groupMatch) {
        const op = groupMatch[1].toLowerCase();
        cursor.i++;
        const children = parseSiblings(depth + 1);
        if (children.length > 0) nodes.push({ op, children: op === 'not' ? children.slice(0, 1) : children });
      } else {
        const leaf = parseBlockLeafLine(entry.text);
        cursor.i++;
        if (leaf) nodes.push(leaf);
      }
    }
    return nodes;
  }

  const topNodes = parseSiblings(entries[0].depth);
  if (topNodes.length === 0) return null;
  return topNodes.length === 1 ? topNodes[0] : { op: 'or', children: topNodes };
}

function parseCueValue(rawValue, opts = {}) {
  const raw = String(rawValue ?? '').trim();
  if (!raw) {
    return { cuePhrase: null, cueTree: null, cueMode: opts.stars === '**' ? 'any' : opts.stars === '*' ? 'skip' : 'next', cueFuzzy: opts.tilde === '~', cueSemantic: opts.bracket === '[semantic]', cueEvents: opts.bracket === '[events]' };
  }

  const cueMode = opts.stars === '**' ? 'any' : opts.stars === '*' ? 'skip' : 'next';
  const cueFuzzy = opts.tilde === '~';
  const cueSemantic = opts.bracket === '[semantic]';
  const cueEvents = opts.bracket === '[events]';
  const cueTree = parseCueExpression(raw);
  const cuePhrase = raw;
  return { cuePhrase, cueTree, cueMode, cueFuzzy, cueSemantic, cueEvents };
}

export function parseFileContent(rawText) {
  const rawLines = (rawText ?? '').split('\n');
  const lines = [];
  const lineCodes = [];
  const lineNumbers = [];
  const cueDefs = [];
  const actionDefs = [];
  const currentCodes = {};

  for (let i = 0; i < rawLines.length; i++) {
    let raw = rawLines[i].trim();
    if (!raw) continue;

    // --- Multi-line composite blocks (Phase 9) — a bare open line with
    // nothing after the final colon starts an indented condition-tree block,
    // collected until a closing "-->" (cue-def: requires a bare "-->" line,
    // since a definition isn't attached to any caption line; a composite
    // cue: block's "-->" may carry trailing caption text on the same line,
    // same as the single-line form). Checked first since neither
    // CUE_DEF_RE nor CUE_META_RE below can match an unterminated line.
    const cueDefBlockOpen = raw.match(CUE_DEF_BLOCK_OPEN_RE);
    if (cueDefBlockOpen) {
      const [, defName] = cueDefBlockOpen;
      const bodyLines = [];
      i++;
      while (i < rawLines.length) {
        if (rawLines[i].trim() === '-->') break;
        bodyLines.push(rawLines[i]);
        i++;
      }
      const tree = parseIndentedConditionBlock(bodyLines);
      if (defName && tree) cueDefs.push({ name: defName, tree });
      continue;
    }

    let blockCuePhrase = null;
    let blockCueMode = null;
    let blockCueTree = null;
    const cueBlockOpen = raw.match(CUE_BLOCK_OPEN_RE);
    if (cueBlockOpen) {
      const [, stars] = cueBlockOpen;
      const bodyLines = [];
      let trailer = '';
      i++;
      while (i < rawLines.length) {
        const startTrimmed = rawLines[i].trimStart();
        if (startTrimmed.startsWith('-->')) { trailer = startTrimmed.slice(3); break; }
        bodyLines.push(rawLines[i]);
        i++;
      }
      const tree = parseIndentedConditionBlock(bodyLines);
      if (tree) {
        blockCueTree = tree;
        blockCueMode = stars === '**' ? 'any' : stars === '*' ? 'skip' : 'next';
        blockCuePhrase = bodyLines.map(l => l.trim()).filter(Boolean).join(' ') || '(composite)';
      }
      raw = trailer.trim();
      if (!raw) {
        // No trailing caption content after "-->" — still emit an entry for
        // this composite cue, same as a bare single-line `<!-- cue:phrase -->`.
        if (blockCueTree) {
          lines.push('');
          lineCodes.push({ ...currentCodes, cue: blockCuePhrase, cueMode: blockCueMode, cueFuzzy: false, cueSemantic: false, cueEvents: false, cueTree: blockCueTree });
          lineNumbers.push(i + 1);
        }
        continue;
      }
    }

    // --- Extract cue-def metacodes first (dedicated regex) ---
    CUE_DEF_RE.lastIndex = 0;
    const lineCueDefs = [];
    const afterCueDefStrip = raw.replace(CUE_DEF_RE, (_, name, val) => {
      if (!name) return '';
      try {
        let parsed = val.trim();
        try { parsed = JSON.parse(parsed); } catch { parsed = parseCueExpression(parsed) ?? parsed; }
        lineCueDefs.push({ name, tree: parsed });
      } catch {}
      return '';
    }).trim();

    // --- Extract cue metacodes first (dedicated regex) ---
    CUE_META_RE.lastIndex = 0;
    let cuePhrase = blockCuePhrase;
    let cueMode = blockCueMode;
    let cueFuzzy = false;
    let cueSemantic = false;
    let cueEvents = false;
    let cueTree = blockCueTree;
    const afterCueStrip = afterCueDefStrip.replace(CUE_META_RE, (_, stars, tilde, bracket, val) => {
      const parsed = parseCueValue(val, { stars, tilde, bracket });
      const trimmed = parsed.cuePhrase?.trim();
      if (trimmed && !cuePhrase) {
        cuePhrase = trimmed;
        cueMode = parsed.cueMode;
        cueFuzzy = parsed.cueFuzzy;
        cueSemantic = parsed.cueSemantic;
        cueEvents = parsed.cueEvents;
        cueTree = parsed.cueTree;
      }
      return '';
    }).trim();
    // --- Extract API connector triggers (dedicated regex, one-shot per line) ---
    API_TRIGGER_RE.lastIndex = 0;
    let apiTriggers = null;
    const afterApiStrip = afterCueStrip.replace(API_TRIGGER_RE, (_, pointerMark, prefetchMark, val) => {
      const tier = pointerMark === '!' ? 'pointer' : prefetchMark === '!' ? 'prefetch' : 'send';
      const entries = val.split(',').map((s) => s.trim()).filter(Boolean);
      for (const entry of entries) {
        const dot = entry.indexOf('.');
        if (dot <= 0 || dot === entry.length - 1) continue;
        const connectorSlug = entry.slice(0, dot);
        const requestSlug = entry.slice(dot + 1);
        if (!apiTriggers) apiTriggers = [];
        apiTriggers.push({ connectorSlug, requestSlug, tier });
      }
      return '';
    }).trim();
    // --- Extract named-action definitions (dedicated regex), then invocations ---
    ACTION_DEF_RE.lastIndex = 0;
    const lineActionDefs = [];
    const afterActionDefStrip = afterApiStrip.replace(ACTION_DEF_RE, (_, name, val) => {
      if (name) lineActionDefs.push({ name: name.toLowerCase(), items: parseActionItems(val) });
      return '';
    }).trim();
    ACTION_RE.lastIndex = 0;
    let actions = null;
    const afterActionStrip = afterActionDefStrip.replace(ACTION_RE, (_, val) => {
      const items = parseActionItems(val);
      if (items.length > 0) actions = (actions || []).concat(items);
      return '';
    }).trim();
    const anyDedicated = cuePhrase != null || apiTriggers != null || actions != null || lineActionDefs.length > 0;
    const lineRaw = anyDedicated ? afterActionStrip : raw;
    if (lineCueDefs.length > 0) {
      for (const def of lineCueDefs) cueDefs.push(def);
    }
    if (lineActionDefs.length > 0) {
      for (const def of lineActionDefs) actionDefs.push(def);
    }

    const stanzaInlineMatch = lineRaw.match(STANZA_INLINE_RE);
    if (stanzaInlineMatch) {
      const stanzaValue = parseStanzaValue(stanzaInlineMatch[1]);
      if (stanzaValue) {
        currentCodes.stanza = stanzaValue;
      } else {
        delete currentCodes.stanza;
      }
      continue;
    }

    if (STANZA_OPEN_RE.test(lineRaw)) {
      const stanzaLines = [];
      i++;
      while (i < rawLines.length) {
        const stanzaRaw = rawLines[i].trim();
        if (stanzaRaw === '-->') break;
        if (stanzaRaw) stanzaLines.push(stanzaRaw);
        i++;
      }
      if (stanzaLines.length > 0) {
        currentCodes.stanza = stanzaLines.join('\n');
      } else {
        delete currentCodes.stanza;
      }
      continue;
    }

    const emptySendMatch = lineRaw.match(EMPTY_SEND_RE);
    if (emptySendMatch) {
      const label = emptySendMatch[1]?.trim() || null;
      const codes = { ...currentCodes, emptySend: true, ...(label ? { emptySendLabel: label } : {}) };
      if (cuePhrase) { codes.cue = cuePhrase; codes.cueMode = cueMode; codes.cueFuzzy = cueFuzzy; codes.cueSemantic = cueSemantic; codes.cueEvents = cueEvents; codes.cueTree = cueTree; }
      if (apiTriggers) codes.apiTriggers = apiTriggers;
      if (actions) codes.actions = actions;
      lines.push('');
      lineCodes.push(codes);
      lineNumbers.push(i + 1);
      continue;
    }

    // --- Extract ALL metacode comments inline ---
    // Dispatch each `<!-- key: value -->` through the reserved-name registry:
    // an actionable reserved name fires its `apply()` (one-shot); a dedicated-
    // lexer name (cue/api) was already handled above and is skipped; every other
    // name — reserved persistent or custom — is a plain variable assignment.
    const lineActions = {};
    // Per-line TTL annotations (`=>`) on persistent assignments — tied to *this*
    // assignment, not persisted forward like the value itself.
    const lineCodeTtls = {};

    MULTI_META_RE.lastIndex = 0;
    for (const m of lineRaw.matchAll(MULTI_META_RE)) {
      const key = m[1].toLowerCase();
      const value = m[2].trim();
      const entry = RESERVED_METACODES[key];
      if (entry?.lexer === 'dedicated') continue; // cue/api parsed by their own regex above
      if (entry?.apply) { entry.apply(value, lineActions); continue; }
      // Persistent variable assignment (reserved persistent name or custom key).
      if (value === '') {
        delete currentCodes[key];
      } else {
        const { value: cleanValue, ttl } = parseValueTtl(value);
        currentCodes[key] = BOOLEAN_CODES.includes(key) ? cleanValue.toLowerCase() === 'true' : cleanValue;
        if (ttl) lineCodeTtls[key] = ttl;
      }
    }

    // Strip all comment metacodes to get the remaining content text
    const contentText = stripAllComments(lineRaw);

    // {{name[N]}} / {{name[N*]}} variable-backed text block — block-only: the
    // marker must be this line's *entire* content. Expansion into virtual
    // lines happens later (useFileStore), once a live variable snapshot is
    // available; the parser just tags the marker (docs/plans/plan_live_variables.md §3).
    const varBlock = parseVarBlockMarker(contentText);

    // Build the codes object for this line
    const codes = { ...currentCodes };
    if (varBlock) codes.varBlock = varBlock;
    if (lineActions.audioCapture) codes.audioCapture = lineActions.audioCapture;
    if (lineActions.timer != null) codes.timer = lineActions.timer;
    if (lineActions.goto != null) codes.goto = lineActions.goto;
    if (lineActions.fileSwitch != null) codes.fileSwitch = lineActions.fileSwitch;
    if (lineActions.fileSwitchServer != null) codes.fileSwitchServer = lineActions.fileSwitchServer;
    if (cuePhrase) { codes.cue = cuePhrase; codes.cueMode = cueMode; codes.cueFuzzy = cueFuzzy; codes.cueSemantic = cueSemantic; codes.cueEvents = cueEvents; codes.cueTree = cueTree; }
    if (apiTriggers) codes.apiTriggers = apiTriggers;
    if (actions) codes.actions = actions;
    // Per-line `=>` TTLs for persistent assignments (consumed by the send-time
    // file→variables sync; not a forwarded code — stripped before delivery).
    if (Object.keys(lineCodeTtls).length > 0) codes.codeTtls = lineCodeTtls;

    // Did the line contain any metacodes markers that were stripped?
    const hadMetacodes = contentText !== lineRaw || cuePhrase != null || apiTriggers != null || actions != null;

    // Always emit the line — content lines, metadata-only lines, and lines
    // whose comments were stripped all produce entries in the output.
    if (contentText || hadMetacodes) {
      lines.push(contentText);
      lineCodes.push(codes);
      lineNumbers.push(i + 1);
    }
  }

  return { lines, lineCodes, lineNumbers, cueDefs, actionDefs };
}
