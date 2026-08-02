/**
 * Secret encryption at rest for lcyt-platforms.
 *
 * This is the repo's first real secrets-at-rest mechanism. The only prior art
 * (`mcp_tokens`) stores one-way hashes, which is useless here: an OAuth refresh
 * token has to come back out in plaintext to be exchanged for an access token,
 * so it must be *encrypted*, not digested.
 *
 * AES-256-GCM with a random 12-byte IV per encryption. The stored blob is
 * base64 of `IV(12) || ciphertext || authTag(16)` — everything needed to
 * decrypt except the key travels with the ciphertext, so a row is
 * self-contained and no separate IV column is needed.
 *
 * FAIL CLOSED. `loadCredentialKey()` throws rather than returning null when
 * PLATFORM_CREDENTIAL_KEY is missing or malformed, and every write path calls
 * it before touching the DB. There is deliberately no plaintext fallback: a
 * deployment without a key must be unable to store a refresh token at all,
 * rather than quietly storing one in the clear. See
 * plan_broadcast_platform_sync.md § "Encryption at rest".
 *
 * KNOWN LIMITATION (v1, called out in the plan): key rotation is not built.
 * Rotating PLATFORM_CREDENTIAL_KEY invalidates every stored credential —
 * operators must reconnect their accounts. Re-encryption tooling is explicitly
 * out of scope.
 */
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const KEY_BYTES = 32;

/**
 * Thrown when the credential key is missing or unusable. Distinct from a
 * decryption failure so callers can tell "this server can't do platform
 * connections at all" apart from "this particular row won't decrypt".
 */
export class CredentialKeyError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CredentialKeyError';
  }
}

/**
 * Decode and validate the configured credential key.
 *
 * @param {string} [raw] base64-encoded 32-byte key; defaults to
 *   process.env.PLATFORM_CREDENTIAL_KEY
 * @returns {Buffer} the 32-byte key
 * @throws {CredentialKeyError} when unset, undecodable, or the wrong length
 */
export function loadCredentialKey(raw = process.env.PLATFORM_CREDENTIAL_KEY) {
  if (!raw) {
    throw new CredentialKeyError(
      'PLATFORM_CREDENTIAL_KEY is not set — refusing to store platform credentials unencrypted',
    );
  }
  let key;
  try {
    key = Buffer.from(raw, 'base64');
  } catch {
    throw new CredentialKeyError('PLATFORM_CREDENTIAL_KEY is not valid base64');
  }
  // Buffer.from() is lenient with base64 — it silently drops invalid characters
  // rather than throwing, so a garbage value reaches us as a short buffer. The
  // length check below is what actually rejects it.
  if (key.length !== KEY_BYTES) {
    throw new CredentialKeyError(
      `PLATFORM_CREDENTIAL_KEY must decode to exactly ${KEY_BYTES} bytes (got ${key.length})`,
    );
  }
  return key;
}

/**
 * Returns true when a usable credential key is configured. Used at startup to
 * warn, and by routes to answer "can this server connect platforms at all?"
 * without throwing.
 * @param {string} [raw]
 * @returns {boolean}
 */
export function hasCredentialKey(raw = process.env.PLATFORM_CREDENTIAL_KEY) {
  try {
    loadCredentialKey(raw);
    return true;
  } catch {
    return false;
  }
}

/**
 * Generate a fresh key, base64-encoded — for operators bootstrapping a
 * deployment ("openssl rand -base64 32" equivalent, without leaving Node).
 * @returns {string}
 */
export function generateCredentialKey() {
  return randomBytes(KEY_BYTES).toString('base64');
}

/**
 * @param {string} plaintext
 * @param {Buffer} key 32 bytes
 * @returns {string} base64 of IV || ciphertext || authTag
 */
export function encryptSecret(plaintext, key) {
  if (typeof plaintext !== 'string') throw new TypeError('encryptSecret expects a string');
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, ciphertext, cipher.getAuthTag()]).toString('base64');
}

/**
 * @param {string} blob base64 of IV || ciphertext || authTag
 * @param {Buffer} key 32 bytes
 * @returns {string} plaintext
 * @throws {Error} on a wrong key or tampered ciphertext (GCM auth tag failure)
 */
export function decryptSecret(blob, key) {
  const buf = Buffer.from(blob, 'base64');
  // An empty plaintext is legitimate (IV + tag + zero-length ciphertext = 28
  // bytes), so the floor is exactly the header/footer size, not one more.
  if (buf.length < IV_BYTES + AUTH_TAG_BYTES) {
    throw new Error('Encrypted credential blob is truncated');
  }
  const iv = buf.subarray(0, IV_BYTES);
  const authTag = buf.subarray(buf.length - AUTH_TAG_BYTES);
  const ciphertext = buf.subarray(IV_BYTES, buf.length - AUTH_TAG_BYTES);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
