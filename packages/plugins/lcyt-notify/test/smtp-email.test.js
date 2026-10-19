import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSmtpEmailAdapter } from '../src/smtp-email.js';
import { runAdapterContract } from './adapter-contract.js';

const PASS = 'smtp-secret-pass';

// A fake transport: the contract passes a fake fetch, so translate it into sendMail.
function fakeTransportFrom(fetchImpl) {
  const sent = [];
  return {
    sent,
    factory: (opts) => {
      sent.push({ opts });
      return {
        sendMail: async (mail) => {
          const res = await fetchImpl('smtp://relay', { mail });
          if (!res.ok) {
            const err = new Error(`535 auth failed for ${PASS}`);
            err.responseCode = res.status;
            throw err;
          }
          const data = await res.json();
          return { messageId: data.messageId };
        },
      };
    },
  };
}

test('passes host, port, auth and sends mail with from, to, subject and text', async () => {
  const seen = [];
  const t = fakeTransportFrom(async (_url, init) => {
    seen.push(init.mail);
    return { ok: true, status: 250, json: async () => ({ messageId: '<m1@relay>' }) };
  });
  const a = createSmtpEmailAdapter({
    host: 'smtp.example.org', user: 'mailer', pass: PASS, from: 'Kirkko <noreply@example.org>',
    transportFactory: t.factory,
  });
  assert.deepEqual(await a.send({ to: 'warden@example.org', subject: 'Stream', text: 'Starting' }), { id: '<m1@relay>' });
  assert.deepEqual(t.sent[0].opts, {
    host: 'smtp.example.org', port: 587, secure: false, auth: { user: 'mailer', pass: PASS },
  });
  assert.deepEqual(seen[0], {
    from: 'Kirkko <noreply@example.org>', to: 'warden@example.org', subject: 'Stream', text: 'Starting',
  });
});

test('port 465 means implicit TLS; no auth block when no user is given', () => {
  const t = fakeTransportFrom(async () => ({ ok: true, status: 250, json: async () => ({}) }));
  createSmtpEmailAdapter({ host: 'h', port: 465, from: 'a@b.c', transportFactory: t.factory });
  assert.equal(t.sent[0].opts.secure, true);
  assert.equal(t.sent[0].opts.auth, undefined);
});

test('failures are reduced to a code and never echo the server text or password', async () => {
  const t = fakeTransportFrom(async () => ({ ok: false, status: 535, json: async () => ({}) }));
  const a = createSmtpEmailAdapter({ host: 'h', user: 'u', pass: PASS, from: 'a@b.c', transportFactory: t.factory });
  await assert.rejects(() => a.send({ to: 'x@y.z', subject: 's', text: 't' }), (err) => {
    assert.equal(err.message, 'smtp: send failed 535');
    assert.doesNotMatch(err.message, new RegExp(PASS));
    return true;
  });
});

test('constructor checks host, from and the user/pass pair', () => {
  assert.throws(() => createSmtpEmailAdapter({ from: 'a@b.c' }), /host/);
  assert.throws(() => createSmtpEmailAdapter({ host: 'h' }), /from/);
  assert.throws(() => createSmtpEmailAdapter({ host: 'h', from: 'a@b.c', user: 'u' }), /together/);
});

test('has no SMS channel', () => {
  const t = fakeTransportFrom(async () => ({ ok: true, status: 250, json: async () => ({}) }));
  const a = createSmtpEmailAdapter({ host: 'h', from: 'a@b.c', transportFactory: t.factory });
  assert.equal(a.channel, 'email');
  assert.equal(a.sms, undefined);
});

runAdapterContract({
  name: 'smtp email',
  channel: 'email',
  provider: 'smtp',
  secret: PASS,
  make: (fetchImpl) => createSmtpEmailAdapter({
    host: 'h', user: 'u', pass: PASS, from: 'a@b.c', transportFactory: fakeTransportFrom(fetchImpl).factory,
  }),
  sample: { to: 'x@y.z', subject: 's', text: 't' },
});
