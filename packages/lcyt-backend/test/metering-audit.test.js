import { describe, it } from 'node:test';
import assert from 'node:assert';
import { rmSync } from 'node:fs';
import express from 'express';
import Database from 'better-sqlite3';
import { initDb } from '../src/db.js';
import { writeAuditLog, queryAuditLog, deleteAuditLogOlderThan } from '../src/db/audit-log.js';
import { writeUsageRollup, queryUsageRollups, queryRollupSeries, compactHourlyRollups } from '../src/db/usage-rollups.js';
import { createMetrics } from '../src/metrics/index.js';
import { kindForMetric } from '../src/metrics/registry.js';
import { counterDelta } from '../src/metrics/pollers.js';
import { createWriteAuditMiddleware } from '../src/middleware/write-audit.js';

describe('metering and audit helpers', () => {
  it('persists usage rollups and queryable audit rows', () => {
    const db = initDb(':memory:');

    try {
      writeUsageRollup(db, { apiKey: 'proj-1', metric: 'captions.sent', value: 3, kind: 'counter' });
      writeUsageRollup(db, { apiKey: 'proj-1', metric: 'captions.sent', value: 2, kind: 'counter' });
      writeAuditLog(db, {
        actor: 'user:ops@example.com',
        actorKind: 'user',
        actorId: 'ops@example.com',
        userId: 42,
        apiKey: 'proj-1',
        orgId: 7,
        action: 'auth.login',
        targetType: 'user',
        targetId: '42',
        details: { email: 'ops@example.com' },
        ip: '203.0.113.10',
      });

      const usage = queryUsageRollups(db, { metric: 'captions.sent' });
      assert.strictEqual(usage.total, 1);
      assert.strictEqual(usage.rows[0].value, 5);

      const audit = queryAuditLog(db, { action: 'auth.login' });
      assert.strictEqual(audit.total, 1);
      assert.strictEqual(audit.rows[0].actor, 'user:ops@example.com');
      assert.strictEqual(audit.rows[0].api_key, 'proj-1');
    } finally {
      db.close();
    }
  });

  it('normalizes date-only audit ranges to the end of the requested day', () => {
    const db = initDb(':memory:');
    try {
      db.prepare(`
        INSERT INTO audit_log (actor, actor_kind, action, created_at)
        VALUES (?, ?, ?, ?)
      `).run('before', 'admin', 'auth.login', '2026-07-15T23:59:59Z');
      db.prepare(`
        INSERT INTO audit_log (actor, actor_kind, action, created_at)
        VALUES (?, ?, ?, ?)
      `).run('within', 'admin', 'auth.login', '2026-07-16T08:00:00Z');

      const audit = queryAuditLog(db, { from: '2026-07-16', to: '2026-07-16' });
      assert.strictEqual(audit.total, 1);
      assert.strictEqual(audit.rows[0].actor, 'within');
    } finally {
      db.close();
    }
  });

  it('exposes prometheus metrics from the shared registry', async () => {
    const db = initDb(':memory:');
    try {
      const metrics = createMetrics(db);
      metrics.count('captions.sent', 1, { project: 'proj-1' });
      const output = await metrics.getMetricsText();
      assert.match(output, /lcyt_captions_sent_total/);
      assert.match(output, /project="proj-1"/);
    } finally {
      db.close();
    }
  });
});

describe('usage rollup kinds and compaction', () => {
  it('applies counter/gauge/max UPSERT semantics', () => {
    const db = initDb(':memory:');
    try {
      const base = { apiKey: 'p', grain: 'hour', periodStart: '2026-07-16T10:00:00Z' };
      writeUsageRollup(db, { ...base, metric: 'c', kind: 'counter', value: 2 });
      writeUsageRollup(db, { ...base, metric: 'c', kind: 'counter', value: 3 });
      writeUsageRollup(db, { ...base, metric: 'g', kind: 'gauge', value: 100 });
      writeUsageRollup(db, { ...base, metric: 'g', kind: 'gauge', value: 40 });
      writeUsageRollup(db, { ...base, metric: 'm', kind: 'max', value: 5 });
      writeUsageRollup(db, { ...base, metric: 'm', kind: 'max', value: 3 });
      const get = (metric) => db.prepare('SELECT value FROM usage_rollups WHERE metric = ?').get(metric).value;
      assert.strictEqual(get('c'), 5);
      assert.strictEqual(get('g'), 40);
      assert.strictEqual(get('m'), 5);
    } finally {
      db.close();
    }
  });

  it('buffer merges gauge/max in memory instead of summing', async () => {
    const db = initDb(':memory:');
    try {
      const metrics = createMetrics(db);
      metrics.max('sessions.peak_concurrent', 3, { project: 'p1' });
      metrics.max('sessions.peak_concurrent', 2, { project: 'p1' });
      metrics.gauge('storage.caption_files_bytes', 100, { project: 'p1' });
      metrics.gauge('storage.caption_files_bytes', 100, { project: 'p1' });
      await metrics.flushNow();
      const get = (metric) => db.prepare('SELECT value FROM usage_rollups WHERE metric = ?').get(metric).value;
      assert.strictEqual(get('sessions.peak_concurrent'), 3);
      assert.strictEqual(get('storage.caption_files_bytes'), 100);
      metrics.stop();
    } finally {
      db.close();
    }
  });

  it('compacts old hourly rows into daily rows per metric kind', () => {
    const db = initDb(':memory:');
    try {
      const oldDay = new Date(Date.now() - 100 * 86_400_000).toISOString().slice(0, 10);
      for (const hour of ['05', '06']) {
        writeUsageRollup(db, { apiKey: 'p', metric: 'captions.sent', kind: 'counter', value: 10, periodStart: `${oldDay}T${hour}:00:00Z` });
        writeUsageRollup(db, { apiKey: 'p', metric: 'sessions.peak_concurrent', kind: 'max', value: hour === '05' ? 7 : 4, periodStart: `${oldDay}T${hour}:00:00Z` });
      }
      writeUsageRollup(db, { apiKey: 'p', metric: 'captions.sent', kind: 'counter', value: 1 }); // recent — untouched
      const compacted = compactHourlyRollups(db, { olderThanDays: 90, kindForMetric });
      assert.strictEqual(compacted, 4);
      const day = db.prepare("SELECT metric, value FROM usage_rollups WHERE grain = 'day' ORDER BY metric").all();
      assert.deepStrictEqual(day, [
        { metric: 'captions.sent', value: 20 },
        { metric: 'sessions.peak_concurrent', value: 7 },
      ]);
      const oldHours = db.prepare("SELECT COUNT(*) AS n FROM usage_rollups WHERE grain = 'hour' AND period_start LIKE ?").get(`${oldDay}%`);
      assert.strictEqual(oldHours.n, 0);
      const recent = db.prepare("SELECT COUNT(*) AS n FROM usage_rollups WHERE grain = 'hour'").get();
      assert.strictEqual(recent.n, 1);
    } finally {
      db.close();
    }
  });

  it('groups rollup series by project and joins org attribution', () => {
    const db = initDb(':memory:');
    try {
      db.prepare("INSERT INTO users (email, password_hash) VALUES ('o@example.com', 'x')").run();
      db.prepare("INSERT INTO organizations (name, slug, owner_user_id) VALUES ('Org', 'org', 1)").run();
      db.prepare("INSERT INTO api_keys (key, owner, org_id) VALUES ('k1', 'a', 1), ('k2', 'b', 1), ('k3', 'c', NULL)").run();
      const hour = '2026-07-16T10:00:00Z';
      writeUsageRollup(db, { apiKey: 'k1', metric: 'captions.sent', value: 5, periodStart: hour });
      writeUsageRollup(db, { apiKey: 'k2', metric: 'captions.sent', value: 7, periodStart: hour });
      writeUsageRollup(db, { apiKey: 'k3', metric: 'captions.sent', value: 11, periodStart: hour });

      const byProject = queryRollupSeries(db, { groupBy: 'project', metrics: ['captions.sent'] });
      assert.strictEqual(byProject.length, 3);

      const orgOnly = queryRollupSeries(db, { orgId: 1, metrics: ['captions.sent'] });
      assert.strictEqual(orgOnly.length, 1);
      assert.deepStrictEqual(orgOnly[0].points, [[hour, 12]]);
    } finally {
      db.close();
    }
  });
});

describe('poller helpers', () => {
  it('detects counter resets in deltas', () => {
    assert.strictEqual(counterDelta(NaN, 100), 0);       // first observation seeds
    assert.strictEqual(counterDelta(100, 150), 50);      // normal growth
    assert.strictEqual(counterDelta(150, 30), 30);       // reset: whole value is new
  });
});

describe('write-audit middleware', () => {
  async function withApp(fn) {
    const db = initDb(':memory:');
    const app = express();
    app.use(express.json());
    app.use(createWriteAuditMiddleware(db));
    app.put('/targets/:id', (req, res) => {
      req.auth = { kind: 'user', projectId: 'proj-1', userId: 42 };
      req.user = { userId: 42, email: 'u@example.com' };
      res.json({ ok: true });
    });
    app.post('/captions', (req, res) => {
      req.auth = { kind: 'session', projectId: 'proj-1' };
      res.json({ ok: true });
    });
    app.post('/dsk/proj-1/broadcast', (req, res) => {
      req.auth = { kind: 'user', projectId: 'proj-1' };
      res.json({ ok: true });
    });
    const server = app.listen(0);
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      await fn({ db, base });
    } finally {
      server.close();
      db.close();
    }
  }

  it('records mutating requests with a template action and redacted body', async () => {
    await withApp(async ({ db, base }) => {
      await fetch(`${base}/targets/7`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'target', password: 'hunter2' }),
      });
      await new Promise(r => setTimeout(r, 50));
      const { rows } = queryAuditLog(db, {});
      assert.strictEqual(rows.length, 1);
      assert.strictEqual(rows[0].action, 'PUT /targets/:id');
      assert.strictEqual(rows[0].actor, 'user:u@example.com');
      assert.strictEqual(rows[0].api_key, 'proj-1');
      assert.ok(rows[0].details.includes('"password":"***"'));
      assert.ok(!rows[0].details.includes('hunter2'));
    });
  });

  it('honours the hot-path skip list', async () => {
    await withApp(async ({ db, base }) => {
      await fetch(`${base}/captions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      await fetch(`${base}/dsk/proj-1/broadcast`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      await new Promise(r => setTimeout(r, 50));
      const { total } = queryAuditLog(db, {});
      assert.strictEqual(total, 0);
    });
  });
});

describe('admin_audit_log migration', () => {
  it('copies legacy rows into audit_log and drops the old table', () => {
    const path = `/tmp/lcyt-migration-test-${Date.now()}.db`;
    const raw = new Database(path);
    raw.exec(`
      CREATE TABLE admin_audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        actor TEXT NOT NULL, action TEXT NOT NULL, target_type TEXT NOT NULL,
        target_id TEXT, details TEXT, ip TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO admin_audit_log (actor, action, target_type, target_id, created_at)
      VALUES ('admin@example.com', 'user.update', 'user', '3', '2026-01-02 10:00:00');
    `);
    raw.close();
    const db = initDb(path);
    try {
      const dropped = db.prepare("SELECT name FROM sqlite_master WHERE name = 'admin_audit_log'").get();
      assert.strictEqual(dropped, undefined);
      const { rows } = queryAuditLog(db, { actorKind: 'admin' });
      assert.strictEqual(rows.length, 1);
      assert.strictEqual(rows[0].action, 'user.update');
      assert.strictEqual(rows[0].created_at, '2026-01-02T10:00:00Z');
    } finally {
      db.close();
      rmSync(path, { force: true });
    }
  });
});

describe('GET /metrics route', () => {
  it('serves prom-client exposition text with the correct content-type', async () => {
    const db = initDb(':memory:');
    const metrics = createMetrics(db);
    const app = express();
    app.get('/metrics', async (req, res) => {
      res.set('Content-Type', metrics.promRegistry.contentType);
      res.send(await metrics.getMetricsText());
    });
    const server = app.listen(0);
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      const res = await fetch(`${base}/metrics`);
      assert.strictEqual(res.status, 200);
      assert.match(res.headers.get('content-type'), /^text\/plain/);
      const body = await res.text();
      assert.ok(body.length > 0);
      assert.match(body, /^#/m); // HELP/TYPE comment lines from prom-client
    } finally {
      server.close();
      metrics.stop();
      db.close();
    }
  });
});

describe('audit retention', () => {
  it('deletes rows older than the retention window', () => {
    const db = initDb(':memory:');
    try {
      db.prepare("INSERT INTO audit_log (actor, actor_kind, action, created_at) VALUES ('old', 'admin', 'x', '2020-01-01T00:00:00Z')").run();
      db.prepare("INSERT INTO audit_log (actor, actor_kind, action) VALUES ('new', 'admin', 'y')").run();
      const { count } = deleteAuditLogOlderThan(db, 365);
      assert.strictEqual(count, 1);
      assert.strictEqual(queryAuditLog(db, {}).total, 1);
    } finally {
      db.close();
    }
  });
});
