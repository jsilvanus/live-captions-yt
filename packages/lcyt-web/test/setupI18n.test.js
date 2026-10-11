/**
 * The setup wizard / Setup Hub texts (`setupWizard.*` in src/locales) must exist in
 * en, fi and sv with the same keys and placeholders, and cover every id the code uses.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import en from '../src/locales/en.js';
import fi from '../src/locales/fi.js';
import sv from '../src/locales/sv.js';
import { makeSetupT, hasSetupText } from '../src/lib/setupText.js';
import { INTENTS, QUESTIONS, PREREQUISITES, FEATURE_RULES, PREREQUISITE_KINDS } from '../src/components/setup-wizard/lib/capabilities.js';
import { ALL_FEATURE_CODES, CONFIG_STEP_TEMPLATES } from '../src/components/setup-wizard/lib/constants.js';
import { FEATURE_TO_CARD_IDS } from '../src/lib/workflowFeatureMap.js';
import { describeFlow } from '../src/components/setup-wizard/lib/capabilities.js';

function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object') flatten(v, key, out); else out[key] = v;
  }
  return out;
}
const placeholders = s => [...String(s).matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(',');

const E = flatten(en.setupWizard), F = flatten(fi.setupWizard), S = flatten(sv.setupWizard);

describe('setupWizard locales', () => {
  it('fi and sv have exactly the keys of en', () => {
    assert.deepEqual(Object.keys(F).sort(), Object.keys(E).sort());
    assert.deepEqual(Object.keys(S).sort(), Object.keys(E).sort());
  });

  it('placeholders match across languages', () => {
    for (const k of Object.keys(E)) {
      assert.equal(placeholders(F[k]), placeholders(E[k]), `fi ${k}`);
      assert.equal(placeholders(S[k]), placeholders(E[k]), `sv ${k}`);
    }
  });

  it('no empty strings', () => {
    for (const map of [E, F, S]) for (const [k, v] of Object.entries(map)) assert.ok(String(v).trim().length > 0, k);
  });
});

describe('every id used by the setup code has text', () => {
  const need = key => assert.ok(key in E, `missing setupWizard.${key}`);

  it('intents, questions, options, prerequisites, flows, features, steps', () => {
    for (const i of INTENTS) { need(`intent.${i}.title`); need(`intent.${i}.desc`); }
    for (const q of QUESTIONS) {
      need(`q.${q.id}.label`);
      for (const o of q.options || []) need(`q.${q.id}.opt.${o}`);
    }
    for (const p of PREREQUISITES) need(`prereq.${p.id}`);
    for (const k of PREREQUISITE_KINDS) need(`prereqGroup.${k}`);
    for (const c of ALL_FEATURE_CODES) need(`feature.${c}`);
    for (const s of CONFIG_STEP_TEMPLATES) need(s.titleKey);
    for (const id of describeFlow(new Set(ALL_FEATURE_CODES))) need(`flow.${id}`);
    for (const rule of FEATURE_RULES) for (const c of rule.enable) need(`feature.${c}`);
  });

  it('every mapped Hub card has a name', () => {
    for (const ids of Object.values(FEATURE_TO_CARD_IDS)) for (const id of ids) need(`hub.card.${id}`);
  });
});

describe('makeSetupT()', () => {
  it('translates, interpolates and falls back', () => {
    assert.equal(makeSetupT('en')('back'), 'Back');
    assert.equal(makeSetupT('fi')('back'), 'Takaisin');
    assert.equal(makeSetupT('sv')('stepOf', { n: 2, total: 5, title: 'X' }), 'Steg 2 av 5 — X');
    assert.equal(makeSetupT('zz')('back'), 'Back');
    assert.equal(makeSetupT('fi')('does.not.exist'), 'does.not.exist');
  });

  it('hasSetupText() tells optional text apart', () => {
    assert.equal(hasSetupText('q.sttLocation.help'), true);
    assert.equal(hasSetupText('q.translate.help'), false);
  });
});
