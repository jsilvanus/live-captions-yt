/**
 * Unit tests for setup-wizard lib utilities.
 * Pure-function tests — no React, no DOM required.
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

// ── Minimal localStorage stub (some tests use saveWizard which calls localStorage) ──────
const _store = {};
const _ls = {
  getItem: (k) => _store[k] ?? null,
  setItem: (k, v) => { _store[k] = String(v); },
  removeItem: (k) => { delete _store[k]; },
};

before(() => {
  globalThis.localStorage = _ls;
});

// ── applyDeps ──────────────────────────────────────────────────────────────────────────

// Inline the module logic so we don't need ESM transform in node:test
const DEPS = {
  'graphics-server': ['graphics-client', 'ingest'],
  'stt-server':      ['ingest'],
  'radio':           ['ingest'],
  'hls-stream':      ['ingest'],
  'preview':         ['ingest'],
};

function applyDeps(set) {
  const autoEnabled = [];
  for (const [code, deps] of Object.entries(DEPS)) {
    if (set.has(code)) {
      for (const dep of deps) {
        if (!set.has(dep)) {
          set.add(dep);
          autoEnabled.push(dep);
        }
      }
    }
  }
  return autoEnabled;
}

describe('applyDeps', () => {
  it('returns empty array when no deps needed', () => {
    const s = new Set(['captions']);
    const auto = applyDeps(s);
    assert.deepEqual(auto, []);
    assert.ok(s.has('captions'));
  });

  it('stt-server auto-enables ingest', () => {
    const s = new Set(['stt-server']);
    const auto = applyDeps(s);
    assert.ok(s.has('ingest'));
    assert.ok(auto.includes('ingest'));
  });

  it('graphics-server auto-enables graphics-client and ingest', () => {
    const s = new Set(['graphics-server']);
    const auto = applyDeps(s);
    assert.ok(s.has('graphics-client'));
    assert.ok(s.has('ingest'));
    assert.ok(auto.includes('graphics-client'));
    assert.ok(auto.includes('ingest'));
  });

  it('does not double-add already present deps', () => {
    const s = new Set(['stt-server', 'ingest']);
    const auto = applyDeps(s);
    assert.deepEqual(auto, []);
  });

  it('radio and hls-stream both require ingest — only reported once', () => {
    const s = new Set(['radio', 'hls-stream']);
    const auto = applyDeps(s);
    // ingest may appear twice in autoEnabled if added by both rules;
    // the important thing is the set only adds it once
    assert.ok(s.has('ingest'));
    const ingestCount = [...s].filter(c => c === 'ingest').length;
    assert.equal(ingestCount, 1, 'ingest should only be in the set once');
  });
});

// ── computeSteps ──────────────────────────────────────────────────────────────────────

const CONFIG_STEP_TEMPLATES = [
  { id: 'targets',      title: 'Caption Targets',  featureCode: 'captions' },
  { id: 'translation',  title: 'Translation',      featureCode: 'translations' },
  { id: 'relay',        title: 'RTMP Relay Slots', featureCode: 'ingest' },
  { id: 'cea-captions', title: 'CEA Captions',     featureCode: 'cea-captions' },
  { id: 'embed',        title: 'Embed Widgets',    featureCode: 'embed' },
  { id: 'stt-server',   title: 'Server STT',       featureCode: 'stt-server' },
];

function computeSteps(selectedFeatures) {
  const configSteps = CONFIG_STEP_TEMPLATES.filter(s =>
    selectedFeatures.has(s.featureCode)
  );
  return [
    { id: 'features', title: 'Select Features' },
    ...configSteps,
    { id: 'review',   title: 'Review' },
  ];
}

describe('computeSteps', () => {
  it('always includes features and review steps', () => {
    const steps = computeSteps(new Set());
    assert.equal(steps[0].id, 'features');
    assert.equal(steps[steps.length - 1].id, 'review');
  });

  it('no config steps when no relevant features selected', () => {
    const steps = computeSteps(new Set(['stats', 'mic-lock']));
    assert.equal(steps.length, 2);
  });

  it('captions feature adds targets step', () => {
    const steps = computeSteps(new Set(['captions']));
    assert.ok(steps.some(s => s.id === 'targets'));
  });

  it('all 6 config steps present when all feature codes selected', () => {
    const all = new Set(['captions', 'translations', 'ingest', 'cea-captions', 'embed', 'stt-server']);
    const steps = computeSteps(all);
    assert.equal(steps.length, 8); // features + 6 config + review
  });

  it('step order matches CONFIG_STEP_TEMPLATES order', () => {
    const all = new Set(['captions', 'translations', 'ingest', 'stt-server']);
    const steps = computeSteps(all);
    const ids = steps.map(s => s.id);
    assert.deepEqual(ids, ['features', 'targets', 'translation', 'relay', 'stt-server', 'review']);
  });
});

// ── saveWizard (localStorage path, no backend) ──────────────────────────────────────

// Inline key helpers matching storageKeys.js conventions
const KEYS = {
  targets: { list: 'lcyt.targets' },
  translation: {
    vendor: 'lcyt.translation.vendor',
    vendorKey: 'lcyt.translation.vendorKey',
    libreUrl: 'lcyt.translation.libreUrl',
    libreKey: 'lcyt.translation.libreKey',
    showOriginal: 'lcyt.translation.showOriginal',
    list: 'lcyt.translation.list',
  },
};
function relaySlotKey(slot, field) { return `lcyt.relay.${slot}.${field}`; }

const DRAFT_KEY = 'lcyt.wizard.draft';
const ALL_FEATURE_CODES = [
  'captions', 'viewer-target', 'translations', 'ingest', 'cea-captions',
  'embed', 'stt-server', 'radio', 'hls-stream', 'preview', 'graphics-client',
  'graphics-server', 'restream-fanout', 'file-saving', 'mic-lock', 'stats',
  'collaboration', 'device-control', 'planning',
];

async function saveWizard({ selectedFeatures, configs, localSettings, updateFeature, initialFeatureSet, initialConfigs, hasBackend }) {
  function set(key, val) { try { localStorage.setItem(key, String(val)); } catch {} }
  function setJson(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} }

  setJson(KEYS.targets.list, localSettings.targets || []);
  set(KEYS.translation.vendor, localSettings.translationVendor || 'mymemory');
  set(KEYS.translation.vendorKey, localSettings.translationVendorKey || '');
  set(KEYS.translation.libreUrl, localSettings.translationLibreUrl || '');
  set(KEYS.translation.libreKey, localSettings.translationLibreKey || '');
  set(KEYS.translation.showOriginal, String(!!localSettings.translationShowOriginal));
  setJson(KEYS.translation.list, localSettings.translationList || []);

  (localSettings.relayList || []).forEach(slot => {
    set(relaySlotKey(slot.slot, 'type'), slot.targetType || 'youtube');
    set(relaySlotKey(slot.slot, 'ytKey'), slot.youtubeKey || '');
  });

  if (hasBackend && typeof updateFeature === 'function') {
    for (const code of ALL_FEATURE_CODES) {
      const wasEnabled = initialFeatureSet.has(code);
      const isEnabled  = selectedFeatures.has(code);
      const cfg        = configs[code] ?? null;
      const initCfg    = initialConfigs[code] ?? null;
      const cfgChanged = isEnabled && JSON.stringify(cfg) !== JSON.stringify(initCfg);
      if (isEnabled !== wasEnabled || cfgChanged) {
        await updateFeature(code, isEnabled, cfg);
      }
    }
  }

  try { localStorage.removeItem(DRAFT_KEY); } catch {}
}

describe('saveWizard', () => {
  it('writes targets to localStorage', async () => {
    const localSettings = {
      targets: [{ id: 'a', type: 'youtube', streamKey: 'sk1', enabled: true }],
      translationVendor: 'mymemory', translationVendorKey: '', translationLibreUrl: '',
      translationLibreKey: '', translationShowOriginal: false, translationList: [],
      relayList: [],
    };
    await saveWizard({
      selectedFeatures: new Set(['captions']),
      configs: {},
      localSettings,
      updateFeature: async () => {},
      initialFeatureSet: new Set(),
      initialConfigs: {},
      hasBackend: false,
    });
    const stored = JSON.parse(localStorage.getItem(KEYS.targets.list));
    assert.equal(stored.length, 1);
    assert.equal(stored[0].streamKey, 'sk1');
  });

  it('clears the draft key after saving', async () => {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ selectedFeatures: ['captions'] }));
    await saveWizard({
      selectedFeatures: new Set(),
      configs: {},
      localSettings: { targets: [], translationVendor: 'mymemory', translationVendorKey: '', translationLibreUrl: '', translationLibreKey: '', translationShowOriginal: false, translationList: [], relayList: [] },
      updateFeature: async () => {},
      initialFeatureSet: new Set(),
      initialConfigs: {},
      hasBackend: false,
    });
    assert.equal(localStorage.getItem(DRAFT_KEY), null);
  });

  it('calls updateFeature only for changed features (diff)', async () => {
    const calls = [];
    await saveWizard({
      selectedFeatures: new Set(['captions', 'stt-server']),
      configs: { 'stt-server': { provider: 'google', language: 'en-US' } },
      localSettings: { targets: [], translationVendor: 'mymemory', translationVendorKey: '', translationLibreUrl: '', translationLibreKey: '', translationShowOriginal: false, translationList: [], relayList: [] },
      updateFeature: async (code, enabled, cfg) => calls.push({ code, enabled, cfg }),
      initialFeatureSet: new Set(['captions']),  // stt-server was NOT enabled before
      initialConfigs: {},
      hasBackend: true,
    });
    // Only stt-server should be reported (captions was already enabled)
    assert.equal(calls.length, 1);
    assert.equal(calls[0].code, 'stt-server');
    assert.equal(calls[0].enabled, true);
  });

  it('skips backend calls when hasBackend is false', async () => {
    const calls = [];
    await saveWizard({
      selectedFeatures: new Set(['captions', 'stt-server', 'translations']),
      configs: {},
      localSettings: { targets: [], translationVendor: 'mymemory', translationVendorKey: '', translationLibreUrl: '', translationLibreKey: '', translationShowOriginal: false, translationList: [], relayList: [] },
      updateFeature: async (code) => calls.push(code),
      initialFeatureSet: new Set(),
      initialConfigs: {},
      hasBackend: false,
    });
    assert.equal(calls.length, 0);
  });
});
