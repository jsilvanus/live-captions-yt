import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { ProductionAssistantManager, AUTO_COOLDOWN_FLOOR_MS } from '../src/production-assistant.js';
import { RolesBus } from '../src/roles-bus.js';

const realFetch = global.fetch;
afterEach(() => { global.fetch = realFetch; });

const TOOLS = [
  { name: 'camera.preset', description: 'x', inputSchema: { type: 'object', properties: {} }, annotations: { destructiveHint: true } },
  { name: 'mixer.switch', description: 'x', inputSchema: { type: 'object', properties: {} }, annotations: { destructiveHint: true } },
];

function makeFakeAgent() {
  const contexts = new Map();
  return {
    addContext: (apiKey, type, text) => {
      if (!contexts.has(apiKey)) contexts.set(apiKey, []);
      contexts.get(apiKey).push({ type, text, ts: Date.now() });
    },
    getContext: (apiKey) => contexts.get(apiKey) ?? [],
  };
}

function mockProposesPreset() {
  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      choices: [{
        message: {
          role: 'assistant', content: 'Switching to the wide shot.',
          tool_calls: [{ id: 'c1', function: { name: 'camera.preset', arguments: '{"cameraId":"cam1","presetId":"wide"}' } }],
        },
      }],
    }),
  });
}

function mockNoAction() {
  global.fetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { role: 'assistant', content: 'Nothing to do.' } }] }) });
}

const apiSettings = { apiUrl: 'https://api.test', apiKey: 'sk-x', model: 'gpt-4o-mini' };

describe('ProductionAssistantManager.runTrigger', () => {
  test('confirm mode queues a suggestion and emits assistant_suggestion, without calling the tool', async () => {
    mockProposesPreset();
    const bus = new RolesBus();
    const events = [];
    const fakeRes = { write: (chunk) => events.push(chunk), set() {}, flushHeaders() {} };
    bus.addSubscriber('key1', 'assistant', fakeRes);

    const manager = new ProductionAssistantManager({}, bus);
    let called = false;
    const result = await manager.runTrigger({
      apiKey: 'key1', triggerText: 'camera looks static', agent: makeFakeAgent(),
      apiSettings, systemPrompt: 'sys', tools: TOOLS,
      callTool: async () => { called = true; return { ok: true }; },
      mode: 'confirm',
    });

    assert.equal(result.ok, true);
    assert.ok(result.suggestion);
    assert.equal(result.suggestion.tool, 'camera.preset');
    assert.equal(called, false, 'confirm mode never executes the tool directly');
    assert.equal(manager.listSuggestions('key1').length, 1);
    assert.ok(events.some((e) => e.includes('assistant_suggestion')));
  });

  test('auto mode executes the tool immediately and emits assistant_action as an audit record', async () => {
    mockProposesPreset();
    const bus = new RolesBus();
    const manager = new ProductionAssistantManager({}, bus);
    let calledWith = null;
    const result = await manager.runTrigger({
      apiKey: 'key1', agent: makeFakeAgent(), apiSettings, systemPrompt: 'sys', tools: TOOLS,
      callTool: async (name, args) => { calledWith = [name, args]; return { ok: true }; },
      mode: 'auto',
    });
    assert.equal(result.ok, true);
    assert.ok(result.action);
    assert.deepEqual(calledWith, ['camera.preset', { cameraId: 'cam1', presetId: 'wide' }]);
    assert.equal(manager.listSuggestions('key1').length, 0, 'auto mode never queues a suggestion');
  });

  test('when the LLM proposes no action, nothing is queued or executed', async () => {
    mockNoAction();
    const bus = new RolesBus();
    const manager = new ProductionAssistantManager({}, bus);
    const result = await manager.runTrigger({
      apiKey: 'key1', agent: makeFakeAgent(), apiSettings, systemPrompt: 'sys', tools: TOOLS,
      callTool: async () => ({ ok: true }), mode: 'auto',
    });
    assert.equal(result.ok, true);
    assert.equal(result.reply, 'Nothing to do.');
    assert.equal(manager.listSuggestions('key1').length, 0);
  });

  test('auto mode enforces a hard 3000ms cooldown floor regardless of a lower configured value', async () => {
    mockProposesPreset();
    const bus = new RolesBus();
    const manager = new ProductionAssistantManager({}, bus);
    const first = await manager.runTrigger({
      apiKey: 'key1', agent: makeFakeAgent(), apiSettings, systemPrompt: 'sys', tools: TOOLS,
      callTool: async () => ({ ok: true }), mode: 'auto', cooldownMs: 0,
    });
    assert.equal(first.skipped, undefined);
    const second = await manager.runTrigger({
      apiKey: 'key1', agent: makeFakeAgent(), apiSettings, systemPrompt: 'sys', tools: TOOLS,
      callTool: async () => ({ ok: true }), mode: 'auto', cooldownMs: 0,
    });
    assert.equal(second.skipped, 'cooldown');
  });

  test('confirm mode respects a configured cooldown of 0 (no floor applied)', async () => {
    mockProposesPreset();
    const bus = new RolesBus();
    const manager = new ProductionAssistantManager({}, bus);
    const first = await manager.runTrigger({
      apiKey: 'key1', agent: makeFakeAgent(), apiSettings, systemPrompt: 'sys', tools: TOOLS,
      callTool: async () => ({ ok: true }), mode: 'confirm', cooldownMs: 0,
    });
    assert.equal(first.skipped, undefined);
    const second = await manager.runTrigger({
      apiKey: 'key1', agent: makeFakeAgent(), apiSettings, systemPrompt: 'sys', tools: TOOLS,
      callTool: async () => ({ ok: true }), mode: 'confirm', cooldownMs: 0,
    });
    assert.equal(second.skipped, undefined, 'confirm mode with cooldownMs:0 has no floor');
  });

  test('cooldown is tracked per apiKey, not globally', async () => {
    mockProposesPreset();
    const bus = new RolesBus();
    const manager = new ProductionAssistantManager({}, bus);
    await manager.runTrigger({ apiKey: 'key1', agent: makeFakeAgent(), apiSettings, systemPrompt: 'sys', tools: TOOLS, callTool: async () => ({ ok: true }), mode: 'auto' });
    const otherKey = await manager.runTrigger({ apiKey: 'key2', agent: makeFakeAgent(), apiSettings, systemPrompt: 'sys', tools: TOOLS, callTool: async () => ({ ok: true }), mode: 'auto' });
    assert.equal(otherKey.skipped, undefined);
  });
});

describe('ProductionAssistantManager.confirmSuggestion / rejectSuggestion', () => {
  test('confirmSuggestion executes the queued tool call and removes it from the queue', async () => {
    mockProposesPreset();
    const bus = new RolesBus();
    const manager = new ProductionAssistantManager({}, bus);
    const { suggestion } = await manager.runTrigger({
      apiKey: 'key1', agent: makeFakeAgent(), apiSettings, systemPrompt: 'sys', tools: TOOLS,
      callTool: async () => ({ ok: true }), mode: 'confirm',
    });

    let executed = false;
    const result = await manager.confirmSuggestion('key1', suggestion.id, async (name, args) => { executed = true; return { ok: true, name, args }; });
    assert.equal(result.ok, true);
    assert.equal(executed, true);
    assert.equal(manager.listSuggestions('key1').length, 0);
  });

  test('confirmSuggestion 404s (ok:false) for an unknown id', async () => {
    const manager = new ProductionAssistantManager({}, new RolesBus());
    const result = await manager.confirmSuggestion('key1', 'no-such-id', async () => ({ ok: true }));
    assert.equal(result.ok, false);
  });

  test('rejectSuggestion removes it without executing', async () => {
    mockProposesPreset();
    const bus = new RolesBus();
    const manager = new ProductionAssistantManager({}, bus);
    const { suggestion } = await manager.runTrigger({
      apiKey: 'key1', agent: makeFakeAgent(), apiSettings, systemPrompt: 'sys', tools: TOOLS,
      callTool: async () => ({ ok: true }), mode: 'confirm',
    });
    assert.equal(manager.rejectSuggestion('key1', suggestion.id), true);
    assert.equal(manager.listSuggestions('key1').length, 0);
    assert.equal(manager.rejectSuggestion('key1', suggestion.id), false);
  });
});

test('AUTO_COOLDOWN_FLOOR_MS is exported and is 3000', () => {
  assert.equal(AUTO_COOLDOWN_FLOOR_MS, 3000);
});
