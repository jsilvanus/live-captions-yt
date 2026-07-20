/**
 * Golden tests for the server-settings registry/service (plan_env_to_ui_settings.md).
 *
 * These are the backbone of the whole migration: they pin down that
 * SettingsService.get() reproduces exactly what the current scattered
 * `process.env.X` parsing produces for a representative env-fixture matrix,
 * so later call-site migrations (Phase 4/5) can't silently drift the
 * coercion behaviour.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { initDb } from '../src/db.js';
import { SettingsService } from '../src/settings/service.js';
import { REGISTRY, REGISTRY_BY_KEY, getSettingDef } from '../src/settings/registry.js';

/** Snapshot + restore the subset of process.env this test suite touches. */
const TOUCHED_ENV_KEYS = new Set(REGISTRY.map(d => d.env));
let envSnapshot;

beforeEach(() => {
  envSnapshot = new Map();
  for (const k of TOUCHED_ENV_KEYS) {
    if (process.env[k] !== undefined) envSnapshot.set(k, process.env[k]);
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of TOUCHED_ENV_KEYS) delete process.env[k];
  for (const [k, v] of envSnapshot) process.env[k] = v;
});

function freshService() {
  const db = initDb(':memory:');
  return new SettingsService(db);
}

describe('registry', () => {
  it('every entry has a unique key and env name', () => {
    const keys = new Set();
    const envs = new Set();
    for (const def of REGISTRY) {
      assert.equal(keys.has(def.key), false, `duplicate key ${def.key}`);
      keys.add(def.key);
      assert.equal(envs.has(def.env), false, `duplicate env ${def.env}`);
      envs.add(def.env);
    }
  });

  it('Tier A entries carry apply: restart and tier: env', () => {
    for (const def of REGISTRY) {
      if (def.tier === 'env') assert.equal(def.apply, 'restart');
    }
  });
});

describe('SettingsService precedence', () => {
  it('falls through to the registry default when nothing is set', () => {
    const svc = freshService();
    assert.equal(svc.get('contact.email'), '');
    assert.equal(svc.source('contact.email'), 'default');
    assert.equal(svc.get('retention.session_ttl'), 7_200_000);
  });

  it('DB value wins over default once set', () => {
    const svc = freshService();
    svc.set('contact.email', 'ops@example.com');
    assert.equal(svc.get('contact.email'), 'ops@example.com');
    assert.equal(svc.source('contact.email'), 'db');
  });

  it('env wins over DB even when a DB row exists', () => {
    const svc = freshService();
    svc.set('contact.email', 'db@example.com');
    process.env.CONTACT_EMAIL = 'env@example.com';
    assert.equal(svc.get('contact.email'), 'env@example.com');
    assert.equal(svc.source('contact.email'), 'env');
  });

  it('clear() reverts to env/default and re-reads the cache', () => {
    const svc = freshService();
    svc.set('contact.email', 'db@example.com');
    svc.clear('contact.email');
    assert.equal(svc.get('contact.email'), '');
    assert.equal(svc.source('contact.email'), 'default');
  });
});

describe('coercion parity with legacy scattered parsing', () => {
  it("boolStyle 'is1' matches `=== '1'` (RTMP_RELAY_ACTIVE)", () => {
    const svc = freshService();
    assert.equal(getSettingDef('media.rtmp_relay_active').boolStyle, 'is1');
    assert.equal(svc.get('media.rtmp_relay_active'), false);
    process.env.RTMP_RELAY_ACTIVE = '1';
    assert.equal(svc.get('media.rtmp_relay_active'), true);
    process.env.RTMP_RELAY_ACTIVE = 'true'; // legacy parsing only accepted the literal '1'
    assert.equal(svc.get('media.rtmp_relay_active'), false);
  });

  it("boolStyle 'not0' matches `!== '0'` (USE_USER_LOGINS, default-on)", () => {
    const svc = freshService();
    assert.equal(svc.get('app.use_user_logins'), true);
    process.env.USE_USER_LOGINS = '0';
    assert.equal(svc.get('app.use_user_logins'), false);
    process.env.USE_USER_LOGINS = 'anything-else';
    assert.equal(svc.get('app.use_user_logins'), true);
  });

  it("boolStyle 'presence' matches truthy-if-set (USAGE_PUBLIC)", () => {
    const svc = freshService();
    assert.equal(svc.get('app.usage_public'), false);
    process.env.USAGE_PUBLIC = '0'; // legacy code only checks `if (process.env.USAGE_PUBLIC)` — any non-empty string is truthy
    assert.equal(svc.get('app.usage_public'), true);
  });

  it('csv splits and trims (ALLOWED_DOMAINS)', () => {
    const svc = freshService();
    assert.deepEqual(svc.get('app.allowed_domains'), ['lcyt.fi', 'www.lcyt.fi', 'localhost']);
    process.env.ALLOWED_DOMAINS = 'a.com, b.com ,c.com';
    assert.deepEqual(svc.get('app.allowed_domains'), ['a.com', 'b.com', 'c.com']);
  });

  it('int falls back to the registry default on a non-numeric env value', () => {
    const svc = freshService();
    process.env.SESSION_TTL = 'not-a-number';
    assert.equal(svc.get('retention.session_ttl'), 7_200_000);
    process.env.SESSION_TTL = '1000';
    assert.equal(svc.get('retention.session_ttl'), 1000);
  });
});

describe('Tier A / env-locked write rejection', () => {
  it('rejects writes to a Tier A key', () => {
    const svc = freshService();
    assert.throws(() => svc.set('bootstrap.jwt_secret', 'x'), /TIER_A_LOCKED|env-only/);
  });

  it('rejects a write when the env var is currently set (env-locked)', () => {
    const svc = freshService();
    process.env.CONTACT_EMAIL = 'env@example.com';
    assert.throws(() => svc.set('contact.email', 'db@example.com'), /ENV_LOCKED|locked/);
  });

  it('rejects clear() on a Tier A key', () => {
    const svc = freshService();
    assert.throws(() => svc.clear('bootstrap.jwt_secret'), /TIER_A_LOCKED|env-only/);
  });
});

describe('change notification', () => {
  it('emits "changed" on set() and clear()', () => {
    const svc = freshService();
    const events = [];
    svc.on('changed', (e) => events.push(e));
    svc.set('contact.email', 'a@example.com');
    svc.clear('contact.email');
    assert.equal(events.length, 2);
    assert.equal(events[0].key, 'contact.email');
    assert.equal(events[0].source, 'db');
    assert.equal(events[1].source, 'default');
  });
});

describe('snapshot()', () => {
  it('masks secrets and reports source/pendingRestart per key', () => {
    const svc = freshService();
    svc.set('contact.email', 'a@example.com');
    const snap = svc.snapshot();
    const contact = snap.find(s => s.key === 'contact.email');
    assert.equal(contact.value, 'a@example.com');
    assert.equal(contact.source, 'db');

    const secretDef = snap.find(s => s.key === 'stt.google_stt_key');
    assert.equal(secretDef.secret, true);
    assert.equal(secretDef.value, null); // unset secret shows as null, never ''

    assert.equal(snap.length, REGISTRY.length);
  });

  it('flags pendingRestart only once a restart-tier key diverges from its boot value', () => {
    const svc = freshService();
    const before = svc.snapshot().find(s => s.key === 'compute.ffmpeg_runner');
    assert.equal(before.pendingRestart, false);
    svc.set('compute.ffmpeg_runner', 'docker');
    const after = svc.snapshot().find(s => s.key === 'compute.ffmpeg_runner');
    assert.equal(after.pendingRestart, true);
  });
});
