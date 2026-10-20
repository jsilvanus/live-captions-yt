/**
 * Setup Hub "group cards" view: headings and the cards under each, in display order.
 * Card ids match the `id` of each Hub card; the flat view keeps `HUB_CARD_ORDER`.
 */
export const HUB_GROUPS = [
  { id: 'devices', cards: ['devices', 'bridges'] },
  { id: 'streaming', cards: ['outputs', 'egress', 'feeds', 'radio', 'viewer-stream', 'viewports', 'screens'] },
  { id: 'captions', cards: ['caption-targets', 'icons', 'languages', 'stt'] },
  { id: 'integrations', cards: ['mcp-access', 'connectors', 'broadcast-platforms', 'ai-roles', 'storage', 'tally', 'contact'] },
];

/** Flat order used when grouping is off (unchanged from before grouping existed). */
export const HUB_CARD_ORDER = [
  'devices', 'bridges',
  'outputs', 'egress', 'feeds', 'radio', 'viewer-stream', 'viewports', 'screens',
  'caption-targets', 'icons', 'languages',
  'stt', 'storage',
  'mcp-access', 'connectors', 'broadcast-platforms', 'ai-roles',
  'tally',
  'contact',
];
