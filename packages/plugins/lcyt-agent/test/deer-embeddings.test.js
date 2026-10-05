import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeDeerEmbeddings, closeDeerEmbeddings, resolveDeerTarget,
  DEER_DEFAULT_ADDRESS, DEER_DEFAULT_MODEL,
} from '../src/deer-embeddings.js';
import { VALID_PROVIDERS } from '../src/ai-config.js';

function fakeEmbedder(log, { fail = false } = {}) {
  return {
    create: async (model, opts) => {
      log.creates.push({ model, opts });
      return {
        embed: async texts => {
          if (fail) throw new Error('server gone');
          return texts.map((t, i) => new Float32Array([t.length, i]));
        },
        destroy: async () => { log.destroyed++; },
      };
    },
  };
}

describe('deer embeddings', () => {
  afterEach(() => closeDeerEmbeddings());

  test('deer is a valid embedding provider', () => {
    assert.ok(VALID_PROVIDERS.includes('deer'));
  });

  test('resolves address and model: options, then env, then defaults', () => {
    assert.deepEqual(resolveDeerTarget({}, {}), { address: DEER_DEFAULT_ADDRESS, model: DEER_DEFAULT_MODEL });
    assert.deepEqual(resolveDeerTarget({}, { DEER_EMBED_ADDRESS: 'h:1', DEER_EMBED_MODEL: 'm' }), { address: 'h:1', model: 'm' });
    assert.deepEqual(resolveDeerTarget({ apiUrl: 'x:2', model: 'y' }, { DEER_EMBED_ADDRESS: 'h:1' }), { address: 'x:2', model: 'y' });
  });

  test('connects to the gRPC server without auto-starting one, returns plain arrays, reuses the client', async () => {
    const log = { creates: [], destroyed: 0 };
    const loadEmbedder = async () => fakeEmbedder(log);
    const opts = { apiUrl: 'deer.local:50051', model: 'test-model' };
    const first = await computeDeerEmbeddings(['ab', 'cde'], opts, { loadEmbedder });
    assert.deepEqual(first, [[2, 0], [3, 1]]);
    assert.ok(Array.isArray(first[0]));
    await computeDeerEmbeddings(['x'], opts, { loadEmbedder });
    assert.equal(log.creates.length, 1);
    assert.deepEqual(log.creates[0], {
      model: 'test-model',
      opts: { mode: 'grpc', grpcAddress: 'deer.local:50051', autoStartServer: false },
    });
  });

  test('a failed call drops the cached client so the next call reconnects', async () => {
    const log = { creates: [], destroyed: 0 };
    const opts = { apiUrl: 'deer.local:50052', model: 'm' };
    await assert.rejects(computeDeerEmbeddings(['a'], opts, { loadEmbedder: async () => fakeEmbedder(log, { fail: true }) }), /server gone/);
    await computeDeerEmbeddings(['a'], opts, { loadEmbedder: async () => fakeEmbedder(log) });
    assert.equal(log.creates.length, 2);
    assert.equal(log.destroyed, 1);
  });

  test('a vector count mismatch is an error', async () => {
    const loadEmbedder = async () => ({ create: async () => ({ embed: async () => [[1]], destroy: async () => {} }) });
    await assert.rejects(computeDeerEmbeddings(['a', 'b'], { apiUrl: 'deer.local:50053' }, { loadEmbedder }), /unexpected number/);
  });

  test('missing package gives an actionable error', async () => {
    await assert.rejects(computeDeerEmbeddings(['a'], { apiUrl: 'deer.local:50054' }), /@jsilvanus\/embedeer/);
  });
});
