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
// The canonical metacode-aware parser lives in `metacode-parser.js`.
// Re-export the parser here for backward compatibility so callers that
// import from `fileUtils` keep working. Keep non-parser helpers below.
export { parseFileContent } from './metacode-parser.js';

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
