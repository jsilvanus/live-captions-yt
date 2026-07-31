import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

const {
  encryptSecret, decryptSecret, loadCredentialKey, hasCredentialKey,
  generateCredentialKey, CredentialKeyError,
} = await import('../src/crypto.js');

const KEY = randomBytes(32);

describe('encryptSecret / decryptSecret', () => {
  test('round-trips a token', () => {
    const blob = encryptSecret('1//refresh-token-value', KEY);
    assert.equal(decryptSecret(blob, KEY), '1//refresh-token-value');
  });

  test('ciphertext never contains the plaintext', () => {
    const blob = encryptSecret('super-secret-refresh-token', KEY);
    assert.ok(!blob.includes('super-secret'));
    assert.ok(!Buffer.from(blob, 'base64').toString('utf8').includes('super-secret'));
  });

  test('a fresh IV per call means identical plaintext encrypts differently', () => {
    // Without this, an observer could tell that two projects stored the same
    // token just by comparing ciphertext columns.
    assert.notEqual(encryptSecret('same', KEY), encryptSecret('same', KEY));
  });

  test('round-trips unicode and empty strings', () => {
    for (const value of ['', 'ä-ö-å 🎥', 'x'.repeat(4096)]) {
      assert.equal(decryptSecret(encryptSecret(value, KEY), KEY), value);
    }
  });

  test('decrypting with the wrong key fails', () => {
    const blob = encryptSecret('token', KEY);
    assert.throws(() => decryptSecret(blob, randomBytes(32)));
  });

  test('a tampered ciphertext fails the GCM auth tag', () => {
    const buf = Buffer.from(encryptSecret('token', KEY), 'base64');
    buf[buf.length - 20] ^= 0xff; // flip a bit inside the ciphertext body
    assert.throws(() => decryptSecret(buf.toString('base64'), KEY));
  });

  test('a truncated blob is rejected rather than throwing something opaque', () => {
    assert.throws(
      () => decryptSecret(Buffer.from('short').toString('base64'), KEY),
      /truncated/,
    );
  });

  test('encryptSecret refuses a non-string', () => {
    assert.throws(() => encryptSecret(Buffer.from('x'), KEY), TypeError);
  });
});

describe('loadCredentialKey — fail closed', () => {
  test('throws when unset, rather than returning null', () => {
    // The whole point: no caller can accidentally treat "no key" as "store it
    // in plaintext then".
    assert.throws(() => loadCredentialKey(undefined), CredentialKeyError);
    assert.throws(() => loadCredentialKey(''), CredentialKeyError);
  });

  test('throws when the key decodes to the wrong length', () => {
    assert.throws(() => loadCredentialKey(randomBytes(16).toString('base64')), /32 bytes/);
    assert.throws(() => loadCredentialKey(randomBytes(64).toString('base64')), /32 bytes/);
  });

  test('throws on a non-base64 value', () => {
    // Buffer.from() silently drops invalid base64 characters instead of
    // throwing, so this lands on the length check — assert it still fails.
    assert.throws(() => loadCredentialKey('not a real key!!!'), CredentialKeyError);
  });

  test('accepts a valid 32-byte base64 key', () => {
    const raw = randomBytes(32).toString('base64');
    assert.equal(loadCredentialKey(raw).length, 32);
  });

  test('generateCredentialKey produces a key loadCredentialKey accepts', () => {
    assert.equal(loadCredentialKey(generateCredentialKey()).length, 32);
  });

  test('hasCredentialKey answers without throwing', () => {
    assert.equal(hasCredentialKey(generateCredentialKey()), true);
    assert.equal(hasCredentialKey(''), false);
    assert.equal(hasCredentialKey('too-short'), false);
  });
});
