import { describe, it } from 'node:test';
import assert from 'node:assert';
import { initDb } from '../src/db.js';
import { writeAuditLog, queryAuditLog } from '../src/db/audit-log.js';
import { writeUsageRollup, queryUsageRollups } from '../src/db/usage-rollups.js';
import { createMetrics } from '../src/metrics.js';

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
