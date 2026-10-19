import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNotifyService } from '../src/notify/notify-service.js';
import { createRateLimiter, createCooldown } from '../src/notify/rate-limit.js';

const contact = {
  slug: 'churchwarden',
  email: 'warden@example.org',
  smsNumber: '+358401234567',
  consentEmail: true,
  consentSms: true,
  active: true,
};

function fakeClock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

function okAdapter(id = 'm1') {
  const calls = [];
  return { calls, send: async (msg) => { calls.push(msg); return { id }; } };
}

test('sends when consent, address and provider are present', async () => {
  const sms = okAdapter('sms-1');
  const logs = [];
  const svc = createNotifyService({ adapters: { sms }, onLog: (e) => logs.push(e) });
  const r = await svc.send({ channel: 'sms', contact, text: 'We are now in Eucharist.', trigger: 'pointer' });
  assert.deepEqual(r, { status: 'sent', providerId: 'sms-1' });
  assert.equal(sms.calls[0].to, '+358401234567');
  assert.equal(logs.length, 1);
  assert.equal(logs[0].status, 'sent');
});

test('skips without consent for the channel and does not call the provider', async () => {
  const email = okAdapter();
  const svc = createNotifyService({ adapters: { email } });
  const r = await svc.send({
    channel: 'email', contact: { ...contact, consentEmail: false }, text: 'x', trigger: 'send',
  });
  assert.equal(r.status, 'skipped_no_consent');
  assert.equal(email.calls.length, 0);
});

test('skips inactive contacts and missing addresses', async () => {
  const sms = okAdapter();
  const svc = createNotifyService({ adapters: { sms } });
  assert.equal(
    (await svc.send({ channel: 'sms', contact: { ...contact, active: false }, text: 'x', trigger: 'send' })).status,
    'skipped_inactive',
  );
  assert.equal(
    (await svc.send({ channel: 'sms', contact: { ...contact, smsNumber: null }, text: 'x', trigger: 'send' })).status,
    'skipped_no_address',
  );
});

test('reports a missing provider for the channel', async () => {
  const svc = createNotifyService({ adapters: {} });
  const r = await svc.send({ channel: 'email', contact, text: 'x', trigger: 'send' });
  assert.equal(r.status, 'skipped_no_provider');
});

test('same text to the same contact is suppressed during the cooldown', async () => {
  const clock = fakeClock();
  const sms = okAdapter();
  const svc = createNotifyService({ adapters: { sms }, cooldownMs: 60_000, now: clock.now });
  const req = { channel: 'sms', contact, text: 'Ring the bells', trigger: 'pointer' };
  assert.equal((await svc.send(req)).status, 'sent');
  clock.advance(30_000);
  assert.equal((await svc.send(req)).status, 'cooldown');
  clock.advance(31_000);
  assert.equal((await svc.send(req)).status, 'sent');
  assert.equal(sms.calls.length, 2);
});

test('a different text is not blocked by the cooldown', async () => {
  const sms = okAdapter();
  const svc = createNotifyService({ adapters: { sms } });
  await svc.send({ channel: 'sms', contact, text: 'one', trigger: 'send' });
  assert.equal((await svc.send({ channel: 'sms', contact, text: 'two', trigger: 'send' })).status, 'sent');
});

test('rate limit is per contact: one contact hitting the cap does not block another', async () => {
  const clock = fakeClock();
  const sms = okAdapter();
  const svc = createNotifyService({
    adapters: { sms }, limits: { perHour: 2, perDay: 100 }, cooldownMs: 0, now: clock.now,
  });
  const other = { ...contact, slug: 'sexton', smsNumber: '+358400000000' };
  assert.equal((await svc.send({ channel: 'sms', contact, text: 'a', trigger: 'send' })).status, 'sent');
  assert.equal((await svc.send({ channel: 'sms', contact, text: 'b', trigger: 'send' })).status, 'sent');
  assert.equal((await svc.send({ channel: 'sms', contact, text: 'c', trigger: 'send' })).status, 'rate_limited');
  assert.equal((await svc.send({ channel: 'sms', contact: other, text: 'd', trigger: 'send' })).status, 'sent');
});

test('provider errors become a failed result and are logged, never thrown', async () => {
  const logs = [];
  const sms = { send: async () => { throw new Error('brevo: request failed with HTTP 500'); } };
  const svc = createNotifyService({ adapters: { sms }, onLog: (e) => logs.push(e) });
  const r = await svc.send({ channel: 'sms', contact, text: 'x', trigger: 'pointer' });
  assert.equal(r.status, 'failed');
  assert.match(r.error, /HTTP 500/);
  assert.equal(logs[0].status, 'failed');
});

test('createRateLimiter forgets hits outside the window', () => {
  const clock = fakeClock();
  const rl = createRateLimiter({ limit: 1, windowMs: 1000, now: clock.now });
  assert.equal(rl.take('k'), true);
  assert.equal(rl.take('k'), false);
  clock.advance(1000);
  assert.equal(rl.take('k'), true);
});

test('createCooldown blocks until the cooldown has passed', () => {
  const clock = fakeClock();
  const cd = createCooldown({ cooldownMs: 500, now: clock.now });
  assert.equal(cd.take('k'), true);
  clock.advance(499);
  assert.equal(cd.take('k'), false);
  clock.advance(1);
  assert.equal(cd.take('k'), true);
});
