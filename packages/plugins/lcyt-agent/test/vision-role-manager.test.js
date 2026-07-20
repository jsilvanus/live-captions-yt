import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { VisionRoleManager } from '../src/vision-role-manager.js';
import { RolesBus } from '../src/roles-bus.js';

const realFetch = global.fetch;
afterEach(() => { global.fetch = realFetch; });

function mockPreviewAndVisionApi({ visionResponse }) {
  global.fetch = async (url) => {
    if (typeof url === 'string' && url.includes('/preview/')) {
      return { ok: true, status: 200, arrayBuffer: async () => Buffer.from('jpeg-bytes') };
    }
    return { ok: true, json: async () => visionResponse };
  };
}

function makeBusSpy(apiKey, roleCode) {
  const events = [];
  const bus = new RolesBus();
  const fakeRes = { write: (chunk) => events.push(chunk), set() {}, flushHeaders() {} };
  bus.addSubscriber(apiKey, roleCode, fakeRes);
  return { bus, events };
}

describe('VisionRoleManager — tracker', () => {
  test('start() begins polling and emits tracker_update with parsed objects', async () => {
    mockPreviewAndVisionApi({
      visionResponse: { choices: [{ message: { content: '{"objects":[{"label":"person","confidence":0.9,"bbox":{"x":0.1,"y":0.1,"w":0.2,"h":0.3}}]}' } }] },
    });
    const { bus, events } = makeBusSpy('key1', 'tracker');
    const manager = new VisionRoleManager(bus);
    const result = manager.start('key1', 'tracker', {
      apiSettings: { apiUrl: 'https://api.openai.com', apiKey: 'sk-x', model: 'gpt-4o-mini' },
      vendor: 'openai',
      harnessConfig: { pollIntervalMs: 15 },
    });
    assert.equal(result.ok, true);

    await new Promise((r) => setTimeout(r, 60));
    manager.stop('key1', 'tracker');

    const update = events.find((e) => e.includes('tracker_update'));
    assert.ok(update);
    const payload = JSON.parse(update.match(/data: (.+)\n\n/)[1]);
    assert.equal(payload.objects.length, 1);
    assert.equal(payload.objects[0].label, 'person');
    assert.deepEqual(payload.objects[0].bbox, { x: 0.1, y: 0.1, w: 0.2, h: 0.3 });
  });

  test('malformed/missing objects array defaults to an empty array, not a crash', async () => {
    mockPreviewAndVisionApi({ visionResponse: { choices: [{ message: { content: 'not json at all' } }] } });
    const { bus, events } = makeBusSpy('key1', 'tracker');
    const manager = new VisionRoleManager(bus);
    manager.start('key1', 'tracker', {
      apiSettings: { apiUrl: 'https://api.openai.com', apiKey: 'sk-x', model: 'gpt-4o-mini' },
      vendor: 'openai', harnessConfig: { pollIntervalMs: 15 },
    });
    await new Promise((r) => setTimeout(r, 40));
    manager.stop('key1', 'tracker');
    const update = events.find((e) => e.includes('tracker_update'));
    const payload = JSON.parse(update.match(/data: (.+)\n\n/)[1]);
    assert.deepEqual(payload.objects, []);
  });

  test('returns { ok: false } for an unknown vendor', () => {
    const manager = new VisionRoleManager(new RolesBus());
    const result = manager.start('key1', 'tracker', {
      apiSettings: { apiUrl: 'https://x', apiKey: 'k', model: 'm' }, vendor: 'nonsense', harnessConfig: {},
    });
    assert.equal(result.ok, false);
  });

  test('status() reflects running state and lastUpdateAt after a successful analysis', async () => {
    mockPreviewAndVisionApi({ visionResponse: { choices: [{ message: { content: '{"objects":[]}' } }] } });
    const manager = new VisionRoleManager(new RolesBus());
    assert.deepEqual(manager.status('key1', 'tracker'), { running: false, lastUpdateAt: null, lastError: null });
    manager.start('key1', 'tracker', {
      apiSettings: { apiUrl: 'https://api.openai.com', apiKey: 'sk-x', model: 'gpt-4o-mini' },
      vendor: 'openai', harnessConfig: { pollIntervalMs: 15 },
    });
    await new Promise((r) => setTimeout(r, 40));
    const status = manager.status('key1', 'tracker');
    assert.equal(status.running, true);
    assert.ok(status.lastUpdateAt);
    manager.stop('key1', 'tracker');
    assert.equal(manager.status('key1', 'tracker').running, false);
  });

  test('stop() returns false when nothing was running', () => {
    const manager = new VisionRoleManager(new RolesBus());
    assert.equal(manager.stop('key1', 'tracker'), false);
  });

  test('start() is idempotent per (apiKey, roleCode) — a second call reports alreadyRunning', async () => {
    mockPreviewAndVisionApi({ visionResponse: { choices: [{ message: { content: '{"objects":[]}' } }] } });
    const manager = new VisionRoleManager(new RolesBus());
    const first = manager.start('key1', 'tracker', {
      apiSettings: { apiUrl: 'https://api.openai.com', apiKey: 'sk-x', model: 'gpt-4o-mini' },
      vendor: 'openai', harnessConfig: {},
    });
    const second = manager.start('key1', 'tracker', {
      apiSettings: { apiUrl: 'https://api.openai.com', apiKey: 'sk-x', model: 'gpt-4o-mini' },
      vendor: 'openai', harnessConfig: {},
    });
    assert.equal(first.ok, true);
    assert.equal(second.alreadyRunning, true);
    manager.stop('key1', 'tracker');
  });

  test('sessions for different roleCodes on the same apiKey are independent', async () => {
    mockPreviewAndVisionApi({ visionResponse: { choices: [{ message: { content: 'A busy scene.' } }] } });
    const manager = new VisionRoleManager(new RolesBus());
    manager.start('key1', 'tracker', { apiSettings: { apiUrl: 'https://api.openai.com', apiKey: 'k', model: 'm' }, vendor: 'openai', harnessConfig: {} });
    manager.start('key1', 'describer', { apiSettings: { apiUrl: 'https://api.openai.com', apiKey: 'k', model: 'm' }, vendor: 'openai', harnessConfig: {} });
    assert.equal(manager.status('key1', 'tracker').running, true);
    assert.equal(manager.status('key1', 'describer').running, true);
    assert.equal(manager.stop('key1', 'tracker'), true);
    assert.equal(manager.status('key1', 'tracker').running, false);
    assert.equal(manager.status('key1', 'describer').running, true);
    manager.stop('key1', 'describer');
  });
});

describe('VisionRoleManager — describer', () => {
  test('emits describer_update with text output by default', async () => {
    mockPreviewAndVisionApi({ visionResponse: { choices: [{ message: { content: 'A person walks across the stage.' } }] } });
    const { bus, events } = makeBusSpy('key1', 'describer');
    const manager = new VisionRoleManager(bus);
    manager.start('key1', 'describer', {
      apiSettings: { apiUrl: 'https://api.openai.com', apiKey: 'sk-x', model: 'gpt-4o-mini' },
      vendor: 'openai', harnessConfig: { pollIntervalMs: 15 },
    });
    await new Promise((r) => setTimeout(r, 40));
    manager.stop('key1', 'describer');
    const update = events.find((e) => e.includes('describer_update'));
    const payload = JSON.parse(update.match(/data: (.+)\n\n/)[1]);
    assert.equal(payload.text, 'A person walks across the stage.');
    assert.equal(payload.json, null);
  });

  test('emits describer_update with structured json when outputMode is json', async () => {
    mockPreviewAndVisionApi({ visionResponse: { choices: [{ message: { content: '{"scene":"stage"}' } }] } });
    const { bus, events } = makeBusSpy('key1', 'describer');
    const manager = new VisionRoleManager(bus);
    manager.start('key1', 'describer', {
      apiSettings: { apiUrl: 'https://api.openai.com', apiKey: 'sk-x', model: 'gpt-4o-mini' },
      vendor: 'openai', harnessConfig: { pollIntervalMs: 15, outputMode: 'json' },
    });
    await new Promise((r) => setTimeout(r, 40));
    manager.stop('key1', 'describer');
    const update = events.find((e) => e.includes('describer_update'));
    const payload = JSON.parse(update.match(/data: (.+)\n\n/)[1]);
    assert.deepEqual(payload.json, { scene: 'stage' });
  });
});

describe('VisionRoleManager — capture ring buffer', () => {
  test('records a capture (prompt + result) per successful frame, most recent first', async () => {
    mockPreviewAndVisionApi({
      visionResponse: { choices: [{ message: { content: '{"objects":[{"label":"person","confidence":0.5,"bbox":{"x":0,"y":0,"w":1,"h":1}}]}' } }] },
    });
    const manager = new VisionRoleManager(new RolesBus());
    manager.start('key1', 'tracker', {
      apiSettings: { apiUrl: 'https://api.openai.com', apiKey: 'sk-x', model: 'gpt-4o-mini' },
      vendor: 'openai', harnessConfig: { pollIntervalMs: 15, targetLabel: 'goalkeeper' },
    });
    await new Promise((r) => setTimeout(r, 50));
    manager.stop('key1', 'tracker');

    const captures = manager.getCaptures('key1', 'tracker');
    assert.ok(captures.length >= 2, 'more than one poll happened');
    for (const c of captures) {
      assert.ok(c.id);
      assert.ok(c.ts);
      assert.match(c.prompt, /goalkeeper/);
      assert.equal(c.error, null);
      assert.deepEqual(c.result.json.objects[0].label, 'person');
      assert.equal(c.frame, undefined, 'list entries omit the raw frame buffer');
    }
    // newest first
    assert.ok(captures[0].ts >= captures[captures.length - 1].ts);
  });

  test('bounds the buffer to the last 20 entries per (apiKey, roleCode), evicting the oldest', async () => {
    mockPreviewAndVisionApi({ visionResponse: { choices: [{ message: { content: '{"objects":[]}' } }] } });
    const manager = new VisionRoleManager(new RolesBus());
    manager.start('key1', 'tracker', {
      apiSettings: { apiUrl: 'https://api.openai.com', apiKey: 'sk-x', model: 'gpt-4o-mini' },
      vendor: 'openai', harnessConfig: { pollIntervalMs: 5 },
    });
    await new Promise((r) => setTimeout(r, 250)); // well over 20 polls at 5ms
    manager.stop('key1', 'tracker');

    const captures = manager.getCaptures('key1', 'tracker');
    assert.ok(captures.length <= 20, `expected <= 20 captures, got ${captures.length}`);
    assert.equal(captures.length, 20, 'buffer fills to the cap given enough polls');
  });

  test('captures are isolated per (apiKey, roleCode) and survive stop()', async () => {
    mockPreviewAndVisionApi({ visionResponse: { choices: [{ message: { content: 'a scene' } }] } });
    const manager = new VisionRoleManager(new RolesBus());
    manager.start('key1', 'describer', {
      apiSettings: { apiUrl: 'https://api.openai.com', apiKey: 'sk-x', model: 'gpt-4o-mini' },
      vendor: 'openai', harnessConfig: { pollIntervalMs: 15 },
    });
    await new Promise((r) => setTimeout(r, 40));
    manager.stop('key1', 'describer');

    assert.ok(manager.getCaptures('key1', 'describer').length > 0);
    assert.deepEqual(manager.getCaptures('key1', 'tracker'), []);
    assert.deepEqual(manager.getCaptures('key2', 'describer'), []);
  });

  test('a failed analysis is still captured, with the error recorded and no result', async () => {
    let call = 0;
    global.fetch = async (url) => {
      if (typeof url === 'string' && url.includes('/preview/')) {
        return { ok: true, status: 200, arrayBuffer: async () => Buffer.from('x') };
      }
      call++;
      return { ok: false, status: 500, text: async () => 'boom' };
    };
    const manager = new VisionRoleManager(new RolesBus());
    manager.start('key1', 'tracker', {
      apiSettings: { apiUrl: 'https://api.openai.com', apiKey: 'sk-x', model: 'gpt-4o-mini' },
      vendor: 'openai', harnessConfig: { pollIntervalMs: 15 },
    });
    await new Promise((r) => setTimeout(r, 40));
    manager.stop('key1', 'tracker');

    const captures = manager.getCaptures('key1', 'tracker');
    assert.ok(captures.length > 0);
    assert.equal(captures[0].result, null);
    assert.match(captures[0].error, /500/);
  });

  test('getCapture() returns the full entry including the frame buffer; unknown id returns null', async () => {
    mockPreviewAndVisionApi({ visionResponse: { choices: [{ message: { content: '{"objects":[]}' } }] } });
    const manager = new VisionRoleManager(new RolesBus());
    manager.start('key1', 'tracker', {
      apiSettings: { apiUrl: 'https://api.openai.com', apiKey: 'sk-x', model: 'gpt-4o-mini' },
      vendor: 'openai', harnessConfig: { pollIntervalMs: 15 },
    });
    await new Promise((r) => setTimeout(r, 30));
    manager.stop('key1', 'tracker');

    const [summary] = manager.getCaptures('key1', 'tracker');
    const full = manager.getCapture('key1', 'tracker', summary.id);
    assert.ok(Buffer.isBuffer(full.frame));
    assert.equal(manager.getCapture('key1', 'tracker', 'nonexistent'), null);
  });
});

describe('VisionRoleManager — replay (prompt sandbox)', () => {
  test('re-runs analyse() against the captured frame with an overridden prompt and diffs against the original', async () => {
    let seenPrompts = [];
    global.fetch = async (url, init) => {
      if (typeof url === 'string' && url.includes('/preview/')) {
        return { ok: true, status: 200, arrayBuffer: async () => Buffer.from('jpeg-bytes') };
      }
      const body = JSON.parse(init.body);
      const promptText = body.messages[0].content.find((c) => c.type === 'text').text;
      seenPrompts.push(promptText);
      const label = promptText.includes('OVERRIDE') ? 'dog' : 'person';
      return { ok: true, json: async () => ({ choices: [{ message: { content: `{"objects":[{"label":"${label}","confidence":0.9,"bbox":{"x":0,"y":0,"w":1,"h":1}}]}` } }] }) };
    };
    const manager = new VisionRoleManager(new RolesBus());
    manager.start('key1', 'tracker', {
      apiSettings: { apiUrl: 'https://api.openai.com', apiKey: 'sk-x', model: 'gpt-4o-mini' },
      vendor: 'openai', harnessConfig: { pollIntervalMs: 15 },
    });
    await new Promise((r) => setTimeout(r, 30));
    manager.stop('key1', 'tracker');

    const [capture] = manager.getCaptures('key1', 'tracker');
    const result = await manager.replay('key1', 'tracker', capture.id, {
      apiSettings: { apiUrl: 'https://api.openai.com', apiKey: 'sk-x', model: 'gpt-4o-mini' },
      vendor: 'openai',
      promptOverride: 'OVERRIDE: find the dog instead',
    });

    assert.equal(result.ok, true);
    assert.equal(result.original.result.json.objects[0].label, 'person');
    assert.equal(result.replay.result.json.objects[0].label, 'dog');
    assert.equal(result.replay.prompt, 'OVERRIDE: find the dog instead');
    assert.doesNotMatch(seenPrompts[0], /OVERRIDE/, 'the original poll used the built prompt, not the override');
  });

  test('an empty/whitespace promptOverride falls back to the original prompt', async () => {
    mockPreviewAndVisionApi({ visionResponse: { choices: [{ message: { content: '{"objects":[]}' } }] } });
    const manager = new VisionRoleManager(new RolesBus());
    manager.start('key1', 'tracker', {
      apiSettings: { apiUrl: 'https://api.openai.com', apiKey: 'sk-x', model: 'gpt-4o-mini' },
      vendor: 'openai', harnessConfig: { pollIntervalMs: 15 },
    });
    await new Promise((r) => setTimeout(r, 30));
    manager.stop('key1', 'tracker');

    const [capture] = manager.getCaptures('key1', 'tracker');
    const result = await manager.replay('key1', 'tracker', capture.id, {
      apiSettings: { apiUrl: 'https://api.openai.com', apiKey: 'sk-x', model: 'gpt-4o-mini' },
      vendor: 'openai',
      promptOverride: '   ',
    });
    assert.equal(result.replay.prompt, capture.prompt);
  });

  test('returns { ok: false } for an unknown capture id', async () => {
    const manager = new VisionRoleManager(new RolesBus());
    const result = await manager.replay('key1', 'tracker', 'nonexistent', {
      apiSettings: { apiUrl: 'https://api.openai.com', apiKey: 'sk-x', model: 'gpt-4o-mini' },
      vendor: 'openai',
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /not found/i);
  });

  test('returns { ok: false } for an unknown vendor', async () => {
    mockPreviewAndVisionApi({ visionResponse: { choices: [{ message: { content: '{"objects":[]}' } }] } });
    const manager = new VisionRoleManager(new RolesBus());
    manager.start('key1', 'tracker', {
      apiSettings: { apiUrl: 'https://api.openai.com', apiKey: 'sk-x', model: 'gpt-4o-mini' },
      vendor: 'openai', harnessConfig: { pollIntervalMs: 15 },
    });
    await new Promise((r) => setTimeout(r, 30));
    manager.stop('key1', 'tracker');
    const [capture] = manager.getCaptures('key1', 'tracker');
    const result = await manager.replay('key1', 'tracker', capture.id, {
      apiSettings: { apiUrl: 'https://x', apiKey: 'k', model: 'm' },
      vendor: 'nonsense',
    });
    assert.equal(result.ok, false);
  });

  test('does not increase the poll loop cadence or capture count — replay is a one-shot call', async () => {
    mockPreviewAndVisionApi({ visionResponse: { choices: [{ message: { content: '{"objects":[]}' } }] } });
    const manager = new VisionRoleManager(new RolesBus());
    manager.start('key1', 'tracker', {
      apiSettings: { apiUrl: 'https://api.openai.com', apiKey: 'sk-x', model: 'gpt-4o-mini' },
      vendor: 'openai', harnessConfig: { pollIntervalMs: 15 },
    });
    await new Promise((r) => setTimeout(r, 30));
    manager.stop('key1', 'tracker');
    const before = manager.getCaptures('key1', 'tracker').length;

    const [capture] = manager.getCaptures('key1', 'tracker');
    await manager.replay('key1', 'tracker', capture.id, {
      apiSettings: { apiUrl: 'https://api.openai.com', apiKey: 'sk-x', model: 'gpt-4o-mini' },
      vendor: 'openai',
      promptOverride: 'something else',
    });

    assert.equal(manager.getCaptures('key1', 'tracker').length, before, 'replay does not add a new ring-buffer entry');
  });
});

describe('VisionRoleManager — error resilience', () => {
  test('an adapter error during analysis does not crash the loop or stop the fetcher', async () => {
    let call = 0;
    global.fetch = async (url) => {
      if (typeof url === 'string' && url.includes('/preview/')) {
        return { ok: true, status: 200, arrayBuffer: async () => Buffer.from('x') };
      }
      call++;
      return { ok: false, status: 500, text: async () => 'boom' };
    };
    const manager = new VisionRoleManager(new RolesBus());
    manager.start('key1', 'tracker', {
      apiSettings: { apiUrl: 'https://api.openai.com', apiKey: 'sk-x', model: 'gpt-4o-mini' },
      vendor: 'openai', harnessConfig: { pollIntervalMs: 15 },
    });
    await new Promise((r) => setTimeout(r, 60));
    const status = manager.status('key1', 'tracker');
    assert.equal(status.running, true, 'the fetcher keeps polling despite the API error');
    assert.match(status.lastError, /500/);
    manager.stop('key1', 'tracker');
    assert.ok(call > 1, 'more than one analysis attempt happened');
  });
});
