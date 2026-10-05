import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mintIngestToken, verifyIngestToken } from '../src/perception/ingest-token.js';

const scope = { apiKey: 'k', cameraId: 'c', feedKind: 'dedicated', jobId: 'j1' };

test('a token verifies only for its own scope and secret', () => {
  const t = mintIngestToken('s', scope);
  assert.equal(verifyIngestToken('s', scope, t), true);
  for (const other of [{ apiKey: 'x' }, { cameraId: 'y' }, { cameraId: null }, { feedKind: 'shared' }, { jobId: 'j2' }]) {
    assert.equal(verifyIngestToken('s', { ...scope, ...other }, t), false);
  }
  assert.equal(verifyIngestToken('other', scope, t), false);
});

test('missing secret, token or scope never verifies', () => {
  const t = mintIngestToken('s', scope);
  assert.equal(verifyIngestToken(null, scope, t), false);
  assert.equal(verifyIngestToken('s', scope, undefined), false);
  assert.equal(verifyIngestToken('s', { apiKey: 'k' }, t), false);
  assert.equal(verifyIngestToken('s', scope, 'short'), false);
});

test('a shared-feed scope (cameraId null) differs from an empty-string camera only by feedKind', () => {
  const a = mintIngestToken('s', { apiKey: 'k', cameraId: null, feedKind: 'shared', jobId: 'j' });
  assert.equal(verifyIngestToken('s', { apiKey: 'k', cameraId: null, feedKind: 'shared', jobId: 'j' }, a), true);
  assert.equal(verifyIngestToken('s', { apiKey: 'k', cameraId: null, feedKind: 'dedicated', jobId: 'j' }, a), false);
});
