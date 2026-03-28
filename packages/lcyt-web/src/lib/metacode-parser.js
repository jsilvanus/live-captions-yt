// Metacode-aware file parser extracted from fileUtils.js
// Exports a single pure function: parseFileContent(rawText)

const BOOLEAN_CODES = ['lyrics', 'no-translate'];
const MULTI_META_RE = /<!--\s*([a-z][a-z0-9-]*(?:\[[^\]]*\])?)\s*:\s*([\s\S]*?)\s*-->/gi;
const STANZA_OPEN_RE = /^<!--\s*stanza\s*$/i;
const EMPTY_SEND_RE = /^_(?:\s+(.+))?$/;

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

    if (STANZA_OPEN_RE.test(raw)) {
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
      const emptySendMatch = raw.match(EMPTY_SEND_RE);
      if (emptySendMatch) {
        const label = emptySendMatch[1]?.trim() || null;
        lines.push('');
        lineCodes.push({ ...currentCodes, emptySend: true, ...(label ? { emptySendLabel: label } : {}) });
        lineNumbers.push(i + 1);
      } else if (isMetadataOnlyLine(raw)) {
        let audioAction = null;
        let timerAction = null;
        let gotoAction = null;
        let fileSwitchAction = null;
        let fileSwitchServerAction = null;
        for (const m of raw.matchAll(MULTI_META_RE)) {
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
        if (hasAction) {
          const actionCodes = { ...currentCodes };
          if (audioAction) actionCodes.audioCapture = audioAction;
          if (timerAction !== null) actionCodes.timer = timerAction;
          if (gotoAction !== null) actionCodes.goto = gotoAction;
          if (fileSwitchAction !== null) actionCodes.fileSwitch = fileSwitchAction;
          if (fileSwitchServerAction !== null) actionCodes.fileSwitchServer = fileSwitchServerAction;
          lines.push('');
          lineCodes.push(actionCodes);
          lineNumbers.push(i + 1);
        }
      } else {
        lines.push(raw);
        lineCodes.push({ ...currentCodes });
        lineNumbers.push(i + 1);
      }
    }
  }

  return { lines, lineCodes, lineNumbers };
}
