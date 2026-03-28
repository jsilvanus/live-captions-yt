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

const BOOLEAN_CODES = ['lyrics', 'no-translate'];
const MULTI_META_RE = /<!--\s*([a-z][a-z0-9-]*(?:\[[^\]]*\])?)\s*:\s*([\s\S]*?)\s*-->/gi;
const STANZA_OPEN_RE = /^<!--\s*stanza\s*$/i;
const EMPTY_SEND_RE = /^_(?:\s+(.+))?$/;

// Cue metacodes use a dedicated regex so the phrase value is captured
// separately from other metacode key-value pairs.
// Supports optional modifier asterisks: cue: (next), cue*: (skip), cue**: (any)
// Supports optional tilde for fuzzy matching: cue~: (fuzzy), cue*~: (skip+fuzzy)
// Supports bracket modifier: cue[semantic]: (embedding-based semantic matching)
const CUE_META_RE = /<!--\s*cue(\*{0,2})(~?)(\[semantic\])?\s*:\s*([\s\S]*?)\s*-->/gi;

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

export function parseFileContent(rawText) {
  const rawLines = (rawText ?? '').split('\n');
  const lines = [];
  const lineCodes = [];
  const lineNumbers = [];
  const currentCodes = {};

  for (let i = 0; i < rawLines.length; i++) {
    const raw = rawLines[i].trim();
    if (!raw) continue;

    // --- Extract cue metacodes first (dedicated regex) ---
    CUE_META_RE.lastIndex = 0;
    let cuePhrase = null;
    let cueMode = null;
    let cueFuzzy = false;
    let cueSemantic = false;
    const afterCueStrip = raw.replace(CUE_META_RE, (_, stars, tilde, bracket, val) => {
      const trimmed = val.trim();
      if (trimmed && !cuePhrase) {
        cuePhrase = trimmed;
        cueMode = stars === '**' ? 'any' : stars === '*' ? 'skip' : 'next';
        cueFuzzy = tilde === '~';
        cueSemantic = !!bracket;
      }
      return '';
    }).trim();
    const lineRaw = cuePhrase != null ? afterCueStrip : raw;

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
      if (cuePhrase) { codes.cue = cuePhrase; codes.cueMode = cueMode; codes.cueFuzzy = cueFuzzy; codes.cueSemantic = cueSemantic; }
      lines.push('');
      lineCodes.push(codes);
      lineNumbers.push(i + 1);
      continue;
    }

    // --- Extract ALL metacode comments inline ---
    // Process key-value pairs from every `<!-- key: value -->` on the line.
    let audioAction = null;
    let timerAction = null;
    let gotoAction = null;
    let fileSwitchAction = null;
    let fileSwitchServerAction = null;

    MULTI_META_RE.lastIndex = 0;
    for (const m of lineRaw.matchAll(MULTI_META_RE)) {
      const key = m[1].toLowerCase();
      const value = m[2].trim();
      if (key === 'cue') continue; // already handled above
      if (key === 'audio' && (value === 'start' || value === 'stop')) {
        audioAction = value;
      } else if (key === 'timer') {
        const secs = parseFloat(value);
        if (!isNaN(secs) && secs > 0) timerAction = secs;
      } else if (key === 'goto') {
        const lineN = parseInt(value, 10);
        if (!isNaN(lineN) && lineN > 0) gotoAction = lineN;
      } else if (key === 'file') {
        if (value !== '') fileSwitchAction = value;
      } else if (key === 'file[server]') {
        if (value !== '') fileSwitchServerAction = value;
      } else if (value === '') {
        delete currentCodes[key];
      } else {
        let parsed = value;
        if (BOOLEAN_CODES.includes(key)) {
          parsed = value.toLowerCase() === 'true';
        }
        currentCodes[key] = parsed;
      }
    }

    // Strip all comment metacodes to get the remaining content text
    const contentText = stripAllComments(lineRaw);

    // Build the codes object for this line
    const codes = { ...currentCodes };
    if (audioAction) codes.audioCapture = audioAction;
    if (timerAction !== null) codes.timer = timerAction;
    if (gotoAction !== null) codes.goto = gotoAction;
    if (fileSwitchAction !== null) codes.fileSwitch = fileSwitchAction;
    if (fileSwitchServerAction !== null) codes.fileSwitchServer = fileSwitchServerAction;
    if (cuePhrase) { codes.cue = cuePhrase; codes.cueMode = cueMode; codes.cueFuzzy = cueFuzzy; codes.cueSemantic = cueSemantic; }

    // Did the line contain any metacode markers that were stripped?
    const hadMetacodes = contentText !== lineRaw || cuePhrase != null;

    // Always emit the line — content lines, metadata-only lines, and lines
    // whose comments were stripped all produce entries in the output.
    if (contentText || hadMetacodes) {
      lines.push(contentText);
      lineCodes.push(codes);
      lineNumbers.push(i + 1);
    }
  }

  return { lines, lineCodes, lineNumbers };
}
