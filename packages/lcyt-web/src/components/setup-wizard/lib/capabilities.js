/**
 * Intent → capability model for the setup wizard (plan: setup-wizard refactor, phase 1).
 *
 * The wizard asks production questions ("do you want captions?", "where does the
 * video come from?") instead of feature-flag questions. This module is the pure,
 * data-driven bridge between the two:
 *
 *   intents + answers  ──resolveIntent()──▶  feature flags, config steps,
 *                                            Setup Hub cards, prerequisites
 *
 * No React, no I/O. Feature flags stay the persisted source of truth (the Setup
 * Hub Workflow chip keeps deriving from them); intents/answers only produce them.
 *
 * Four kinds of dependency are kept apart:
 *   - feature dependency      → DEPS in constants.js (auto-enable), applied here
 *   - configuration dependency → `prerequisites` kind 'configuration'
 *   - operational dependency   → `prerequisites` kind 'operational'
 *   - optional enhancement     → `prerequisites` kind 'optional'
 * Only the first is ever written to a feature flag.
 */

import { applyDeps } from './applyDeps.js';
import { computeSteps } from './computeSteps.js';
import { cardIdsForEnabledFeatures } from '../../../lib/workflowFeatureMap.js';

export const PREREQUISITE_KINDS = ['configuration', 'operational', 'optional'];

export const INTENTS = ['captions', 'video', 'production', 'graphics', 'devices', 'broadcast', 'ai', 'integrations'];

/**
 * Questions, in display order. `showIf(answers, intents)` decides visibility;
 * `type` is 'bool' | 'choice'. Text is a label key for the UI layer (phase 2).
 */
export const QUESTIONS = [
  // Captions
  { id: 'captionSource', intent: 'captions', type: 'choice', options: ['own', 'external', 'transcribe'] },
  { id: 'sttLocation', intent: 'captions', type: 'choice', options: ['browser', 'server'],
    showIf: a => a.captionSource === 'transcribe' },
  { id: 'translate', intent: 'captions', type: 'bool' },
  { id: 'viewerPage', intent: 'captions', type: 'bool' },
  { id: 'brandedViewer', intent: 'captions', type: 'bool', showIf: a => a.viewerPage === true },
  { id: 'broadcastCaptions', intent: 'captions', type: 'bool' },
  { id: 'saveCaptionFiles', intent: 'captions', type: 'bool' },
  // Video
  { id: 'videoInput', intent: 'video', type: 'choice', options: ['rtmp', 'hls', 'whep', 'camera', 'unsure'] },
  { id: 'relay', intent: 'video', type: 'bool' },
  { id: 'hlsOutput', intent: 'video', type: 'bool' },
  { id: 'radioOutput', intent: 'video', type: 'bool' },
  { id: 'preview', intent: 'video', type: 'bool' },
  { id: 'verticalCrop', intent: 'video', type: 'bool' },
  // Production equipment
  { id: 'controlCameras', intent: 'production', type: 'bool' },
  { id: 'controlMixers', intent: 'production', type: 'bool' },
  { id: 'controlEncoders', intent: 'production', type: 'bool' },
  // Graphics
  { id: 'graphicsOnVideo', intent: 'graphics', type: 'bool' },
  { id: 'graphicsSeparateDisplay', intent: 'graphics', type: 'bool' },
  // Operator devices
  { id: 'operatorDevices', intent: 'devices', type: 'bool' },
  // Publishing to a platform
  { id: 'publishYoutube', intent: 'broadcast', type: 'bool' },
  { id: 'scheduleBroadcasts', intent: 'broadcast', type: 'bool', showIf: a => a.publishYoutube === true },
  { id: 'viewerStats', intent: 'broadcast', type: 'bool', showIf: a => a.publishYoutube === true },
  { id: 'publishViewerStream', intent: 'broadcast', type: 'bool' },
  // AI and assistants
  { id: 'aiRoles', intent: 'ai', type: 'bool' },
  { id: 'outsideAssistant', intent: 'ai', type: 'bool' },
  // Data from other systems
  { id: 'externalData', intent: 'integrations', type: 'bool' },
];

/**
 * Feature rules: each says which flags an answer (or a bare intent) switches on.
 * `when(intents, a)` receives a Set of intents and the answers object.
 */
const has = (intents, name) => intents.has(name);

export const FEATURE_RULES = [
  // Captions
  { enable: ['captions'], when: (i, a) => has(i, 'captions') && a.broadcastCaptions !== false },
  { enable: ['stt-server'], when: (i, a) => has(i, 'captions') && a.captionSource === 'transcribe' && a.sttLocation === 'server' },
  { enable: ['translations'], when: (i, a) => has(i, 'captions') && a.translate === true },
  { enable: ['viewer-target'], when: (i, a) => has(i, 'captions') && a.viewerPage === true },
  { enable: ['file-saving'], when: (i, a) => has(i, 'captions') && a.saveCaptionFiles === true },
  // Video
  { enable: ['ingest'], when: (i, a) => has(i, 'video') && (a.relay === true || (a.videoInput && a.videoInput !== 'unsure')) },
  { enable: ['restream'], when: (i, a) => has(i, 'video') && a.relay === true },
  { enable: ['hls-stream'], when: (i, a) => has(i, 'video') && a.hlsOutput === true },
  { enable: ['radio'], when: (i, a) => has(i, 'video') && a.radioOutput === true },
  { enable: ['preview'], when: (i, a) => has(i, 'video') && a.preview === true },
  { enable: ['crop'], when: (i, a) => has(i, 'video') && a.verticalCrop === true },
  // Production equipment and operator devices (device roles live under device-control)
  { enable: ['device-control'], when: (i, a) => has(i, 'production') && (a.controlCameras || a.controlMixers || a.controlEncoders) },
  { enable: ['device-control'], when: (i, a) => has(i, 'devices') && a.operatorDevices === true },
  // Publishing: YouTube channel management, or our own viewer stream (no platform account)
  { enable: ['broadcast-platforms'], when: (i, a) => has(i, 'broadcast') && a.publishYoutube === true && (a.scheduleBroadcasts === true || a.viewerStats === true) },
  { enable: ['hls-stream'], when: (i, a) => has(i, 'broadcast') && a.publishViewerStream === true },
  // AI and assistants
  { enable: ['ai-agent'], when: (i, a) => has(i, 'ai') && a.aiRoles === true },
  { enable: ['mcp-access'], when: (i, a) => has(i, 'ai') && a.outsideAssistant === true },
  // Graphics
  { enable: ['graphics-client'], when: (i, a) => has(i, 'graphics') && (a.graphicsOnVideo || a.graphicsSeparateDisplay) },
  { enable: ['graphics-server'], when: (i, a) => has(i, 'graphics') && a.graphicsOnVideo === true },
];

/**
 * Topic rules: Setup Hub cards some answers point at that have no feature flag
 * of their own (viewer icons, API connectors). They only add cards and
 * prerequisites; nothing is written to the project's features.
 */
export const TOPIC_RULES = [
  { cards: ['icons'], when: (i, a) => has(i, 'captions') && a.viewerPage === true && a.brandedViewer === true },
  { cards: ['connectors'], when: (i, a) => has(i, 'integrations') && a.externalData === true },
];

/**
 * Prerequisites: things a chosen workflow needs that a feature flag cannot give.
 * kind: 'configuration' (something must be set up), 'operational' (must be
 * online/compatible), 'optional' (useful, not required). `link` is an app route.
 */
export const PREREQUISITES = [
  { id: 'caption-target', kind: 'configuration', feature: 'captions', link: '/setup/caption-targets',
    when: (i, a) => has(i, 'captions') && a.broadcastCaptions !== false },
  { id: 'stt-provider', kind: 'configuration', feature: 'stt-server', link: '/setup/stt',
    when: (i, a) => has(i, 'captions') && a.captionSource === 'transcribe' && a.sttLocation === 'server' },
  { id: 'incoming-stream', kind: 'operational', feature: 'ingest', link: '/setup/feeds',
    when: (i, a) => has(i, 'video') && a.videoInput && a.videoInput !== 'unsure' },
  { id: 'relay-destination', kind: 'configuration', feature: 'restream', link: '/setup/egress',
    when: (i, a) => has(i, 'video') && a.relay === true },
  { id: 'server-audio-source', kind: 'operational', feature: 'stt-server', link: '/setup/feeds',
    when: (i, a) => has(i, 'captions') && a.captionSource === 'transcribe' && a.sttLocation === 'server' },
  { id: 'bridge', kind: 'optional', feature: 'device-control', link: '/setup/bridges',
    when: (i, a) => has(i, 'production') && (a.controlCameras || a.controlMixers || a.controlEncoders) },
  { id: 'cameras', kind: 'configuration', feature: 'device-control', link: '/setup/cameras',
    when: (i, a) => has(i, 'production') && a.controlCameras === true },
  { id: 'mixers', kind: 'configuration', feature: 'device-control', link: '/setup/mixers',
    when: (i, a) => has(i, 'production') && a.controlMixers === true },
  { id: 'encoders', kind: 'configuration', feature: 'device-control', link: '/setup/encoders',
    when: (i, a) => has(i, 'production') && a.controlEncoders === true },
  { id: 'device-roles', kind: 'configuration', feature: 'device-control', link: '/production/devices',
    when: (i, a) => has(i, 'devices') && a.operatorDevices === true },
  { id: 'viewport', kind: 'configuration', feature: 'graphics-server', link: '/setup/viewports',
    when: (i, a) => has(i, 'graphics') && (a.graphicsOnVideo || a.graphicsSeparateDisplay) },
  { id: 'dsk-video-path', kind: 'operational', feature: 'graphics-server', link: '/setup/feeds',
    when: (i, a) => has(i, 'graphics') && a.graphicsOnVideo === true },
  { id: 'platform-connection', kind: 'configuration', feature: 'broadcast-platforms', link: '/setup/broadcast-platforms',
    when: (i, a) => has(i, 'broadcast') && a.publishYoutube === true },
  { id: 'viewer-stream-video', kind: 'operational', feature: 'hls-stream', link: '/setup/feeds',
    when: (i, a) => has(i, 'broadcast') && a.publishViewerStream === true },
  { id: 'ai-role-model', kind: 'configuration', feature: 'ai-agent', link: '/setup/ai-roles',
    when: (i, a) => has(i, 'ai') && a.aiRoles === true },
  { id: 'mcp-token', kind: 'configuration', feature: 'mcp-access', link: '/setup/mcp-access',
    when: (i, a) => has(i, 'ai') && a.outsideAssistant === true },
  // Topic prerequisites carry no feature flag: `feature` is null
  { id: 'connector', kind: 'configuration', feature: null, link: '/setup/connectors',
    when: (i, a) => has(i, 'integrations') && a.externalData === true },
  { id: 'viewer-icon', kind: 'optional', feature: null, link: '/setup/icons',
    when: (i, a) => has(i, 'captions') && a.viewerPage === true && a.brandedViewer === true },
];

/**
 * Merge a newly derived feature set into the current selection without losing
 * features the user (or the project) already had: whatever the previous intent
 * answers derived is removed, whatever the new answers derive is added, and
 * everything else is kept. Dependencies of kept features stay valid.
 *
 * @param {Set<string>} current
 * @param {Set<string>} previousDerived
 * @param {Set<string>} nextDerived
 * @returns {Set<string>}
 */
export function mergeDerivedFeatures(current, previousDerived, nextDerived) {
  const merged = new Set(current);
  for (const code of previousDerived) merged.delete(code);
  for (const code of nextDerived) merged.add(code);
  applyDeps(merged);
  return merged;
}

/** Questions currently visible for the chosen intents and answers. */
export function visibleQuestions(intents, answers = {}) {
  const set = intents instanceof Set ? intents : new Set(intents);
  return QUESTIONS.filter(q => set.has(q.intent) && (!q.showIf || q.showIf(answers, set)));
}

/**
 * @param {Iterable<string>} intents  chosen intents (see INTENTS)
 * @param {Record<string, any>} [answers]  answers keyed by question id
 * @returns {{
 *   features: Set<string>,
 *   autoEnabled: string[],
 *   steps: Array<{id: string, title: string, featureCode?: string}>,
 *   hubCards: Set<string>,
 *   prerequisites: Array<{id: string, kind: string, feature: string, link: string}>,
 *   questions: typeof QUESTIONS,
 * }}
 */
export function resolveIntent(intents, answers = {}) {
  const set = new Set([...(intents || [])].filter(i => INTENTS.includes(i)));
  const features = new Set();
  for (const rule of FEATURE_RULES) {
    if (rule.when(set, answers)) rule.enable.forEach(c => features.add(c));
  }
  const autoEnabled = applyDeps(features);
  const prerequisites = PREREQUISITES
    .filter(p => p.when(set, answers) && (p.feature === null || features.has(p.feature)))
    .map(({ id, kind, feature, link }) => ({ id, kind, feature, link }));
  return {
    features,
    autoEnabled,
    steps: computeSteps(features, set),
    hubCards: new Set([
      ...cardIdsForEnabledFeatures([...features].map(code => ({ code, enabled: true }))),
      ...TOPIC_RULES.filter(r => r.when(set, answers)).flatMap(r => r.cards),
    ]),
    prerequisites,
    questions: visibleQuestions(set, answers),
  };
}

/**
 * Ids of the production-flow lines (`setupWizard.flow.<id>` in the locales) the enabled features make.
 * @param {Set<string>} features
 * @returns {string[]}
 */
export function describeFlow(features) {
  const f = c => features.has(c);
  const ids = [];
  if (f('ingest')) ids.push('ingest');
  if (f('device-control')) ids.push('device-control');
  if (f('stt-server')) ids.push('stt-server');
  if (f('captions')) ids.push('captions');
  if (f('translations')) ids.push('translations');
  if (f('graphics-server')) ids.push('graphics-server');
  else if (f('graphics-client')) ids.push('graphics-client');
  for (const c of ['restream', 'hls-stream', 'radio', 'crop', 'preview', 'file-saving', 'broadcast-platforms', 'ai-agent', 'mcp-access']) if (f(c)) ids.push(c);
  return ids;
}
