/**
 * Reads a File object as text and parses it into non-empty, trimmed lines.
 * HTML comment metadata lines (<!-- key: value -->) are included as-is so they
 * survive the normalization pipeline and can be parsed by parseFileContent().
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
 * Supported metadata code keys for HTML comment annotations.
 */
export const SUPPORTED_CODES = ['lang', 'section', 'speaker', 'lyrics', 'no-translate'];

/** @type {RegExp} Matches <!-- key: value --> metadata comment lines. */
const METADATA_COMMENT_RE = /^<!--\s*([a-z][a-z0-9-]*)\s*:\s*([\s\S]*?)\s*-->$/i;

/**
 * Parse raw file content and extract text lines with associated metadata codes.
 *
 * Metadata is specified as HTML comments on their own line:
 *   <!-- lang: fi-FI -->
 *   <!-- section: chorus -->
 *   <!-- speaker: Alice -->
 *   <!-- lyrics: true -->
 *   <!-- no-translate: true -->
 *   <!-- lang: -->      ← empty value removes the code
 *
 * Each code tags all subsequent lines until the same key appears again.
 * Comment lines are not included in the returned `lines` array.
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

    const match = raw.match(METADATA_COMMENT_RE);
    if (match) {
      const key = match[1].toLowerCase();
      const value = match[2].trim();
      if (SUPPORTED_CODES.includes(key)) {
        if (value === '') {
          delete currentCodes[key];
        } else {
          let parsed = value;
          if (key === 'lyrics' || key === 'no-translate') {
            parsed = value.toLowerCase() === 'true';
          }
          currentCodes[key] = parsed;
        }
      }
      // Comment lines are metadata only — not added to output
    } else {
      lines.push(raw);
      lineCodes.push({ ...currentCodes });
      lineNumbers.push(lines.length); // 1-based, counts only text lines (not metadata)
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
