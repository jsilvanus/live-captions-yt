import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createBrevoSmsAdapter, isValidSmsSender, normalizeRecipient,
} from '../src/brevo-sms.js';
import { runAdapterContract } from './adapter-contract.js';

const SECRET = 'sms-secret-key';

function fakeFetch(response) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    if (response instanceof Error) throw response;
    return response;
  };
  return { fn, calls };
}

const created = (body = { messageId: 1511882900100020 }) => ({
  ok: true, status: 201, json: async () => body,
});

test('posts sender, recipient without +, content and transactional type', async () => {
  const f = fakeFetch(created());
  const a = createBrevoSmsAdapter({ apiKey: SECRET, sender: 'Kirkko', fetchImpl: f.fn });
  const r = await a.send({ to: '+358 40 123 4567', text: 'Ring the bells' });
  assert.deepEqual(r, { id: '1511882900100020' });
  const [call] = f.calls;
  assert.equal(call.url, 'https://api.brevo.com/v3/transactionalSMS/send');
  assert.equal(call.init.method, 'POST');
  assert.equal(call.init.headers['api-key'], SECRET);
  assert.deepEqual(JSON.parse(call.init.body), {
    sender: 'Kirkko', recipient: '358401234567', content: 'Ring the bells', type: 'transactional',
  });
});

test('rejects invalid recipient before any request', async () => {
  const f = fakeFetch(created());
  const a = createBrevoSmsAdapter({ apiKey: SECRET, sender: 'Kirkko', fetchImpl: f.fn });
  await assert.rejects(() => a.send({ to: 'not-a-number', text: 'x' }), /invalid recipient/);
  assert.equal(f.calls.length, 0);
});

test('HTTP 400 names the status and never the key', async () => {
  const f = fakeFetch({ ok: false, status: 400, json: async () => ({}) });
  const a = createBrevoSmsAdapter({ apiKey: SECRET, sender: 'Kirkko', fetchImpl: f.fn });
  await assert.rejects(() => a.send({ to: '358401234567', text: 'x' }), (err) => {
    assert.match(err.message, /HTTP 400/);
    assert.doesNotMatch(err.message, new RegExp(SECRET));
    return true;
  });
});

test('constructor checks the api key and the sender', () => {
  assert.throws(() => createBrevoSmsAdapter({ sender: 'Kirkko' }), /apiKey/);
  assert.throws(() => createBrevoSmsAdapter({ apiKey: SECRET, sender: 'Kirkko Seurakunta' }), /sender/);
});

test('sender rules: alphanumeric up to 11, numeric up to 15', () => {
  assert.equal(isValidSmsSender('Kirkko'), true);
  assert.equal(isValidSmsSender('12345678901234'), true);
  assert.equal(isValidSmsSender('Kirkko-Seurakunta'), false);
  assert.equal(isValidSmsSender('abcdefghijkl'), false);
  assert.equal(isValidSmsSender(''), false);
});

test('recipient normalisation', () => {
  assert.equal(normalizeRecipient('+358 40-123 4567'), '358401234567');
  assert.equal(normalizeRecipient('00358401234567'), '358401234567');
  assert.equal(normalizeRecipient('12'), null);
  assert.equal(normalizeRecipient(null), null);
});

runAdapterContract({
  name: 'brevo sms',
  channel: 'sms',
  provider: 'brevo',
  secret: SECRET,
  make: (fetchImpl) => createBrevoSmsAdapter({ apiKey: SECRET, sender: 'Kirkko', fetchImpl }),
  sample: { to: '+358401234567', text: 'hello' },
});
