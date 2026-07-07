import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createToolRegistry } from '../src/index.js';

// ---------------------------------------------------------------------------
// Fake deps — each tool group's real dependency is a plain function/object;
// stub it out rather than pulling in real DB/plugin packages, since this
// module's job is the registry's own wiring, not re-testing each plugin's
// CRUD helpers (already covered by their own packages' tests).
// ---------------------------------------------------------------------------

function makeCaptionTargetsFake() {
  const targets = [{ id: 't1', type: 'youtube' }];
  return {
    getCaptionTargets: (db, apiKey) => targets.filter(() => apiKey === 'key1'),
    createCaptionTarget: (db, apiKey, fields) => ({ ok: true, target: { id: 'new', ...fields } }),
    updateCaptionTarget: (db, apiKey, id, patch) => ({ ok: true, target: { id, ...patch } }),
    deleteCaptionTarget: (db, apiKey, id) => id === 't1',
  };
}

function makeProductionFake() {
  const camera = { id: 'cam1', name: 'Cam 1', bridgeInstanceId: null };
  return {
    registry: {
      callPreset: async (id, presetId) => { registryCalls.push(['callPreset', id, presetId]); },
      switchSource: async (id, input) => { registryCalls.push(['switchSource', id, input]); },
    },
    bridgeManager: null,
    listCameras: () => [camera],
    getCameraById: (db, id) => (id === 'cam1' ? camera : null),
    createCamera: (db, registry, fields) => ({ ok: true, camera: { id: 'new-cam', ...fields } }),
    updateCamera: (db, registry, id, patch) => ({ ok: true, camera: { id, ...patch } }),
    deleteCamera: (db, registry, id) => (id === 'cam1' ? { ok: true } : { ok: false, error: 'Camera not found', status: 404 }),
    listMixers: () => [{ id: 'mix1', name: 'Mixer 1', bridgeInstanceId: null }],
    getMixerById: (db, registry, id) => (id === 'mix1' ? { id: 'mix1', bridgeInstanceId: null } : null),
    createMixer: (db, registry, fields) => ({ ok: true, mixer: { id: 'new-mix', ...fields } }),
    updateMixer: (db, registry, id, patch) => ({ ok: true, mixer: { id, ...patch } }),
    deleteMixer: (db, registry, id) => (id === 'mix1' ? { ok: true } : { ok: false, error: 'Mixer not found', status: 404 }),
    buildSwitchCommand: () => null,
  };
}
let registryCalls = [];

function makeAgentFake() {
  return {
    generateTemplate: async (apiKey, prompt, opts) => ({ background: 'transparent', layers: [], prompt, apiKey }),
    editTemplate: async (apiKey, template, prompt) => ({ ...template, edited: prompt }),
    suggestStyles: async (apiKey, template) => [{ name: 'Dark', description: 'x', changes: {} }],
  };
}

function makeAssetsFake() {
  const images = new Map([[1, { id: 1, apiKey: 'key1', settings: {} }]]);
  return {
    listImages: (db, apiKey) => [...images.values()].filter((i) => i.apiKey === apiKey),
    getImageByKey: (db, id, apiKey) => images.get(id) ?? null,
    updateImageSettings: (db, id, apiKey, settings) => {
      const row = images.get(id);
      if (!row || row.apiKey !== apiKey) return false;
      row.settings = settings;
      return true;
    },
    deleteImage: (db, id, apiKey) => {
      const row = images.get(id);
      if (!row || row.apiKey !== apiKey) return null;
      images.delete(id);
      return row;
    },
  };
}

function makeFullRegistry() {
  registryCalls = [];
  return createToolRegistry({
    db: {},
    captionTargets: makeCaptionTargetsFake(),
    production: makeProductionFake(),
    agent: makeAgentFake(),
    assets: makeAssetsFake(),
  });
}

describe('createToolRegistry', () => {
  it('assembles all 18 tools across the five groups', () => {
    const reg = makeFullRegistry();
    const names = reg.tools.map((t) => t.name).sort();
    assert.deepEqual(names, [
      'asset.delete', 'asset.list', 'asset.update',
      'camera.create', 'camera.delete', 'camera.list', 'camera.preset', 'camera.update',
      'caption_target.create', 'caption_target.delete', 'caption_target.list', 'caption_target.update',
      'dsk_template.edit', 'dsk_template.generate', 'dsk_template.suggest_styles',
      'mixer.create', 'mixer.delete', 'mixer.list', 'mixer.switch', 'mixer.update',
    ].sort());
  });

  it('only builds tool groups whose deps were provided', () => {
    const reg = createToolRegistry({ db: {}, agent: makeAgentFake() });
    assert.deepEqual(reg.tools.map((t) => t.name).sort(), [
      'dsk_template.edit', 'dsk_template.generate', 'dsk_template.suggest_styles',
    ]);
  });

  it('every destructive/state-changing tool has destructiveHint; list/get tools have readOnlyHint', () => {
    const reg = makeFullRegistry();
    const destructive = ['caption_target.delete', 'camera.delete', 'camera.preset', 'mixer.delete', 'mixer.switch', 'asset.delete'];
    const readOnly = ['caption_target.list', 'camera.list', 'mixer.list', 'asset.list', 'dsk_template.suggest_styles'];
    for (const name of destructive) {
      const tool = reg.tools.find((t) => t.name === name);
      assert.equal(tool.annotations?.destructiveHint, true, `${name} should have destructiveHint`);
    }
    for (const name of readOnly) {
      const tool = reg.tools.find((t) => t.name === name);
      assert.equal(tool.annotations?.readOnlyHint, true, `${name} should have readOnlyHint`);
    }
  });

  it('callTool rejects an unknown tool name', async () => {
    const reg = makeFullRegistry();
    await assert.rejects(() => reg.callTool('no.such.tool', {}, { apiKey: 'key1' }), /Unknown tool/);
  });

  it('callTool requires an apiKey in call context', async () => {
    const reg = makeFullRegistry();
    await assert.rejects(() => reg.callTool('camera.list', {}, {}), /requires an apiKey/);
  });

  describe('caption_target.* handlers', () => {
    it('list scopes by the call context apiKey', async () => {
      const reg = makeFullRegistry();
      const result = await reg.callTool('caption_target.list', {}, { apiKey: 'key1' });
      assert.equal(result.ok, true);
      assert.equal(result.targets.length, 1);
      const other = await reg.callTool('caption_target.list', {}, { apiKey: 'key2' });
      assert.equal(other.targets.length, 0);
    });

    it('delete returns ok:false for an unknown id', async () => {
      const reg = makeFullRegistry();
      const result = await reg.callTool('caption_target.delete', { id: 'nope' }, { apiKey: 'key1' });
      assert.equal(result.ok, false);
    });
  });

  describe('camera.preset', () => {
    it('calls registry.callPreset for a direct (non-bridge) camera', async () => {
      const reg = makeFullRegistry();
      const result = await reg.callTool('camera.preset', { cameraId: 'cam1', presetId: 'home' }, { apiKey: 'key1' });
      assert.equal(result.ok, true);
      assert.deepEqual(registryCalls, [['callPreset', 'cam1', 'home']]);
    });

    it('returns ok:false for an unknown camera', async () => {
      const reg = makeFullRegistry();
      const result = await reg.callTool('camera.preset', { cameraId: 'nope', presetId: 'x' }, { apiKey: 'key1' });
      assert.equal(result.ok, false);
    });
  });

  describe('mixer.switch', () => {
    it('calls registry.switchSource for a direct (non-bridge) mixer', async () => {
      const reg = makeFullRegistry();
      const result = await reg.callTool('mixer.switch', { mixerId: 'mix1', inputNumber: 3 }, { apiKey: 'key1' });
      assert.equal(result.ok, true);
      assert.deepEqual(registryCalls, [['switchSource', 'mix1', 3]]);
    });
  });

  describe('dsk_template.* handlers', () => {
    it('generate/edit/suggest_styles delegate to the AgentEngine with the call context apiKey', async () => {
      const reg = makeFullRegistry();
      const generated = await reg.callTool('dsk_template.generate', { prompt: 'lower third' }, { apiKey: 'key1' });
      assert.equal(generated.ok, true);
      assert.equal(generated.template.apiKey, 'key1');
      assert.equal(generated.template.prompt, 'lower third');

      const edited = await reg.callTool('dsk_template.edit', { template: { a: 1 }, prompt: 'darker' }, { apiKey: 'key1' });
      assert.equal(edited.template.edited, 'darker');

      const suggestions = await reg.callTool('dsk_template.suggest_styles', { template: {} }, { apiKey: 'key1' });
      assert.equal(suggestions.suggestions.length, 1);
    });
  });

  describe('asset.* handlers', () => {
    it('list/update/delete are scoped to the call context apiKey', async () => {
      const reg = makeFullRegistry();
      const listed = await reg.callTool('asset.list', {}, { apiKey: 'key1' });
      assert.equal(listed.assets.length, 1);

      const updated = await reg.callTool('asset.update', { id: 1, settings: { crop: true } }, { apiKey: 'key1' });
      assert.equal(updated.ok, true);
      assert.deepEqual(updated.asset.settings, { crop: true });

      // Wrong apiKey can't touch someone else's asset
      const wrongOwner = await reg.callTool('asset.update', { id: 1, settings: {} }, { apiKey: 'key2' });
      assert.equal(wrongOwner.ok, false);

      const deleted = await reg.callTool('asset.delete', { id: 1 }, { apiKey: 'key1' });
      assert.equal(deleted.ok, true);
    });
  });
});
