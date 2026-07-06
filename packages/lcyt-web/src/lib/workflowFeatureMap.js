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
 * `ai-models`/`connectors` likewise have no wizard feature code at all, so
 * they never appear under the Workflow filter, only under "All".
 */
export const FEATURE_TO_CARD_IDS = {
  captions:         ['caption-targets'],
  'viewer-target':  ['caption-targets'],
  'restream-fanout': ['caption-targets'],
  translations:     ['languages'],
  'file-saving':          ['storage'],
  'files-local':          ['storage'],
  'files-managed-bucket': ['storage'],
  'files-custom-bucket':  ['storage'],
  'files-webdav':         ['storage'],
  'files-browser-local':  ['storage'],
  'graphics-server': ['viewports'],
  'graphics-client': ['viewports'],
  ingest: ['egress'],
  radio:  ['radio'],
  'stt-server': ['stt'],
  'device-control': ['cameras', 'mixers', 'encoders', 'bridges'],
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
