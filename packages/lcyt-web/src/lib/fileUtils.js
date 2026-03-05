/**
 * Reads a File object as text and parses it into non-empty, trimmed lines.
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
 * Creates a File object from a name and an array of lines.
 * @param {string} name
 * @param {string[]} lines
 * @returns {File}
 */
export function linesToFile(name, lines) {
  const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
  return new File([blob], name, { type: 'text/plain' });
}
