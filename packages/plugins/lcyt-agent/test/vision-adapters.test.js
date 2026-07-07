import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { OpenAiVisionAdapter } from '../src/vision-adapters/openai-vision.js';
import { GoogleVisionAdapter } from '../src/vision-adapters/google-vision.js';
import { AnthropicVisionAdapter } from '../src/vision-adapters/anthropic-vision.js';
import { createVisionAdapter } from '../src/vision-adapters/index.js';

const realFetch = global.fetch;
afterEach(() => { global.fetch = realFetch; });

const IMG = Buffer.from('fake-jpeg-bytes');

describe('OpenAiVisionAdapter', () => {
  test('sends image_url content parts and parses text output', async () => {
    let sentBody = null;
    global.fetch = async (url, init) => {
      sentBody = JSON.parse(init.body);
      return { ok: true, json: async () => ({ choices: [{ message: { content: 'A person on stage' } }] }) };
    };
    const adapter = new OpenAiVisionAdapter({ model: 'gpt-4o-mini', apiKey: 'sk-x', apiUrl: 'https://api.openai.com' });
    const result = await adapter.analyse([IMG], 'Describe the scene');

    assert.equal(sentBody.model, 'gpt-4o-mini');
    assert.equal(sentBody.messages[0].content[0].text, 'Describe the scene');
    assert.match(sentBody.messages[0].content[1].image_url.url, /^data:image\/jpeg;base64,/);
    assert.equal(result.text, 'A person on stage');
    assert.equal(result.json, null);
  });

  test('json outputMode sets response_format and parses JSON', async () => {
    let sentBody = null;
    global.fetch = async (url, init) => {
      sentBody = JSON.parse(init.body);
      return { ok: true, json: async () => ({ choices: [{ message: { content: '{"objects":[]}' } }] }) };
    };
    const adapter = new OpenAiVisionAdapter({ model: 'gpt-4o-mini', apiKey: 'sk-x', apiUrl: 'https://api.openai.com' });
    const result = await adapter.analyse([IMG], 'Track the person', { outputMode: 'json' });
    assert.deepEqual(sentBody.response_format, { type: 'json_object' });
    assert.deepEqual(result.json, { objects: [] });
    assert.equal(result.text, null);
  });

  test('throws with status and body on a non-ok response', async () => {
    global.fetch = async () => ({ ok: false, status: 429, text: async () => 'rate limited' });
    const adapter = new OpenAiVisionAdapter({ model: 'm', apiKey: 'k', apiUrl: 'https://api.openai.com' });
    await assert.rejects(() => adapter.analyse([IMG], 'x'), /429/);
  });
});

describe('GoogleVisionAdapter', () => {
  test('sends inline_data parts and the API key as a query param', async () => {
    let requestedUrl = null;
    let sentBody = null;
    global.fetch = async (url, init) => {
      requestedUrl = url;
      sentBody = JSON.parse(init.body);
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: 'A wide shot' }] } }] }) };
    };
    const adapter = new GoogleVisionAdapter({ model: 'gemini-1.5-flash', apiKey: 'g-key', apiUrl: 'https://generativelanguage.googleapis.com' });
    const result = await adapter.analyse([IMG], 'Describe');
    assert.match(requestedUrl, /models\/gemini-1\.5-flash:generateContent\?key=g-key$/);
    assert.equal(sentBody.contents[0].parts[0].text, 'Describe');
    assert.equal(sentBody.contents[0].parts[1].inline_data.mime_type, 'image/jpeg');
    assert.equal(result.text, 'A wide shot');
  });

  test('json outputMode sets responseMimeType and parses JSON', async () => {
    let sentBody = null;
    global.fetch = async (url, init) => {
      sentBody = JSON.parse(init.body);
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"label":"chat"}' } ] } }] }) };
    };
    const adapter = new GoogleVisionAdapter({ model: 'gemini-1.5-flash', apiKey: 'g-key', apiUrl: 'https://generativelanguage.googleapis.com' });
    const result = await adapter.analyse([IMG], 'x', { outputMode: 'json' });
    assert.equal(sentBody.generationConfig.responseMimeType, 'application/json');
    assert.deepEqual(result.json, { label: 'chat' });
  });

  test('throws with status and body on a non-ok response', async () => {
    global.fetch = async () => ({ ok: false, status: 403, text: async () => 'forbidden' });
    const adapter = new GoogleVisionAdapter({ model: 'm', apiKey: 'k', apiUrl: 'https://x' });
    await assert.rejects(() => adapter.analyse([IMG], 'x'), /403/);
  });
});

describe('AnthropicVisionAdapter', () => {
  test('sends base64 image content blocks with the right headers', async () => {
    let sentHeaders = null;
    let sentBody = null;
    global.fetch = async (url, init) => {
      sentHeaders = init.headers;
      sentBody = JSON.parse(init.body);
      return { ok: true, json: async () => ({ content: [{ text: 'Two cameras visible' }] }) };
    };
    const adapter = new AnthropicVisionAdapter({ model: 'claude-opus-4-8', apiKey: 'ak-x', apiUrl: 'https://api.anthropic.com' });
    const result = await adapter.analyse([IMG], 'Describe');
    assert.equal(sentHeaders['x-api-key'], 'ak-x');
    assert.equal(sentHeaders['anthropic-version'], '2023-06-01');
    assert.equal(sentBody.messages[0].content[1].source.media_type, 'image/jpeg');
    assert.equal(result.text, 'Two cameras visible');
  });

  test('json outputMode appends a JSON-only instruction and parses the reply', async () => {
    let sentBody = null;
    global.fetch = async (url, init) => {
      sentBody = JSON.parse(init.body);
      return { ok: true, json: async () => ({ content: [{ text: '{"ok":true}' }] }) };
    };
    const adapter = new AnthropicVisionAdapter({ model: 'm', apiKey: 'k', apiUrl: 'https://api.anthropic.com' });
    const result = await adapter.analyse([IMG], 'Track', { outputMode: 'json' });
    assert.match(sentBody.messages[0].content[0].text, /JSON only/);
    assert.deepEqual(result.json, { ok: true });
  });

  test('throws with status and body on a non-ok response', async () => {
    global.fetch = async () => ({ ok: false, status: 500, text: async () => 'server error' });
    const adapter = new AnthropicVisionAdapter({ model: 'm', apiKey: 'k', apiUrl: 'https://x' });
    await assert.rejects(() => adapter.analyse([IMG], 'x'), /500/);
  });
});

describe('createVisionAdapter', () => {
  test('resolves openai/google/anthropic/custom to the right adapter classes', () => {
    assert.ok(createVisionAdapter('openai', { model: 'm', apiKey: 'k', apiUrl: 'https://x' }) instanceof OpenAiVisionAdapter);
    assert.ok(createVisionAdapter('google', { model: 'm', apiKey: 'k', apiUrl: 'https://x' }) instanceof GoogleVisionAdapter);
    assert.ok(createVisionAdapter('anthropic', { model: 'm', apiKey: 'k', apiUrl: 'https://x' }) instanceof AnthropicVisionAdapter);
    assert.ok(createVisionAdapter('custom', { model: 'm', apiKey: 'k', apiUrl: 'https://x' }) instanceof OpenAiVisionAdapter);
  });

  test('throws for an unknown vendor', () => {
    assert.throws(() => createVisionAdapter('unknown-vendor', {}), /No vision adapter/);
  });
});
