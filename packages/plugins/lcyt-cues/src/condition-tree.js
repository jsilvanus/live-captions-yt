/**
 * Shared condition-tree node predicates — used by both the write-time
 * validator (`routes/cues.js`) and the runtime evaluator (`cue-engine.js`)
 * so the definition of "what counts as a leaf" can't drift between them.
 */

/** True if `node` is a leaf condition (as opposed to a ref or and/or/not group). */
export function isLeafNode(node) {
  if (!node || typeof node !== 'object') return false;
  if (node.type === 'ref' || node.ref) return false;
  if (node.type === 'match') return true;
  return Boolean(node.matchType || node.match_type || node.pattern !== undefined || node.value !== undefined || node.text !== undefined || node.path || node.key);
}
