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

/**
 * Matches any single <!-- key: value --> block (used with matchAll for multi-code lines).
 * The key may optionally include a bracket modifier, e.g. file[server].
 * Not anchored — finds all occurrences in a line.
 */
const MULTI_META_RE = /<!--\s*([a-z][a-z0-9-]*(?:\[[^\]]*\])?)\s*:\s*([\s\S]*?)\s*-->/gi;

/** @type {RegExp} Matches the opening line of a stanza block: <!-- stanza */
const STANZA_OPEN_RE = /^<!--\s*stanza\s*$/i;

/** Sentinel for an empty-send line. Captures optional label after the underscore. */
const EMPTY_SEND_RE = /^_(?:\s+(.+))?$/;

/**
 * Returns true if a line consists entirely of <!-- ... --> comment blocks and whitespace.
 * Supports multiple metacodes on one line, e.g.:
 *   <!-- section: Intro --><!-- speaker: Alice -->
 * Uses a character-level scan so that no potentially unterminated comment fragments
 * remain in any intermediate string (avoids incomplete sanitization).
 * @param {string} raw
 */
function isMetadataOnlyLine(raw) {
  let pos = 0;
  while (pos < raw.length) {
    if (raw[pos] === ' ' || raw[pos] === '\t' || raw[pos] === '\r') { pos++; continue; }
    if (raw.startsWith('<!--', pos)) {
      const end = raw.indexOf('-->', pos + 4);
      if (end === -1) return false; // unclosed comment — treat as content
      pos = end + 3;
    } else {
      return false; // non-comment, non-whitespace content
    }
  }
  return true;
}

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
 * Multiple metadata codes may appear on the same line:
 *   <!-- section: Intro --><!-- speaker: Alice --><!-- lang: fi-FI -->
 *
 * Audio capture toggle (one-shot action line, produces an entry in lines[]):
 *   <!-- audio: start -->   ← fires lcyt:audio-capture start, does not persist
 *   <!-- audio: stop -->    ← fires lcyt:audio-capture stop, does not persist
 * These produce lineCodes[i].audioCapture = 'start'|'stop' on an empty caption line.
 *
 * Timer (one-shot action line): after the pointer rests on this line for N seconds,
 * the file automatically advances to the next line (triggering any further metacodes):
 *   <!-- timer: 5 -->     ← auto-advance after 5 seconds
 *   <!-- timer: 0.5 -->   ← auto-advance after 0.5 seconds
 * Produces lineCodes[i].timer = N (seconds, positive float).
 *
 * File switch (one-shot action line): switches to an already-open caption file by name.
 * If the named file is not open, nothing happens.
 * The server variant fetches the file from a URL before switching:
 *   <!-- file: My Script.txt -->          ← switch to open file named "My Script.txt"
 *   <!-- file[server]: /path/to/file -->  ← fetch and open from URL, then switch
 * Produces lineCodes[i].fileSwitch = 'name' or lineCodes[i].fileSwitchServer = 'path'.
 *
 * Goto (one-shot action line): jumps the pointer to a specific file line number.
 * Line numbers refer to the actual raw file line (matching the displayed lineNumbers):
 *   <!-- goto: 42 -->   ← jump pointer to raw line 42
 * Produces lineCodes[i].goto = N (1-indexed raw file line number).
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
 * Line numbers reflect the actual 1-based position in the raw file, so the
 * displayed number matches what you would see in a text editor.
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
        lineNumbers.push(i + 1);
      } else if (isMetadataOnlyLine(raw)) {
        // Metadata-only line: may contain multiple <!-- key: value --> codes.
        // Process each in order.
        //
        // One-shot action metacodes that do NOT persist into currentCodes:
        //   audio: start/stop  — fires lcyt:audio-capture event
        //   timer: N           — auto-advances pointer after N seconds
        //   goto: N            — jumps pointer to raw file line N
        //   file: name         — switches to open file by name
        //   file[server]: path — fetches file from URL and switches to it
        //
        // All other codes update currentCodes normally (they persist).
        let audioAction = null;
        let timerAction = null;
        let gotoAction = null;
        let fileSwitchAction = null;
        let fileSwitchServerAction = null;
        for (const m of raw.matchAll(MULTI_META_RE)) {
          const key = m[1].toLowerCase();
          const value = m[2].trim();
          if (key === 'audio' && (value === 'start' || value === 'stop')) {
            audioAction = value; // captured; will emit as action line after loop
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
        // Emit one action line if any one-shot action was found.
        // Multiple action codes on the same line are all included in the single entry.
        const hasAction = audioAction || timerAction !== null || gotoAction !== null ||
                          fileSwitchAction !== null || fileSwitchServerAction !== null;
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
        // Non-action metadata lines are consumed — not added to output
      } else {
        lines.push(raw);
        lineCodes.push({ ...currentCodes });
        lineNumbers.push(i + 1); // actual 1-based line number in the raw file
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

/**
 * Read a Blob as a base64-encoded string (data URL without the prefix).
 * @param {Blob} blob
 * @returns {Promise<string>}
 */
export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
