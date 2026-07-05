// {{name}} insertion — pure client-side read of a resolved variable snapshot.
// Never triggers a fetch; see docs/plans/plan_api_connectors_variables.md §1.1, §2.

const VAR_RE = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;

/**
 * Replace {{name}} occurrences in text with values from a resolved snapshot
 * ({ [name]: value }). Missing/undefined values render as empty string.
 */
export function interpolateVariables(text, snapshot) {
  if (typeof text !== 'string' || !text.includes('{{')) return text;
  return text.replace(VAR_RE, (_match, name) => {
    const value = snapshot?.[name];
    return value === undefined || value === null ? '' : String(value);
  });
}
