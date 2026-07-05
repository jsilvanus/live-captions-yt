/**
 * Minimal JSONPath subset evaluator for api_response_mappings.json_path.
 *
 * No JSONPath library is installed anywhere in this monorepo (see research for
 * plan_api_connectors_variables.md); this hand-rolled subset covers the common
 * cases needed here: '$' (whole body), dot access ('$.foo.bar'), and bracket
 * array/index access ('$.items[0].name'). Not a full JSONPath implementation
 * (no wildcards, filters, or recursive descent) — sufficient for mapping a
 * connector's JSON response onto named variables.
 *
 * @param {*} data     parsed JSON body
 * @param {string} path e.g. '$', '$.foo.bar', '$.items[0].name'
 * @returns {*} the extracted value, or undefined if the path doesn't resolve
 */
export function evaluateJsonPath(data, path) {
  if (!path || path === '$') return data;

  const tokens = tokenize(path);
  let current = data;
  for (const token of tokens) {
    if (current === undefined || current === null) return undefined;
    current = current[token];
  }
  return current;
}

function tokenize(path) {
  let rest = path.trim();
  if (rest.startsWith('$')) rest = rest.slice(1);
  if (rest.startsWith('.')) rest = rest.slice(1);

  const tokens = [];
  const re = /([^[.\]]+)|\[(\d+)\]|\['([^']*)'\]|\["([^"]*)"\]/g;
  let m;
  while ((m = re.exec(rest)) !== null) {
    if (m[1] !== undefined) tokens.push(m[1]);
    else if (m[2] !== undefined) tokens.push(Number(m[2]));
    else if (m[3] !== undefined) tokens.push(m[3]);
    else if (m[4] !== undefined) tokens.push(m[4]);
  }
  return tokens;
}
