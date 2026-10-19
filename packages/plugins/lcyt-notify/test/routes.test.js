import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { generateCredentialKey, CredentialKeyError } from 'lcyt-platforms';
import { createNotifyRouter, loadNotifyAdapters, purgeLog, appendLog } from '../src/index.js';

// In-memory stand-in for the Prisma calls the notify db helpers make.
function fakeDb() {
  const tables = { notify_contacts: [], notify_providers: [], notify_log: [] };
  const matches = (row, where = {}) => Object.entries(where).every(([k, v]) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if ('lt' in v) return row[k] < v.lt;
      return Object.entries(v).every(([kk, vv]) => row[kk] === vv);
    }
    return row[k] === v;
  });
  const flatten = (where = {}) => {
    const out = {};
    for (const [k, v] of Object.entries(where)) {
      if (v && typeof v === 'object' && !('lt' in v)) Object.assign(out, v); else out[k] = v;
    }
    return out;
  };
  const table = (name) => {
    const rows = tables[name];
    return {
      findMany: async ({ where, take } = {}) => rows.filter((r) => matches(r, where)).slice(0, take ?? Infinity).map((r) => ({ ...r })),
      findUnique: async ({ where }) => { const r = rows.find((x) => matches(x, flatten(where))); return r ? { ...r } : null; },
      create: async ({ data }) => { rows.push({ ...data }); return { ...data }; },
      update: async ({ where, data }) => { const r = rows.find((x) => matches(x, flatten(where))); Object.assign(r, data); return { ...r }; },
      upsert: async ({ where, update, create }) => {
        const r = rows.find((x) => matches(x, flatten(where)));
        if (r) { Object.assign(r, update); return { ...r }; }
        rows.push({ ...create }); return { ...create };
      },
      deleteMany: async ({ where } = {}) => {
        const keep = rows.filter((r) => !matches(r, where));
        const count = rows.length - keep.length;
        rows.splice(0, rows.length, ...keep);
        return { count };
      },
    };
  };
  return { notify_contacts: table('notify_contacts'), notify_providers: table('notify_providers'), notify_log: table('notify_log'), _tables: tables };
}

function startApp({ db, apiKey = 'proj-key', key = generateCredentialKey() }) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.session = apiKey ? { apiKey } : undefined; next(); });
  app.use(createNotifyRouter(db, (_req, _res, next) => next(), { credentialKey: () => Buffer.from(key, 'base64') }));
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` }));
  });
}

async function call(base, method, path, body) {
  const res = await fetch(base + path, {
    method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

test('contacts: create, list, validate, delete', async () => {
  const { server, base } = await startApp({ db: fakeDb() });
  try {
    const created = await call(base, 'PUT', '/notify/contacts/churchwarden', {
      name: 'Kirkkoisäntä', email: 'warden@example.org', smsNumber: '+358 40 123 4567', consentSms: true,
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.contact.smsNumber, '+358401234567');
    assert.equal(created.body.contact.consentSms, true);
    assert.equal(created.body.contact.consentEmail, false);

    const updated = await call(base, 'PUT', '/notify/contacts/churchwarden', { email: 'new@example.org' });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.contact.email, 'new@example.org');

    const list = await call(base, 'GET', '/notify/contacts');
    assert.equal(list.body.contacts.length, 1);

    assert.equal((await call(base, 'PUT', '/notify/contacts/Bad_Slug', {})).status, 400);
    assert.equal((await call(base, 'PUT', '/notify/contacts/admin', {})).status, 400);
    assert.equal((await call(base, 'PUT', '/notify/contacts/sexton', { smsNumber: '12' })).status, 400);
    assert.equal((await call(base, 'PUT', '/notify/contacts/sexton', { email: 'nope' })).status, 400);

    assert.equal((await call(base, 'DELETE', '/notify/contacts/churchwarden')).status, 204);
    assert.equal((await call(base, 'DELETE', '/notify/contacts/churchwarden')).status, 404);
  } finally {
    server.close();
  }
});

test('contacts are scoped to the project key', async () => {
  const db = fakeDb();
  const a = await startApp({ db, apiKey: 'proj-a' });
  const b = await startApp({ db, apiKey: 'proj-b' });
  try {
    await call(a.base, 'PUT', '/notify/contacts/sexton', { email: 'a@example.org' });
    assert.equal((await call(b.base, 'GET', '/notify/contacts')).body.contacts.length, 0);
  } finally {
    a.server.close();
    b.server.close();
  }
});

test('no session answers 401', async () => {
  const { server, base } = await startApp({ db: fakeDb(), apiKey: null });
  try {
    assert.equal((await call(base, 'GET', '/notify/contacts')).status, 401);
  } finally {
    server.close();
  }
});

test('provider: secrets are encrypted, never returned, and kept when not sent again', async () => {
  const db = fakeDb();
  const { server, base } = await startApp({ db });
  try {
    const saved = await call(base, 'PUT', '/notify/provider', {
      provider: 'brevo', config: { senderEmail: 'noreply@example.org', smsSender: 'Kirkko' }, secrets: { apiKey: 'xkeysecret123' },
    });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.hasSecret, true);
    assert.doesNotMatch(JSON.stringify(saved.body), /xkeysecret123/);

    const row = db._tables.notify_providers[0];
    assert.doesNotMatch(row.secrets_enc, /xkeysecret123/);
    assert.doesNotMatch(row.config_json, /xkeysecret123/);

    const got = await call(base, 'GET', '/notify/provider');
    assert.equal(got.body.provider, 'brevo');
    assert.equal(got.body.hasSecret, true);
    assert.doesNotMatch(JSON.stringify(got.body), /xkeysecret123/);

    // Same provider, no secrets sent: the stored key stays.
    const kept = await call(base, 'PUT', '/notify/provider', {
      provider: 'brevo', config: { senderEmail: 'other@example.org' },
    });
    assert.equal(kept.status, 200);
    assert.equal(db._tables.notify_providers[0].secrets_enc, row.secrets_enc);

    // Switching provider needs the new secrets.
    const switched = await call(base, 'PUT', '/notify/provider', {
      provider: 'smtp', config: { host: 'smtp.example.org', from: 'noreply@example.org' },
    });
    assert.equal(switched.status, 400);
  } finally {
    server.close();
  }
});

test('provider: refuses to store secrets without a credential key', async () => {
  const { server, base } = await startApp({ db: fakeDb() });
  server.close();
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.session = { apiKey: 'k' }; next(); });
  app.use(createNotifyRouter(fakeDb(), (_req, _res, next) => next(), {
    credentialKey: () => { throw new CredentialKeyError('PLATFORM_CREDENTIAL_KEY is not set'); },
  }));
  const s2 = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  try {
    const r = await call(`http://127.0.0.1:${s2.address().port}`, 'PUT', '/notify/provider', {
      provider: 'brevo', config: { senderEmail: 'a@b.cd' }, secrets: { apiKey: 'k' },
    });
    assert.equal(r.status, 503);
  } finally {
    s2.close();
  }
});

test('loadNotifyAdapters: Brevo gives email and SMS, SMTP gives email only', async () => {
  const db = fakeDb();
  const key = generateCredentialKey();
  const { server, base } = await startApp({ db, key });
  try {
    await call(base, 'PUT', '/notify/provider', {
      provider: 'brevo', config: { senderEmail: 'noreply@example.org', smsSender: 'Kirkko' }, secrets: { apiKey: 'k-brevo' },
    });
    const keyBuf = Buffer.from(key, 'base64');
    const brevo = await loadNotifyAdapters(db, 'proj-key', () => keyBuf);
    assert.equal(typeof brevo.email.send, 'function');
    assert.equal(typeof brevo.sms.send, 'function');

    assert.equal((await call(base, 'PUT', '/notify/provider', {
      provider: 'smtp', config: { host: 'smtp.example.org', from: 'noreply@example.org', user: 'mailer' }, secrets: { pass: 'p' },
    })).status, 200);
    const smtp = await loadNotifyAdapters(db, 'proj-key', () => keyBuf);
    assert.equal(smtp.sms, undefined);
    assert.equal(typeof smtp.email.send, 'function');
  } finally {
    server.close();
  }
});

test('log: newest first, and purge keeps only the last 90 days', async () => {
  const db = fakeDb();
  await appendLog(db, 'proj-key', { channel: 'sms', contactSlug: 'sexton', trigger: 'send', status: 'sent', providerId: '9' });
  db._tables.notify_log[0].at = '2000-01-01 00:00:00';
  await appendLog(db, 'proj-key', { channel: 'email', contactSlug: 'sexton', trigger: 'pointer', status: 'cooldown' });
  assert.equal(await purgeLog(db, 90), 1);
  const { server, base } = await startApp({ db });
  try {
    const log = await call(base, 'GET', '/notify/log?limit=10');
    assert.equal(log.body.log.length, 1);
    assert.equal(log.body.log[0].status, 'cooldown');
  } finally {
    server.close();
  }
});
