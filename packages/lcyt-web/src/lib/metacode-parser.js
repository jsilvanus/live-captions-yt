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
    normalized = normalized.slice(2).trim();
  } else if (normalized.startsWith('~')) {
    fuzzy = true;
    normalized = normalized.slice(1).trim();
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
  const currentCodes = {};

  for (let i = 0; i < rawLines.length; i++) {
    const raw = rawLines[i].trim();
    if (!raw) continue;

    // --- Extract cue-def metacodes first (dedicated regex) ---
    CUE_DEF_RE.lastIndex = 0;
    const lineCueDefs = [];
    const afterCueDefStrip = raw.replace(CUE_DEF_RE, (_, name, val) => {
      if (!name) return '';
      try {
        let parsed = val.trim();
        try { parsed = JSON.parse(parsed); } catch {}
        lineCueDefs.push({ name, tree: parsed });
      } catch {}
      return '';
    }).trim();

    // --- Extract cue metacodes first (dedicated regex) ---
    CUE_META_RE.lastIndex = 0;
    let cuePhrase = null;
    let cueMode = null;
    let cueFuzzy = false;
    let cueSemantic = false;
    let cueEvents = false;
    let cueTree = null;
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
    const lineRaw = (cuePhrase != null || apiTriggers != null) ? afterApiStrip : raw;
    if (lineCueDefs.length > 0) {
      for (const def of lineCueDefs) cueDefs.push(def);
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
        currentCodes[key] = BOOLEAN_CODES.includes(key) ? value.toLowerCase() === 'true' : value;
      }
    }

    // Strip all comment metacodes to get the remaining content text
    const contentText = stripAllComments(lineRaw);

    // Build the codes object for this line
    const codes = { ...currentCodes };
    if (lineActions.audioCapture) codes.audioCapture = lineActions.audioCapture;
    if (lineActions.timer != null) codes.timer = lineActions.timer;
    if (lineActions.goto != null) codes.goto = lineActions.goto;
    if (lineActions.fileSwitch != null) codes.fileSwitch = lineActions.fileSwitch;
    if (lineActions.fileSwitchServer != null) codes.fileSwitchServer = lineActions.fileSwitchServer;
    if (cuePhrase) { codes.cue = cuePhrase; codes.cueMode = cueMode; codes.cueFuzzy = cueFuzzy; codes.cueSemantic = cueSemantic; codes.cueEvents = cueEvents; codes.cueTree = cueTree; }
    if (apiTriggers) codes.apiTriggers = apiTriggers;

    // Did the line contain any metacodes markers that were stripped?
    const hadMetacodes = contentText !== lineRaw || cuePhrase != null || apiTriggers != null;

    // Always emit the line — content lines, metadata-only lines, and lines
    // whose comments were stripped all produce entries in the output.
    if (contentText || hadMetacodes) {
      lines.push(contentText);
      lineCodes.push(codes);
      lineNumbers.push(i + 1);
    }
  }

  return { lines, lineCodes, lineNumbers, cueDefs };
}
