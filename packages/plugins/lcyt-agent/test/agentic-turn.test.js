import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  toOpenAiToolSchema, runAgenticTurn, defaultShouldExecute, makeDialogShouldExecute,
  resolveRoleProviderSettings, invokeModelCall,
} from '../src/agentic-turn.js';

const realFetch = global.fetch;
afterEach(() => { global.fetch = realFetch; });

const TOOLS = [
  { name: 'camera.list', description: 'List cameras', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true } },
  { name: 'camera.preset', description: 'Trigger preset', inputSchema: { type: 'object', properties: { cameraId: { type: 'string' } } }, annotations: { destructiveHint: true } },
  { name: 'caption_target.create', description: 'Create target', inputSchema: { type: 'object', properties: {} }, annotations: {} },
];

function createMockBridgeManager() {
  return {
    sendCommand: async () => ({ ok: true, status: 200, body: { choices: [{ message: { content: 'ok' } }] } }),
  };
}

function mockChatSequence(responses) {
  let call = 0;
  global.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    const response = responses[Math.min(call, responses.length - 1)];
    call++;
    return {
      ok: true,
      json: async () => ({ choices: [{ message: response(body) }] }),
    };
  };
  return () => call;
}

describe('toOpenAiToolSchema', () => {
  test('converts to the OpenAI function-calling wire shape', () => {
    const schema = toOpenAiToolSchema(TOOLS);
    assert.equal(schema.length, 3);
    assert.equal(schema[0].type, 'function');
    assert.equal(schema[0].function.name, 'camera.list');
    assert.deepEqual(schema[0].function.parameters, { type: 'object', properties: {} });
  });
});

describe('defaultShouldExecute / makeDialogShouldExecute', () => {
  test('defaultShouldExecute only allows readOnlyHint tools', () => {
    assert.equal(defaultShouldExecute('camera.list', { readOnlyHint: true }), true);
    assert.equal(defaultShouldExecute('camera.preset', { destructiveHint: true }), false);
    assert.equal(defaultShouldExecute('caption_target.create', {}), false);
  });

  test('makeDialogShouldExecute: readOnly always, destructive never, else per mode', () => {
    const confirm = makeDialogShouldExecute('confirm');
    const auto = makeDialogShouldExecute('auto');
    assert.equal(confirm('camera.list', { readOnlyHint: true }), true);
    assert.equal(auto('camera.list', { readOnlyHint: true }), true);
    assert.equal(confirm('camera.preset', { destructiveHint: true }), false);
    assert.equal(auto('camera.preset', { destructiveHint: true }), false, 'destructive never auto-executes in the turn loop');
    assert.equal(confirm('caption_target.create', {}), false);
    assert.equal(auto('caption_target.create', {}), true);
  });
});

describe('resolveRoleProviderSettings', () => {
  test('resolves a direct api-kind provider', () => {
    const settings = resolveRoleProviderSettings(
      { enabled: 1, bridge_instance_id: null, kind: 'api', base_url: 'https://api.openai.com', api_key_ref: 'sk-x' },
      'gpt-4o-mini',
    );
    assert.deepEqual(settings, { apiUrl: 'https://api.openai.com', apiKey: 'sk-x', model: 'gpt-4o-mini' });
  });

  test('returns null for a missing/disabled provider', () => {
    assert.equal(resolveRoleProviderSettings(null, 'gpt-4o-mini'), null);
    assert.equal(resolveRoleProviderSettings({ enabled: 0, base_url: 'https://x' }, 'm'), null);
  });

  test('resolves a bridge-relayed provider with bridge transport metadata', () => {
    const bridgeManager = createMockBridgeManager();
    const settings = resolveRoleProviderSettings(
      { enabled: 1, bridge_instance_id: 'bridge-1', kind: 'ollama', base_url: 'http://ollama:11434' },
      'llama3.1:8b',
      { bridgeManager },
    );
    assert.deepEqual(settings, {
      apiUrl: 'http://ollama:11434',
      apiKey: '',
      model: 'llama3.1:8b',
      transport: 'bridge',
      bridgeManager,
      bridgeInstanceId: 'bridge-1',
    });
  });

  test('invokeModelCall forwards bridge requests through the bridge manager', async () => {
    const sent = [];
    const bridgeManager = createMockBridgeManager();
    bridgeManager.sendCommand = async (instanceId, command) => {
      sent.push({ instanceId, command });
      return { ok: true, status: 200, body: { choices: [{ message: { content: 'ok' } }] } };
    };
    const settings = resolveRoleProviderSettings(
      { enabled: 1, bridge_instance_id: 'bridge-2', kind: 'ollama', base_url: 'http://ollama:11434' },
      'llama3.1:8b',
      { bridgeManager },
    );
    const result = await invokeModelCall(settings, { model: 'llama3.1:8b', messages: [] });
    assert.equal(result.body.choices[0].message.content, 'ok');
    assert.deepEqual(sent[0].command, {
      type: 'model_call',
      endpoint: 'http://ollama:11434/v1/chat/completions',
      headers: { 'Content-Type': 'application/json' },
      payload: { model: 'llama3.1:8b', messages: [] },
    });
  });

  test("returns null for a 'deer'-kind provider (not yet supported)", () => {
    const settings = resolveRoleProviderSettings({ enabled: 1, bridge_instance_id: null, kind: 'deer', base_url: '' }, 'm');
    assert.equal(settings, null);
  });

  test('returns null when base_url is empty', () => {
    const settings = resolveRoleProviderSettings({ enabled: 1, bridge_instance_id: null, kind: 'api', base_url: '' }, 'm');
    assert.equal(settings, null);
  });
});

describe('runAgenticTurn', () => {
  const apiSettings = { apiUrl: 'https://api.test', apiKey: 'sk-test', model: 'gpt-4o-mini' };

  test('a plain text reply with no tool calls returns done:true immediately', async () => {
    mockChatSequence([() => ({ role: 'assistant', content: 'Hello there!' })]);
    const result = await runAgenticTurn({
      apiSettings, systemPrompt: 'You are helpful.', messages: [{ role: 'user', content: 'hi' }],
      tools: TOOLS, callTool: async () => ({ ok: true }), apiKey: 'key1',
    });
    assert.equal(result.done, true);
    assert.equal(result.reply, 'Hello there!');
    assert.deepEqual(result.pendingActions, []);
  });

  test('executes a read-only tool call in-loop and continues to a final reply', async () => {
    const calls = [];
    mockChatSequence([
      () => ({ role: 'assistant', content: null, tool_calls: [{ id: 'c1', function: { name: 'camera.list', arguments: '{}' } }] }),
      () => ({ role: 'assistant', content: 'There are 2 cameras.' }),
    ]);
    const result = await runAgenticTurn({
      apiSettings, systemPrompt: 'sys', messages: [{ role: 'user', content: 'list cameras' }],
      tools: TOOLS,
      callTool: async (name, args) => { calls.push([name, args]); return { ok: true, cameras: [1, 2] }; },
      apiKey: 'key1',
    });
    assert.equal(result.done, true);
    assert.equal(result.reply, 'There are 2 cameras.');
    assert.deepEqual(calls, [['camera.list', {}]]);
    assert.equal(result.toolCalls.length, 1);
    assert.deepEqual(result.toolCalls[0].result, { ok: true, cameras: [1, 2] });
  });

  test('with the default gate, a non-readonly tool call is held back as a pending action', async () => {
    mockChatSequence([
      () => ({ role: 'assistant', content: 'I will trigger a preset.', tool_calls: [{ id: 'c1', function: { name: 'camera.preset', arguments: '{"cameraId":"cam1","presetId":"home"}' } }] }),
    ]);
    const result = await runAgenticTurn({
      apiSettings, systemPrompt: 'sys', messages: [{ role: 'user', content: 'go home' }],
      tools: TOOLS, callTool: async () => { throw new Error('should not be called'); }, apiKey: 'key1',
    });
    assert.equal(result.done, false);
    assert.deepEqual(result.pendingActions, [{ name: 'camera.preset', args: { cameraId: 'cam1', presetId: 'home' } }]);
  });

  test('makeDialogShouldExecute(auto) executes a non-destructive mutating tool directly', async () => {
    const calls = [];
    mockChatSequence([
      () => ({ role: 'assistant', content: null, tool_calls: [{ id: 'c1', function: { name: 'caption_target.create', arguments: '{"type":"youtube"}' } }] }),
      () => ({ role: 'assistant', content: 'Created.' }),
    ]);
    const result = await runAgenticTurn({
      apiSettings, systemPrompt: 'sys', messages: [{ role: 'user', content: 'add a target' }],
      tools: TOOLS,
      callTool: async (name, args) => { calls.push([name, args]); return { ok: true }; },
      apiKey: 'key1',
      shouldExecute: makeDialogShouldExecute('auto'),
    });
    assert.equal(result.done, true);
    assert.equal(result.reply, 'Created.');
    assert.deepEqual(calls, [['caption_target.create', { type: 'youtube' }]]);
  });

  test('a mixed batch (one holdable, one executable) holds the entire exchange back', async () => {
    mockChatSequence([
      () => ({
        role: 'assistant', content: null,
        tool_calls: [
          { id: 'c1', function: { name: 'camera.list', arguments: '{}' } },
          { id: 'c2', function: { name: 'camera.preset', arguments: '{"cameraId":"cam1","presetId":"home"}' } },
        ],
      }),
    ]);
    let called = false;
    const result = await runAgenticTurn({
      apiSettings, systemPrompt: 'sys', messages: [{ role: 'user', content: 'x' }],
      tools: TOOLS, callTool: async () => { called = true; return { ok: true }; }, apiKey: 'key1',
    });
    assert.equal(result.done, false);
    assert.equal(called, false, 'neither call executes when the batch is held');
    assert.equal(result.pendingActions.length, 2);
  });

  test('tool handler errors are captured as a tool result, not thrown', async () => {
    mockChatSequence([
      () => ({ role: 'assistant', content: null, tool_calls: [{ id: 'c1', function: { name: 'camera.list', arguments: '{}' } }] }),
      () => ({ role: 'assistant', content: 'Something went wrong.' }),
    ]);
    const result = await runAgenticTurn({
      apiSettings, systemPrompt: 'sys', messages: [{ role: 'user', content: 'x' }],
      tools: TOOLS, callTool: async () => { throw new Error('db down'); }, apiKey: 'key1',
    });
    assert.equal(result.done, true);
    assert.deepEqual(result.toolCalls[0].result, { ok: false, error: 'db down' });
  });

  test('malformed tool call arguments parse to {} rather than throwing', async () => {
    mockChatSequence([
      () => ({ role: 'assistant', content: null, tool_calls: [{ id: 'c1', function: { name: 'camera.list', arguments: 'not json' } }] }),
      () => ({ role: 'assistant', content: 'ok' }),
    ]);
    let receivedArgs;
    const result = await runAgenticTurn({
      apiSettings, systemPrompt: 'sys', messages: [{ role: 'user', content: 'x' }],
      tools: TOOLS, callTool: async (name, args) => { receivedArgs = args; return { ok: true }; }, apiKey: 'key1',
    });
    assert.equal(result.done, true);
    assert.deepEqual(receivedArgs, {});
  });

  test('respects maxIterations and returns truncated:true', async () => {
    global.fetch = async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'c1', function: { name: 'camera.list', arguments: '{}' } }] } }] }),
    });
    const result = await runAgenticTurn({
      apiSettings, systemPrompt: 'sys', messages: [{ role: 'user', content: 'x' }],
      tools: TOOLS, callTool: async () => ({ ok: true }), apiKey: 'key1', maxIterations: 2,
    });
    assert.equal(result.truncated, true);
    assert.equal(result.done, false);
  });

  test('a chat API failure returns done:true with an error, not a thrown exception', async () => {
    global.fetch = async () => ({ ok: false, status: 500, text: async () => 'server error' });
    const result = await runAgenticTurn({
      apiSettings, systemPrompt: 'sys', messages: [{ role: 'user', content: 'x' }],
      tools: TOOLS, callTool: async () => ({ ok: true }), apiKey: 'key1',
    });
    assert.equal(result.done, true);
    assert.match(result.error, /500/);
  });
});
