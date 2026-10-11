import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mergeDerivedFeatures, describeFlow, resolveIntent, visibleQuestions, QUESTIONS, FEATURE_RULES, PREREQUISITES, INTENTS } from '../src/components/setup-wizard/lib/capabilities.js';
import { ALL_FEATURE_CODES } from '../src/components/setup-wizard/lib/constants.js';
import { KNOWN_FEATURE_CODES } from '../../lcyt-backend/src/db/project-features.js';

const sorted = s => [...s].sort();

describe('resolveIntent()', () => {
  it('no intents → no features, only features/review steps', () => {
    const r = resolveIntent([], {});
    assert.deepEqual(sorted(r.features), []);
    assert.deepEqual(r.steps.map(s => s.id), ['intent', 'features', 'review']);
  });

  it('captions + own text → captions only, with a caption-target prerequisite', () => {
    const r = resolveIntent(['captions'], { captionSource: 'own' });
    assert.deepEqual(sorted(r.features), ['captions']);
    assert.deepEqual(r.prerequisites.map(p => p.id), ['caption-target']);
    assert.ok(r.steps.some(s => s.id === 'targets'));
  });

  it('server-side STT pulls in ingest by dependency and adds the stt and relay steps', () => {
    const r = resolveIntent(['captions'], { captionSource: 'transcribe', sttLocation: 'server' });
    assert.deepEqual(sorted(r.features), ['captions', 'ingest', 'stt-server']);
    assert.deepEqual(r.autoEnabled, ['ingest']);
    assert.ok(r.steps.some(s => s.id === 'stt-server'));
    assert.ok(r.steps.some(s => s.id === 'relay'));
    assert.ok(r.hubCards.has('stt'));
  });

  it('browser STT needs no server feature', () => {
    const r = resolveIntent(['captions'], { captionSource: 'transcribe', sttLocation: 'browser' });
    assert.deepEqual(sorted(r.features), ['captions']);
  });

  it('declining caption delivery leaves captions off', () => {
    const r = resolveIntent(['captions'], { broadcastCaptions: false });
    assert.equal(r.features.has('captions'), false);
  });

  it('video relay + vertical crop + hls', () => {
    const r = resolveIntent(['video'], { videoInput: 'rtmp', relay: true, hlsOutput: true, verticalCrop: true });
    assert.deepEqual(sorted(r.features), ['crop', 'hls-stream', 'ingest', 'restream']);
    assert.ok(r.hubCards.has('egress') && r.hubCards.has('ingestion'));
  });

  it('"I don\'t know" video input does not enable ingest by itself', () => {
    const r = resolveIntent(['video'], { videoInput: 'unsure' });
    assert.equal(r.features.has('ingest'), false);
  });

  it('production equipment → device-control with one prerequisite per chosen kind, no mixers', () => {
    const r = resolveIntent(['production'], { controlCameras: true, controlEncoders: true });
    assert.deepEqual(sorted(r.features), ['device-control']);
    assert.deepEqual(sorted(r.prerequisites.map(p => p.id)), ['bridge', 'cameras', 'encoders']);
    for (const c of ['cameras', 'encoders', 'bridges', 'mixers']) assert.ok(r.hubCards.has(c));
  });

  it('operator devices → device-control plus a device-roles prerequisite (not conflated with equipment)', () => {
    const r = resolveIntent(['devices'], { operatorDevices: true });
    assert.deepEqual(sorted(r.features), ['device-control']);
    assert.deepEqual(r.prerequisites.map(p => p.id), ['device-roles']);
  });

  it('graphics on video → graphics-server, graphics-client and ingest (dependency)', () => {
    const r = resolveIntent(['graphics'], { graphicsOnVideo: true });
    assert.deepEqual(sorted(r.features), ['graphics-client', 'graphics-server', 'ingest']);
    assert.deepEqual(sorted(r.prerequisites.map(p => p.id)), ['dsk-video-path', 'viewport']);
    assert.ok(r.hubCards.has('viewports'));
  });

  it('separate display only → graphics-client, no server renderer', () => {
    const r = resolveIntent(['graphics'], { graphicsSeparateDisplay: true });
    assert.deepEqual(sorted(r.features), ['graphics-client']);
  });

  it('answers for an unselected intent are ignored', () => {
    const r = resolveIntent(['captions'], { relay: true, controlMixers: true, graphicsOnVideo: true });
    assert.deepEqual(sorted(r.features), ['captions']);
  });

  it('unknown intents are dropped', () => {
    assert.deepEqual(sorted(resolveIntent(['nope'], { relay: true }).features), []);
  });

  it('several intents combine', () => {
    const r = resolveIntent(['captions', 'video', 'graphics'], {
      captionSource: 'transcribe', sttLocation: 'server', relay: true, graphicsOnVideo: true, videoInput: 'rtmp',
    });
    assert.deepEqual(sorted(r.features), ['captions', 'graphics-client', 'graphics-server', 'ingest', 'restream', 'stt-server']);
  });

  it('prerequisites only appear for features that ended up enabled', () => {
    const r = resolveIntent(['captions'], { captionSource: 'transcribe', sttLocation: 'server' });
    for (const p of r.prerequisites) assert.ok(r.features.has(p.feature), p.id);
  });
});

describe('steps with intents', () => {
  it('questions step appears once an intent is chosen', () => {
    const r = resolveIntent(['captions'], { captionSource: 'own' });
    assert.deepEqual(r.steps.map(s => s.id), ['intent', 'questions', 'features', 'targets', 'review']);
  });
});

describe('mergeDerivedFeatures()', () => {
  it('keeps pre-existing features (and what they depend on), swaps only the derived ones', () => {
    const merged = mergeDerivedFeatures(new Set(['captions', 'stats', 'ingest', 'radio']), new Set(['captions', 'ingest']), new Set(['captions', 'translations']));
    assert.deepEqual(sorted(merged), ['captions', 'ingest', 'radio', 'stats', 'translations']);
  });

  it('adds dependencies of newly derived features', () => {
    const merged = mergeDerivedFeatures(new Set(), new Set(), new Set(['stt-server']));
    assert.deepEqual(sorted(merged), ['ingest', 'stt-server']);
  });
});

describe('describeFlow()', () => {
  it('is empty for no features and returns flow ids (graphics-server wins over graphics-client)', () => {
    assert.deepEqual(describeFlow(new Set()), []);
    assert.deepEqual(describeFlow(new Set(['graphics-server', 'graphics-client'])), ['graphics-server']);
  });
});

describe('visibleQuestions()', () => {
  it('shows only questions of chosen intents', () => {
    const ids = visibleQuestions(['video']).map(q => q.id);
    assert.ok(ids.includes('relay') && !ids.includes('captionSource'));
  });

  it('STT location appears only after choosing to transcribe', () => {
    assert.ok(!visibleQuestions(['captions'], {}).some(q => q.id === 'sttLocation'));
    assert.ok(visibleQuestions(['captions'], { captionSource: 'transcribe' }).some(q => q.id === 'sttLocation'));
  });
});

describe('capability tables are consistent', () => {
  it('question ids are unique and belong to a known intent', () => {
    const ids = QUESTIONS.map(q => q.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const q of QUESTIONS) assert.ok(INTENTS.includes(q.intent), q.id);
  });

  it('every flag a rule enables is a real backend feature code the wizard knows', () => {
    for (const rule of FEATURE_RULES) {
      for (const code of rule.enable) {
        assert.ok(KNOWN_FEATURE_CODES.has(code) && ALL_FEATURE_CODES.includes(code), code);
      }
    }
  });

  it('prerequisite ids are unique and kinds are valid', () => {
    const ids = PREREQUISITES.map(p => p.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const p of PREREQUISITES) assert.ok(['configuration', 'operational', 'optional'].includes(p.kind), p.id);
  });
});
