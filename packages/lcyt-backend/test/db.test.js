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
  updateKey
} from '../src/db.js';

// ---------------------------------------------------------------------------
// Test setup — use an in-memory SQLite database for each suite
// ---------------------------------------------------------------------------

describe('db.js', () => {
  let db;

  before(() => {
    db = initDb(':memory:');
  });

  after(() => {
    db.close();
  });

  // -------------------------------------------------------------------------
  // initDb
  // -------------------------------------------------------------------------

  describe('initDb', () => {
    it('should create the api_keys table', () => {
      const result = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='api_keys'"
      ).get();
      assert.ok(result, 'api_keys table should exist');
      assert.strictEqual(result.name, 'api_keys');
    });

    it('should be idempotent — calling again does not throw', () => {
      assert.doesNotThrow(() => initDb(':memory:'));
    });
  });

  // -------------------------------------------------------------------------
  // createKey
  // -------------------------------------------------------------------------

  describe('createKey', () => {
    it('should create a key with auto-generated UUID when no key provided', () => {
      const row = createKey(db, { owner: 'Alice' });
      assert.ok(row.key, 'should have a key');
      assert.match(row.key, /^[0-9a-f-]{36}$/);
      assert.strictEqual(row.owner, 'Alice');
      assert.strictEqual(row.active, 1);
      assert.strictEqual(row.expires_at, null);
    });

    it('should create a key with a custom key value', () => {
      const row = createKey(db, { key: 'custom-key-abc', owner: 'Bob' });
      assert.strictEqual(row.key, 'custom-key-abc');
      assert.strictEqual(row.owner, 'Bob');
    });

    it('should create a key with an expiration date', () => {
      const row = createKey(db, { owner: 'Eve', expiresAt: '2026-12-31' });
      assert.strictEqual(row.expires_at, '2026-12-31');
      assert.strictEqual(row.active, 1);
    });

    it('should set created_at automatically', () => {
      const row = createKey(db, { owner: 'Frank' });
      assert.ok(row.created_at, 'created_at should be set');
    });

    it('should reject duplicate key values', () => {
      createKey(db, { key: 'dup-key', owner: 'First' });
      assert.throws(() => createKey(db, { key: 'dup-key', owner: 'Second' }));
    });
  });

  // -------------------------------------------------------------------------
  // getKey
  // -------------------------------------------------------------------------

  describe('getKey', () => {
    it('should return the key row for an existing key', () => {
      const created = createKey(db, { owner: 'Get Test' });
      const fetched = getKey(db, created.key);
      assert.strictEqual(fetched.key, created.key);
      assert.strictEqual(fetched.owner, 'Get Test');
    });

    it('should return null for a non-existent key', () => {
      const result = getKey(db, 'does-not-exist-xyz');
      assert.strictEqual(result, null);
    });
  });

  // -------------------------------------------------------------------------
  // getAllKeys
  // -------------------------------------------------------------------------

  describe('getAllKeys', () => {
    it('should return an array of all keys', () => {
      // Create a fresh database to have predictable results
      const freshDb = initDb(':memory:');
      createKey(freshDb, { key: 'key-1', owner: 'Owner 1' });
      createKey(freshDb, { key: 'key-2', owner: 'Owner 2' });

      const keys = getAllKeys(freshDb);
      assert.strictEqual(keys.length, 2);
      assert.strictEqual(keys[0].key, 'key-1');
      assert.strictEqual(keys[1].key, 'key-2');
      freshDb.close();
    });

    it('should return empty array when no keys exist', () => {
      const freshDb = initDb(':memory:');
      const keys = getAllKeys(freshDb);
      assert.deepStrictEqual(keys, []);
      freshDb.close();
    });
  });

  // -------------------------------------------------------------------------
  // validateApiKey
  // -------------------------------------------------------------------------

  describe('validateApiKey', () => {
    it('should return valid=true for a valid active key', () => {
      const created = createKey(db, { owner: 'Valid User' });
      const result = validateApiKey(db, created.key);
      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.owner, 'Valid User');
    });

    it('should return valid=false with reason=unknown_key for non-existent key', () => {
      const result = validateApiKey(db, 'totally-unknown-key');
      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.reason, 'unknown_key');
    });

    it('should return valid=false with reason=revoked for revoked key', () => {
      const created = createKey(db, { owner: 'Will Be Revoked' });
      revokeKey(db, created.key);
      const result = validateApiKey(db, created.key);
      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.reason, 'revoked');
    });

    it('should return valid=false with reason=expired for expired key', () => {
      const created = createKey(db, { owner: 'Expired User', expiresAt: '2000-01-01' });
      const result = validateApiKey(db, created.key);
      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.reason, 'expired');
    });

    it('should return valid=true for key with future expiration', () => {
      const created = createKey(db, { owner: 'Future User', expiresAt: '2099-12-31' });
      const result = validateApiKey(db, created.key);
      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.owner, 'Future User');
      assert.strictEqual(result.expiresAt, '2099-12-31');
    });

    it('should return valid=true for key with null expires_at (never expires)', () => {
      const created = createKey(db, { owner: 'No Expiry' });
      const result = validateApiKey(db, created.key);
      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.expiresAt, null);
    });
  });

  // -------------------------------------------------------------------------
  // revokeKey
  // -------------------------------------------------------------------------

  describe('revokeKey', () => {
    it('should set active=0 for the key', () => {
      const created = createKey(db, { owner: 'To Revoke' });
      const result = revokeKey(db, created.key);
      assert.strictEqual(result, true);
      const row = getKey(db, created.key);
      assert.strictEqual(row.active, 0);
    });

    it('should return false for non-existent key', () => {
      const result = revokeKey(db, 'non-existent-for-revoke');
      assert.strictEqual(result, false);
    });
  });

  // -------------------------------------------------------------------------
  // deleteKey
  // -------------------------------------------------------------------------

  describe('deleteKey', () => {
    it('should permanently remove the key from the database', () => {
      const created = createKey(db, { owner: 'To Delete' });
      const result = deleteKey(db, created.key);
      assert.strictEqual(result, true);
      assert.strictEqual(getKey(db, created.key), null);
    });

    it('should return false for non-existent key', () => {
      const result = deleteKey(db, 'non-existent-for-delete');
      assert.strictEqual(result, false);
    });
  });

  // -------------------------------------------------------------------------
  // renewKey
  // -------------------------------------------------------------------------

  describe('renewKey', () => {
    it('should update expires_at for the key', () => {
      const created = createKey(db, { owner: 'To Renew', expiresAt: '2026-01-01' });
      const result = renewKey(db, created.key, '2027-06-30');
      assert.strictEqual(result, true);
      const row = getKey(db, created.key);
      assert.strictEqual(row.expires_at, '2027-06-30');
    });

    it('should clear expiration when null is passed', () => {
      const created = createKey(db, { owner: 'Renew To Never', expiresAt: '2026-01-01' });
      renewKey(db, created.key, null);
      const row = getKey(db, created.key);
      assert.strictEqual(row.expires_at, null);
    });

    it('should return false for non-existent key', () => {
      const result = renewKey(db, 'non-existent-for-renew', '2027-01-01');
      assert.strictEqual(result, false);
    });
  });

  // -------------------------------------------------------------------------
  // updateKey
  // -------------------------------------------------------------------------

  describe('updateKey', () => {
    it('should update owner field', () => {
      const created = createKey(db, { owner: 'Old Name' });
      const result = updateKey(db, created.key, { owner: 'New Name' });
      assert.strictEqual(result, true);
      const row = getKey(db, created.key);
      assert.strictEqual(row.owner, 'New Name');
    });

    it('should update expiresAt field', () => {
      const created = createKey(db, { owner: 'Update Expires' });
      const result = updateKey(db, created.key, { expiresAt: '2027-01-01' });
      assert.strictEqual(result, true);
      const row = getKey(db, created.key);
      assert.strictEqual(row.expires_at, '2027-01-01');
    });

    it('should update both owner and expiresAt together', () => {
      const created = createKey(db, { owner: 'Old', expiresAt: '2026-01-01' });
      updateKey(db, created.key, { owner: 'New', expiresAt: '2028-01-01' });
      const row = getKey(db, created.key);
      assert.strictEqual(row.owner, 'New');
      assert.strictEqual(row.expires_at, '2028-01-01');
    });

    it('should return false when no fields provided', () => {
      const created = createKey(db, { owner: 'No Update' });
      const result = updateKey(db, created.key, {});
      assert.strictEqual(result, false);
    });

    it('should return false for non-existent key', () => {
      const result = updateKey(db, 'non-existent-for-update', { owner: 'X' });
      assert.strictEqual(result, false);
    });
  });
});
