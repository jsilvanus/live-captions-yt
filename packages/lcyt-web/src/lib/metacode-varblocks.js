// {{name[N]}} / {{name[N*]}} — variable-backed text blocks (plan_live_variables.md §3).
//
// Distinct from plain {{name}} insertion (metacode-variables.js): a block
// expands a variable's (possibly long) value into multiple visible,
// navigable, sendable virtual lines, wrapped to at most N characters.
//   {{name[N]}}   soft wrap — break at the closest whitespace before N
//   {{name[N*]}}  hard wrap — slice at exactly N characters, ignoring words
//
// Decided: block-only. The marker must be the *entire* content of its line
// (after other metacodes are stripped) to trigger expansion — used inline
// mixed with other text it is simply left as literal, unresolved text.
//
// The parser (metacode-parser.js) only *detects* the marker and attaches it
// as `lineCodes[i].varBlock` — it has no access to live variable values.
// Expansion into virtual lines happens in useFileStore, given the app's
// current {{ }} snapshot.

const VAR_BLOCK_RE = /^\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\[(\d+)(\*)?\]\s*\}\}$/;

// One-shot codes carried by the block-marker line (timer/goto/api triggers/cue/
// named actions/…) belong to the block as a whole, not to every wrapped
// segment — otherwise each virtual line re-fires them independently as the
// operator advances through. Only the first segment keeps them; persistent
// codes (section, speaker, custom keys, …) are NOT in this list and stay on
// every segment, since they describe ongoing state rather than a one-shot
// trigger.
const ONE_SHOT_CODE_KEYS = [
  'audioCapture', 'timer', 'goto', 'fileSwitch', 'fileSwitchServer',
  'cue', 'cueMode', 'cueFuzzy', 'cueSemantic', 'cueEvents', 'cueTree',
  'apiTriggers', 'actions', 'codeTtls',
];

function stripOneShotCodes(codes) {
  const out = { ...codes };
  for (const key of ONE_SHOT_CODE_KEYS) delete out[key];
  return out;
}

/**
 * Group `previous`'s already-materialized virtual runs by source raw line
 * number, so a reparse can reuse a block verbatim instead of recomputing it.
 * @returns {Map<number, { lines: string[], codes: object[] }>}
 */
function buildFrozenMap(previous) {
  const map = new Map();
  if (!previous) return map;
  const { lines, lineCodes, lineNumbers } = previous;
  let i = 0;
  while (i < lineCodes.length) {
    const raw = lineNumbers[i];
    const name = lineCodes[i]?.virtualBlock;
    if (!lineCodes[i]?.virtual || !name) { i++; continue; }
    const runLines = [];
    const runCodes = [];
    let j = i;
    while (j < lineCodes.length && lineCodes[j]?.virtual && lineCodes[j].virtualBlock === name && lineNumbers[j] === raw) {
      runLines.push(lines[j]);
      runCodes.push(lineCodes[j]);
      j++;
    }
    map.set(raw, { lines: runLines, codes: runCodes });
    i = j;
  }
  return map;
}

/**
 * Does `text` (already trimmed of other metacodes) consist of *only* a
 * {{name[N]}} / {{name[N*]}} marker? Returns the parsed marker or null.
 * @param {string} text
 * @returns {{ name: string, maxLen: number, hard: boolean } | null}
 */
export function parseVarBlockMarker(text) {
  const m = VAR_BLOCK_RE.exec(String(text ?? '').trim());
  if (!m) return null;
  const maxLen = Number(m[2]);
  if (!Number.isFinite(maxLen) || maxLen <= 0) return null;
  return { name: m[1], maxLen, hard: m[3] === '*' };
}

/**
 * Wrap `value` into lines of at most `maxLen` characters.
 *   hard=false (soft): word-wrap, breaking at the closest whitespace before
 *     maxLen (same algorithm as normalizeLines.js); a single word longer than
 *     maxLen is hard-sliced so no line ever exceeds maxLen.
 *   hard=true: slice at exactly maxLen characters, ignoring word boundaries.
 * Always returns at least one (possibly empty) line.
 * @param {*} value
 * @param {number} maxLen
 * @param {boolean} hard
 * @returns {string[]}
 */
export function wrapValue(value, maxLen, hard) {
  const text = value == null ? '' : String(value);
  if (text === '') return [''];

  if (hard) {
    const out = [];
    for (let i = 0; i < text.length; i += maxLen) out.push(text.slice(i, i + maxLen));
    return out;
  }

  const words = text.split(/\s+/).filter((w) => w.length > 0);
  const out = [];
  let current = '';
  for (const word of words) {
    if (current === '') {
      current = word;
    } else if ((current + ' ' + word).length <= maxLen) {
      current += ' ' + word;
    } else {
      out.push(current);
      current = word;
    }
    // A single word longer than maxLen has no whitespace to break at — slice it.
    while (current.length > maxLen) {
      out.push(current.slice(0, maxLen));
      current = current.slice(maxLen);
    }
  }
  if (current) out.push(current);
  return out.length > 0 ? out : [''];
}

/**
 * Expand every `varBlock`-marked entry in a parsed file's parallel arrays
 * into its wrapped virtual lines, using the current {{ }} snapshot.
 *
 * A variable not present in `variablesSnapshot` (never resolved yet) expands
 * to a single "loading…" placeholder line tagged `varBlockPending: true`
 * instead of being materialized — the block is (re-)expanded for real the
 * next time this runs after the variable resolves (see FileContext's
 * reactive re-expand-pending effect). Once a block *has* materialized, it is
 * not reflowed by later variable changes — a fresh expansion only happens on
 * an explicit reparse (raw edit save, file reload).
 *
 * `opts.previous` (the file's currently-displayed { lines, lineCodes,
 * lineNumbers }, same raw text) makes that freeze real rather than
 * incidental: without it, a reparse triggered by a *different*, still-pending
 * block resolving would recompute EVERY block from the live snapshot,
 * silently reflowing an already-materialized sibling block if its own
 * variable had also drifted since it first resolved. With `previous`, any
 * block already materialized at the same source line is reused verbatim —
 * only newly-pending→resolved blocks are (re)computed. Pass `previous` only
 * from the reactive background path (useFileStore's refreshVarBlocks); a
 * user-initiated raw-text save intentionally does a fully fresh expansion.
 *
 * @param {string[]} lines
 * @param {object[]} lineCodes
 * @param {number[]} lineNumbers
 * @param {Record<string,string>} [variablesSnapshot]
 * @param {{ previous?: { lines: string[], lineCodes: object[], lineNumbers: number[] } }} [opts]
 */
export function expandVarBlocks(lines, lineCodes, lineNumbers, variablesSnapshot = {}, opts = {}) {
  const outLines = [];
  const outCodes = [];
  const outNumbers = [];
  const frozen = buildFrozenMap(opts.previous);

  for (let i = 0; i < lines.length; i++) {
    const marker = lineCodes[i]?.varBlock;
    if (!marker) {
      outLines.push(lines[i]);
      outCodes.push(lineCodes[i]);
      outNumbers.push(lineNumbers[i]);
      continue;
    }

    const frozenRun = frozen.get(lineNumbers[i]);
    if (frozenRun && frozenRun.codes[0]?.virtualBlock === marker.name) {
      outLines.push(...frozenRun.lines);
      outCodes.push(...frozenRun.codes);
      for (let k = 0; k < frozenRun.lines.length; k++) outNumbers.push(lineNumbers[i]);
      continue;
    }

    const { varBlock, ...restCodes } = lineCodes[i];
    const resolved = Object.prototype.hasOwnProperty.call(variablesSnapshot, marker.name);
    if (!resolved) {
      outLines.push(`⏳ {{${marker.name}[${marker.maxLen}${marker.hard ? '*' : ''}]}} loading…`);
      outCodes.push({ ...restCodes, varBlock: marker, varBlockPending: true });
      outNumbers.push(lineNumbers[i]);
      continue;
    }

    const segments = wrapValue(variablesSnapshot[marker.name], marker.maxLen, marker.hard);
    segments.forEach((seg, k) => {
      const segCodes = k === 0 ? restCodes : stripOneShotCodes(restCodes);
      outLines.push(seg);
      outCodes.push({ ...segCodes, virtual: true, virtualBlock: marker.name, virtualIndex: k, virtualCount: segments.length });
      outNumbers.push(lineNumbers[i]);
    });
  }

  return { lines: outLines, lineCodes: outCodes, lineNumbers: outNumbers };
}

/** Does this file's (already-expanded) lineCodes contain at least one still-pending block? */
export function hasVarBlocks(lineCodes) {
  return lineCodes.some((c) => c?.varBlock);
}

/**
 * Variable names referenced by this file's still-pending blocks (deduped).
 * Used to decide whether a reactive re-expand is actually worth doing —
 * a file should only be reparsed when one of the SPECIFIC variables its
 * pending blocks are waiting on has resolved, not on every unrelated
 * variable change (see contexts/FileContext.jsx).
 */
export function pendingVarBlockNames(lineCodes) {
  const names = new Set();
  for (const c of lineCodes) if (c?.varBlock) names.add(c.varBlock.name);
  return [...names];
}
