/**
 * Maps the Setup Wizard's feature codes (see `components/FeaturePicker.jsx`)
 * to the Setup Hub card id(s) each one is about, so the "Workflow" filter
 * pill can show "just the subset of setup options this project's enabled
 * features actually need" — driven by the project's real, persisted feature
 * flags (`GET /keys/:key/features`), not a separate "last wizard run" record.
 *
 * Not every feature code has a Setup Hub card counterpart (e.g. `stats`,
 * `mic-lock`, `embed` are not represented as their own cards) — those are
 * simply omitted here and never contribute a card to the Workflow filter.
 * `connectors` likewise has no wizard feature code at all, so it never
 * appears under the Workflow filter, only under "All".
 */
export const FEATURE_TO_CARD_IDS = {
  captions:         ['caption-targets'],
  'viewer-target':  ['caption-targets'],
  'restream':       ['egress', 'outputs'],
  'cea-captions':   ['caption-targets'],
  translations:     ['languages'],
  'file-saving':          ['storage'],
  'files-local':          ['storage'],
  'files-managed-bucket': ['storage'],
  'files-custom-bucket':  ['storage'],
  'files-webdav':         ['storage'],
  'files-browser-local':  ['storage'],
  'graphics-server': ['viewports'],
  'graphics-client': ['viewports'],
  ingest: ['egress', 'feeds', 'outputs'],
  radio:  ['radio'],
  'hls-stream': ['viewer-stream'],
  preview: ['viewer-stream'],
  'stt-server': ['stt'],
  'device-control': ['devices', 'bridges'],
  'broadcast-platforms': ['broadcast-platforms'],
  'ai-agent': ['ai-roles'],
  'mcp-access': ['mcp-access'],
};

/**
 * @param {{code: string, enabled: boolean}[]} features
 * @returns {Set<string>} Setup Hub card ids relevant to the enabled features.
 */
export function cardIdsForEnabledFeatures(features) {
  const ids = new Set();
  for (const f of features) {
    if (!f.enabled) continue;
    for (const cardId of FEATURE_TO_CARD_IDS[f.code] || []) ids.add(cardId);
  }
  return ids;
}

/**
 * Why each card shows under the Workflow filter: card id -> feature codes
 * (of the enabled features) that bring it in.
 * @param {{code: string, enabled: boolean}[]} features
 * @returns {Map<string, string[]>}
 */
export function cardReasons(features) {
  const reasons = new Map();
  for (const f of features) {
    if (!f.enabled) continue;
    for (const cardId of FEATURE_TO_CARD_IDS[f.code] || []) {
      if (!reasons.has(cardId)) reasons.set(cardId, []);
      reasons.get(cardId).push(f.code);
    }
  }
  return reasons;
}
