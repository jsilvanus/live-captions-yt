import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import {
  initDb,
  validateApiKey,
  getAllKeys,
  getKey,
  createKey,
  revokeKey,
  deleteKey,
  renewKey,
  updateKey,
  getKeySequence,
  updateKeySequence,
  resetKeySequence,
} from '../src/db.js';
import { getDialect } from '../src/db/connection.js';

// ---------------------------------------------------------------------------
// Test setup — use an in-memory SQLite database for each suite
// ---------------------------------------------------------------------------

describe('db.js', () => {
  let db;

  before(async () => {
    db = await initDb(':memory:');
  });

  after(() => {
    db.close();
  });

  // -------------------------------------------------------------------------
  // initDb
  // -------------------------------------------------------------------------

  describe('initDb', () => {
    it('should create the api_keys table', async () => {
      const result = getDialect() === 'postgres'
        ? await db.prepare("SELECT table_name AS name FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'api_keys'").get()
        : await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='api_keys'").get();
      assert.ok(result, 'api_keys table should exist');
      assert.strictEqual(result.name, 'api_keys');
    });

    it('should be idempotent — calling again does not throw', async () => {
      let second;
      await assert.doesNotReject(async () => { second = await initDb(':memory:'); });
      await second.close();
    });

    it('should create organization tables and api_keys.org_id column', async () => {
      if (getDialect() === 'postgres') {
        const q = (sql) => db.prepare(sql).all();
        const tableNames = (await q("SELECT table_name AS name FROM information_schema.tables WHERE table_schema = current_schema() AND table_name IN ('organizations', 'org_members')")).map(r => r.name).sort();
        assert.deepStrictEqual(tableNames, ['org_members', 'organizations']);
        const columns = (await q("SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'api_keys'")).map(r => r.name);
        assert.ok(columns.includes('org_id'));
        const idx = (await q("SELECT indexname AS name FROM pg_indexes WHERE schemaname = current_schema() AND tablename IN ('org_members', 'api_keys')")).map(r => r.name);
        for (const name of ['idx_org_members_user', 'idx_org_members_org', 'idx_api_keys_org']) assert.ok(idx.includes(name), name);
        const fks = (await q(`SELECT cl.relname AS child, cf.relname AS parent FROM pg_constraint c
          JOIN pg_class cl ON cl.oid = c.conrelid JOIN pg_class cf ON cf.oid = c.confrelid
          WHERE c.contype = 'f' AND cl.relnamespace = current_schema()::regnamespace`));
        const parents = (child) => fks.filter(r => r.child === child).map(r => r.parent);
        assert.ok(parents('organizations').includes('users'));
        assert.ok(parents('org_members').includes('organizations'));
        assert.ok(parents('org_members').includes('users'));
        return;
      }
      const tableNames = (await db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('organizations', 'org_members')"
      ).all()).map(row => row.name).sort();
      assert.deepStrictEqual(tableNames, ['org_members', 'organizations']);

      const columns = (await db.prepare('PRAGMA table_info(api_keys)').all()).map(column => column.name);
      assert.ok(columns.includes('org_id'));

      const orgMemberIndexes = (await db.prepare('PRAGMA index_list(org_members)').all()).map(index => index.name);
      assert.ok(orgMemberIndexes.includes('idx_org_members_user'));
      assert.ok(orgMemberIndexes.includes('idx_org_members_org'));

      const apiKeyIndexes = (await db.prepare('PRAGMA index_list(api_keys)').all()).map(index => index.name);
      assert.ok(apiKeyIndexes.includes('idx_api_keys_org'));

      const organizationForeignKeys = (await db.prepare('PRAGMA foreign_key_list(organizations)').all()).map(row => row.table);
      assert.ok(organizationForeignKeys.includes('users'));

      const orgMemberForeignKeys = (await db.prepare('PRAGMA foreign_key_list(org_members)').all()).map(row => row.table);
      assert.ok(orgMemberForeignKeys.includes('organizations'));
      assert.ok(orgMemberForeignKeys.includes('users'));
    });
  });

  // -------------------------------------------------------------------------
  // createKey
  // -------------------------------------------------------------------------

  describe('createKey', () => {
    it('should create a key with auto-generated UUID when no key provided', async () => {
      const row = await createKey(db, { owner: 'Alice' });
      assert.ok(row.key, 'should have a key');
      assert.match(row.key, /^[0-9a-f-]{36}$/);
      assert.strictEqual(row.owner, 'Alice');
      assert.strictEqual(row.active, 1);
      assert.strictEqual(row.expires_at, null);
    });

    it('should create a key with a custom key value', async () => {
      const row = await createKey(db, { key: 'custom-key-abc', owner: 'Bob' });
      assert.strictEqual(row.key, 'custom-key-abc');
      assert.strictEqual(row.owner, 'Bob');
    });

    it('should create a key with an expiration date', async () => {
      const row = await createKey(db, { owner: 'Eve', expiresAt: '2026-12-31' });
      assert.strictEqual(row.expires_at, '2026-12-31');
      assert.strictEqual(row.active, 1);
    });

    it('should set created_at automatically', async () => {
      const row = await createKey(db, { owner: 'Frank' });
      assert.ok(row.created_at, 'created_at should be set');
    });

    it('should reject duplicate key values', async () => {
      await createKey(db, { key: 'dup-key', owner: 'First' });
      await assert.rejects(() => createKey(db, { key: 'dup-key', owner: 'Second' }));
    });
  });

  // -------------------------------------------------------------------------
  // getKey
  // -------------------------------------------------------------------------

  describe('getKey', () => {
    it('should return the key row for an existing key', async () => {
      const created = await createKey(db, { owner: 'Get Test' });
      const fetched = await getKey(db, created.key);
      assert.strictEqual(fetched.key, created.key);
      assert.strictEqual(fetched.owner, 'Get Test');
    });

    it('should return null for a non-existent key', async () => {
      const result = await getKey(db, 'does-not-exist-xyz');
      assert.strictEqual(result, null);
    });
  });

  // -------------------------------------------------------------------------
  // getAllKeys
  // -------------------------------------------------------------------------

  describe('getAllKeys', () => {
    it('should return an array of all keys', async () => {
      // Create a fresh database to have predictable results
      const freshDb = await initDb(':memory:');
      await createKey(freshDb, { key: 'key-1', owner: 'Owner 1' });
      await createKey(freshDb, { key: 'key-2', owner: 'Owner 2' });

      const keys = await getAllKeys(freshDb);
      assert.strictEqual(keys.length, 2);
      assert.strictEqual(keys[0].key, 'key-1');
      assert.strictEqual(keys[1].key, 'key-2');
      freshDb.close();
    });

    it('should return empty array when no keys exist', async () => {
      const freshDb = await initDb(':memory:');
      const keys = await getAllKeys(freshDb);
      assert.deepStrictEqual(keys, []);
      freshDb.close();
    });
  });

  // -------------------------------------------------------------------------
  // validateApiKey
  // -------------------------------------------------------------------------

  describe('validateApiKey', () => {
    it('should return valid=true for a valid active key', async () => {
      const created = await createKey(db, { owner: 'Valid User' });
      const result = await validateApiKey(db, created.key);
      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.owner, 'Valid User');
    });

    it('should return valid=false with reason=unknown_key for non-existent key', async () => {
      const result = await validateApiKey(db, 'totally-unknown-key');
      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.reason, 'unknown_key');
    });

    it('should return valid=false with reason=revoked for revoked key', async () => {
      const created = await createKey(db, { owner: 'Will Be Revoked' });
      await revokeKey(db, created.key);
      const result = await validateApiKey(db, created.key);
      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.reason, 'revoked');
    });

    it('should return valid=false with reason=expired for expired key', async () => {
      const created = await createKey(db, { owner: 'Expired User', expiresAt: '2000-01-01' });
      const result = await validateApiKey(db, created.key);
      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.reason, 'expired');
    });

    it('should return valid=true for key with future expiration', async () => {
      const created = await createKey(db, { owner: 'Future User', expiresAt: '2099-12-31' });
      const result = await validateApiKey(db, created.key);
      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.owner, 'Future User');
      assert.strictEqual(result.expiresAt, '2099-12-31');
    });

    it('should return valid=true for key with null expires_at (never expires)', async () => {
      const created = await createKey(db, { owner: 'No Expiry' });
      const result = await validateApiKey(db, created.key);
      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.expiresAt, null);
    });
  });

  // -------------------------------------------------------------------------
  // revokeKey
  // -------------------------------------------------------------------------

  describe('revokeKey', () => {
    it('should set active=0 for the key', async () => {
      const created = await createKey(db, { owner: 'To Revoke' });
      const result = await revokeKey(db, created.key);
      assert.strictEqual(result, true);
      const row = await getKey(db, created.key);
      assert.strictEqual(row.active, 0);
    });

    it('should return false for non-existent key', async () => {
      const result = await revokeKey(db, 'non-existent-for-revoke');
      assert.strictEqual(result, false);
    });
  });

  // -------------------------------------------------------------------------
  // deleteKey
  // -------------------------------------------------------------------------

  describe('deleteKey', () => {
    it('should permanently remove the key from the database', async () => {
      const created = await createKey(db, { owner: 'To Delete' });
      const result = await deleteKey(db, created.key);
      assert.strictEqual(result, true);
      assert.strictEqual(await getKey(db, created.key), null);
    });

    it('should return false for non-existent key', async () => {
      const result = await deleteKey(db, 'non-existent-for-delete');
      assert.strictEqual(result, false);
    });
  });

  // -------------------------------------------------------------------------
  // renewKey
  // -------------------------------------------------------------------------

  describe('renewKey', () => {
    it('should update expires_at for the key', async () => {
      const created = await createKey(db, { owner: 'To Renew', expiresAt: '2026-01-01' });
      const result = await renewKey(db, created.key, '2027-06-30');
      assert.strictEqual(result, true);
      const row = await getKey(db, created.key);
      assert.strictEqual(row.expires_at, '2027-06-30');
    });

    it('should clear expiration when null is passed', async () => {
      const created = await createKey(db, { owner: 'Renew To Never', expiresAt: '2026-01-01' });
      await renewKey(db, created.key, null);
      const row = await getKey(db, created.key);
      assert.strictEqual(row.expires_at, null);
    });

    it('should return false for non-existent key', async () => {
      const result = await renewKey(db, 'non-existent-for-renew', '2027-01-01');
      assert.strictEqual(result, false);
    });
  });

  // -------------------------------------------------------------------------
  // updateKey
  // -------------------------------------------------------------------------

  describe('updateKey', () => {
    it('should update owner field', async () => {
      const created = await createKey(db, { owner: 'Old Name' });
      const result = await updateKey(db, created.key, { owner: 'New Name' });
      assert.strictEqual(result, true);
      const row = await getKey(db, created.key);
      assert.strictEqual(row.owner, 'New Name');
    });

    it('should update expiresAt field', async () => {
      const created = await createKey(db, { owner: 'Update Expires' });
      const result = await updateKey(db, created.key, { expiresAt: '2027-01-01' });
      assert.strictEqual(result, true);
      const row = await getKey(db, created.key);
      assert.strictEqual(row.expires_at, '2027-01-01');
    });

    it('should update both owner and expiresAt together', async () => {
      const created = await createKey(db, { owner: 'Old', expiresAt: '2026-01-01' });
      await updateKey(db, created.key, { owner: 'New', expiresAt: '2028-01-01' });
      const row = await getKey(db, created.key);
      assert.strictEqual(row.owner, 'New');
      assert.strictEqual(row.expires_at, '2028-01-01');
    });

    it('should return false when no fields provided', async () => {
      const created = await createKey(db, { owner: 'No Update' });
      const result = await updateKey(db, created.key, {});
      assert.strictEqual(result, false);
    });

    it('should return false for non-existent key', async () => {
      const result = await updateKey(db, 'non-existent-for-update', { owner: 'X' });
      assert.strictEqual(result, false);
    });
  });

  // -------------------------------------------------------------------------
  // getKeySequence / updateKeySequence / resetKeySequence
  // -------------------------------------------------------------------------

  describe('per-API-key sequence', () => {
    it('getKeySequence returns 0 when no captions have been sent', async () => {
      const { key } = await createKey(db, { owner: 'Seq Zero' });
      assert.strictEqual(await getKeySequence(db, key), 0);
    });

    it('updateKeySequence persists the sequence and getKeySequence returns it', async () => {
      const { key } = await createKey(db, { owner: 'Seq Update' });
      await updateKeySequence(db, key, 42);
      assert.strictEqual(await getKeySequence(db, key), 42);
    });

    it('getKeySequence returns 0 when last_caption_at is older than 2 hours', async () => {
      const { key } = await createKey(db, { owner: 'Seq TTL' });
      // Manually write a past timestamp (3 hours ago)
      const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
      await db.prepare('UPDATE api_keys SET sequence = 99, last_caption_at = ? WHERE key = ?').run(threeHoursAgo, key);
      assert.strictEqual(await getKeySequence(db, key), 0);
    });

    it('getKeySequence returns stored sequence when last_caption_at is within 2 hours', async () => {
      const { key } = await createKey(db, { owner: 'Seq Recent' });
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      await db.prepare('UPDATE api_keys SET sequence = 77, last_caption_at = ? WHERE key = ?').run(oneHourAgo, key);
      assert.strictEqual(await getKeySequence(db, key), 77);
    });

    it('resetKeySequence resets sequence to 0 and clears last_caption_at', async () => {
      const { key } = await createKey(db, { owner: 'Seq Reset' });
      await updateKeySequence(db, key, 55);
      await resetKeySequence(db, key);
      assert.strictEqual(await getKeySequence(db, key), 0);
      const row = await db.prepare('SELECT last_caption_at FROM api_keys WHERE key = ?').get(key);
      assert.strictEqual(row.last_caption_at, null);
    });

    it('getKeySequence returns 0 for unknown key', async () => {
      assert.strictEqual(await getKeySequence(db, 'does-not-exist'), 0);
    });
  });
});
