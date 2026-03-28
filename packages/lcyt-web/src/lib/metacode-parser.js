// Metacode-aware file parser extracted from fileUtils.js
// Exports a single pure function: parseFileContent(rawText)

const BOOLEAN_CODES = ['lyrics', 'no-translate'];
const MULTI_META_RE = /<!--\s*([a-z][a-z0-9-]*(?:\[[^\]]*\])?)\s*:\s*([\s\S]*?)\s*-->/gi;
const STANZA_OPEN_RE = /^<!--\s*stanza\s*$/i;
const EMPTY_SEND_RE = /^_(?:\s+(.+))?$/;

// Cue metacodes are extracted and stripped BEFORE other processing because
// they can coexist with content text and other metacodes on the same line.
// E.g. `<!-- cue:Amen -->Let us pray` → content "Let us pray" with cue "Amen".
const CUE_META_RE = /<!--\s*cue\s*:\s*([\s\S]*?)\s*-->/gi;

function isMetadataOnlyLine(raw) {
  let pos = 0;
  while (pos < raw.length) {
    if (raw[pos] === ' ' || raw[pos] === '\t' || raw[pos] === '\r') { pos++; continue; }
    if (raw.startsWith('<!--', pos)) {
      const end = raw.indexOf('-->', pos + 4);
      if (end === -1) return false;
      pos = end + 3;
    } else {
      return false;
    }
  }
  return true;
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

    // Extract cue metacodes — they can appear alongside content and other
    // metacodes on any line.  Strip them so the remaining text is the
    // caption content (or remaining metadata).
    // Only the first cue phrase is used; additional cues on the same line
    // are stripped but ignored (one cue per line).
    CUE_META_RE.lastIndex = 0;
    let cuePhrase = null;
    const effectiveRaw = raw.replace(CUE_META_RE, (_, val) => {
      const trimmed = val.trim();
      if (trimmed && !cuePhrase) cuePhrase = trimmed;
      return '';
    }).trim();
    // If no cue was found, use the original raw text
    const lineRaw = cuePhrase != null ? effectiveRaw : raw;

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
    } else {
      const emptySendMatch = lineRaw.match(EMPTY_SEND_RE);
      if (emptySendMatch) {
        const label = emptySendMatch[1]?.trim() || null;
        const codes = { ...currentCodes, emptySend: true, ...(label ? { emptySendLabel: label } : {}) };
        if (cuePhrase) codes.cue = cuePhrase;
        lines.push('');
        lineCodes.push(codes);
        lineNumbers.push(i + 1);
      } else if (isMetadataOnlyLine(lineRaw)) {
        let audioAction = null;
        let timerAction = null;
        let gotoAction = null;
        let fileSwitchAction = null;
        let fileSwitchServerAction = null;
        for (const m of lineRaw.matchAll(MULTI_META_RE)) {
          const key = m[1].toLowerCase();
          const value = m[2].trim();
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
        const hasAction = audioAction || timerAction !== null || gotoAction !== null || fileSwitchAction !== null || fileSwitchServerAction !== null;
        if (hasAction || cuePhrase) {
          const actionCodes = { ...currentCodes };
          if (audioAction) actionCodes.audioCapture = audioAction;
          if (timerAction !== null) actionCodes.timer = timerAction;
          if (gotoAction !== null) actionCodes.goto = gotoAction;
          if (fileSwitchAction !== null) actionCodes.fileSwitch = fileSwitchAction;
          if (fileSwitchServerAction !== null) actionCodes.fileSwitchServer = fileSwitchServerAction;
          if (cuePhrase) actionCodes.cue = cuePhrase;
          lines.push('');
          lineCodes.push(actionCodes);
          lineNumbers.push(i + 1);
        }
      } else {
        const codes = { ...currentCodes };
        if (cuePhrase) codes.cue = cuePhrase;
        lines.push(lineRaw);
        lineCodes.push(codes);
        lineNumbers.push(i + 1);
      }
    }
  }

  return { lines, lineCodes, lineNumbers };
}
