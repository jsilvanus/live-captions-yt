import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBrevoEmailAdapter } from '../src/brevo-email.js';
import { runAdapterContract } from './adapter-contract.js';

function fakeFetch(response) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    if (response instanceof Error) throw response;
    return response;
  };
  return { fn, calls };
}

const okResponse = (body = { messageId: '<abc@smtp-relay>' }) => ({
  ok: true,
  status: 201,
  json: async () => body,
});

test('posts the transactional email with the api-key header', async () => {
  const f = fakeFetch(okResponse());
  const adapter = createBrevoEmailAdapter({
    apiKey: 'secret-key', senderEmail: 'noreply@example.org', senderName: 'Kirkko', fetchImpl: f.fn,
  });
  const r = await adapter.send({ to: 'warden@example.org', subject: 'Stream', text: 'Starting now' });
  assert.deepEqual(r, { id: '<abc@smtp-relay>' });
  const [call] = f.calls;
  assert.equal(call.url, 'https://api.brevo.com/v3/smtp/email');
  assert.equal(call.init.method, 'POST');
  assert.equal(call.init.headers['api-key'], 'secret-key');
  const body = JSON.parse(call.init.body);
  assert.deepEqual(body.sender, { email: 'noreply@example.org', name: 'Kirkko' });
  assert.deepEqual(body.to, [{ email: 'warden@example.org' }]);
  assert.equal(body.subject, 'Stream');
  assert.equal(body.textContent, 'Starting now');
});

test('HTTP errors name the status and never the key', async () => {
  const f = fakeFetch({ ok: false, status: 401, json: async () => ({}) });
  const adapter = createBrevoEmailAdapter({ apiKey: 'secret-key', senderEmail: 'a@b.c', fetchImpl: f.fn });
  await assert.rejects(
    () => adapter.send({ to: 'x@y.z', subject: 's', text: 't' }),
    (err) => {
      assert.match(err.message, /HTTP 401/);
      assert.doesNotMatch(err.message, /secret-key/);
      return true;
    },
  );
});

test('network errors are reported without the request details', async () => {
  const f = fakeFetch(new Error('getaddrinfo ENOTFOUND api.brevo.com secret-key'));
  const adapter = createBrevoEmailAdapter({ apiKey: 'secret-key', senderEmail: 'a@b.c', fetchImpl: f.fn });
  await assert.rejects(
    () => adapter.send({ to: 'x@y.z', subject: 's', text: 't' }),
    (err) => {
      assert.equal(err.message, 'brevo: request failed (network)');
      return true;
    },
  );
});

test('requires an api key and a sender address', () => {
  assert.throws(() => createBrevoEmailAdapter({ senderEmail: 'a@b.c' }), /apiKey/);
  assert.throws(() => createBrevoEmailAdapter({ apiKey: 'k' }), /senderEmail/);
});

runAdapterContract({
  name: 'brevo email',
  channel: 'email',
  provider: 'brevo',
  secret: 'secret-key',
  make: (fetchImpl) => createBrevoEmailAdapter({ apiKey: 'secret-key', senderEmail: 'a@b.c', fetchImpl }),
  sample: { to: 'x@y.z', subject: 's', text: 't' },
});
