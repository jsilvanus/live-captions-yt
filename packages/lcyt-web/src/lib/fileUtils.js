/**
 * Reads a File object as text and parses it into non-empty, trimmed lines.
 * HTML comment metadata lines (<!-- key: value -->) are included as-is so they
 * survive the normalization pipeline and can be parsed by parseFileContent().
 * Any <!-- key: value --> comment is supported (not limited to a predefined set).
 * @param {File} file
 * @returns {Promise<string[]>}
 */
export function readFileAsLines(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const lines = e.target.result
        .split('\n')
        .map(l => l.trim())
        .filter(l => l.length > 0);
      resolve(lines);
    };
    reader.onerror = () => reject(new Error(`Failed to read file: ${file.name}`));
    reader.readAsText(file);
  });
}

/**
 * Well-known metadata code keys that receive special treatment (boolean coercion).
 */
const BOOLEAN_CODES = ['lyrics', 'no-translate'];

/** @type {RegExp} Matches <!-- key: value --> metadata comment lines. */
const METADATA_COMMENT_RE = /^<!--\s*([a-z][a-z0-9-]*)\s*:\s*([\s\S]*?)\s*-->$/i;

/** @type {RegExp} Matches the opening line of a stanza block: <!-- stanza */
const STANZA_OPEN_RE = /^<!--\s*stanza\s*$/i;

/** Sentinel for an empty-send line. Captures optional label after the underscore. */
const EMPTY_SEND_RE = /^_(?:\s+(.+))?$/;

/**
 * Parse raw file content and extract text lines with associated metadata codes.
 *
 * Metadata is specified as HTML comments on their own line:
 *   <!-- lang: fi-FI -->
 *   <!-- section: chorus -->
 *   <!-- speaker: Alice -->
 *   <!-- lyrics: true -->
 *   <!-- no-translate: true -->
 *   <!-- my-custom-code: any value -->
 *   <!-- lang: -->      ← empty value removes the code
 *
 * Multi-line stanza blocks set a `stanza` metadata code on all subsequent lines.
 * The stanza text is newline-joined and carried as codes.stanza to the viewer.
 * Stanza blocks do NOT produce a caption line themselves:
 *   <!-- stanza
 *   First song line
 *   Second song line
 *   -->
 *
 * A lone underscore `_` on its own line creates an empty-send entry: pressing
 * Enter on it fires the current metadata codes (including stanza) without sending
 * any caption text to YouTube — useful for pushing the stanza to the viewer
 * before the singing starts.
 *
 * Any valid HTML comment key is accepted (not limited to a predefined list).
 * Each code tags all subsequent lines until the same key appears again.
 * Comment lines are not included in the returned `lines` array.
 * Line numbers count only text lines (metadata comments are excluded from the count).
 *
 * @param {string} rawText
 * @returns {{ lines: string[], lineCodes: object[], lineNumbers: number[] }}
 */
export function parseFileContent(rawText) {
  const rawLines = rawText.split('\n');
  const lines = [];
  const lineCodes = [];
  const lineNumbers = [];
  const currentCodes = {};
  let textLineCount = 0;

  for (let i = 0; i < rawLines.length; i++) {
    const raw = rawLines[i].trim();
    if (!raw) continue;

    if (STANZA_OPEN_RE.test(raw)) {
      // Collect lines until '-->' and store as a stanza metadata code.
      // Stanza blocks are NOT caption lines — they carry singing-aid text
      // to the viewer via codes.stanza on subsequent caption lines.
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
        // Empty-send marker: fires current codes to the viewer without caption text.
        const label = emptySendMatch[1]?.trim() || null;
        lines.push('');
        lineCodes.push({ ...currentCodes, emptySend: true, ...(label ? { emptySendLabel: label } : {}) });
        lineNumbers.push(++textLineCount);
      } else {
        const match = raw.match(METADATA_COMMENT_RE);
        if (match) {
          const key = match[1].toLowerCase();
          const value = match[2].trim();
          if (value === '') {
            delete currentCodes[key];
          } else {
            let parsed = value;
            if (BOOLEAN_CODES.includes(key)) {
              parsed = value.toLowerCase() === 'true';
            }
            currentCodes[key] = parsed;
          }
          // Comment lines are metadata only — not added to output
        } else {
          lines.push(raw);
          lineCodes.push({ ...currentCodes });
          lineNumbers.push(++textLineCount); // running count of text-only lines
        }
      }
    }
  }

  return { lines, lineCodes, lineNumbers };
}

/**
 * Creates a File object from a name and an array of lines.
 * @param {string} name
 * @param {string[]} lines
 * @returns {File}
 */
export function linesToFile(name, lines) {
  const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
  return new File([blob], name, { type: 'text/plain' });
}
