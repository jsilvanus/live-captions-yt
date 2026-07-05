/**
 * {{name}} interpolation — server-side only (see plan §2, §7).
 *
 * Reads whatever a variable currently holds; never triggers a refresh itself.
 */

const VAR_RE = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;

/**
 * Replace all {{name}} occurrences in a string using a resolved snapshot.
 * @param {string} text
 * @param {{ [name]: string }} snapshot  name -> resolved value
 * @returns {string}
 */
export function interpolate(text, snapshot) {
  if (typeof text !== 'string' || !text.includes('{{')) return text;
  return text.replace(VAR_RE, (_match, name) => {
    const value = snapshot?.[name];
    return value === undefined || value === null ? '' : String(value);
  });
}

/**
 * Recursively interpolate {{ }} in an array of { key, value } pairs (headers/queryParams shape).
 */
export function interpolatePairs(pairs, snapshot) {
  if (!Array.isArray(pairs)) return [];
  return pairs.map(({ key, value }) => ({ key, value: interpolate(value, snapshot) }));
}

/** Extract all {{name}} references from a string (used to know which variables a field depends on). */
export function extractVariableNames(text) {
  if (typeof text !== 'string') return [];
  const names = new Set();
  for (const m of text.matchAll(VAR_RE)) names.add(m[1]);
  return [...names];
}
