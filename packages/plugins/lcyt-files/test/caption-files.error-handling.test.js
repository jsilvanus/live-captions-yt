/**
 * Error-handling tests for writeToBackendFile and closeFileHandles.
 *
 * These tests verify that errors from the storage adapter are surfaced correctly
 * and that the helpers are resilient to partial failures.
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createLocalAdapter } from '../src/adapters/local.js';
import { writeToBackendFile, closeFileHandles } from '../src/caption-files.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeTmpDir() {
  return fs.mkdtempSync(join(tmpdir(), 'lcyt-files-err-test-'));
}

function makeDb() {
  let nextId = 1;
  return {
    prepare: (sql) => {
      if (sql.includes('INSERT INTO caption_files')) {
        return { run: (..._args) => ({ lastInsertRowid: nextId++ }) };
      }
      if (sql.includes('UPDATE caption_files')) {
        return { run: () => {} };
      }
      return { run: () => {}, get: () => null, all: () => [] };
    },
  };
}

function buildVttCue(seq, startMs, endMs, text) {
  return `${seq}\n00:00:00.000 --> 00:00:03.000\n${text}\n\n`;
}

/** Adapter whose openAppend always throws. */
function makeFailingAppendAdapter(err) {
  return {
    openAppend: () => { throw err; },
    keyDir: () => '/dev/null',
    describe: () => '✗ failing adapter',
  };
}

/**
 * Pure in-memory adapter whose write() always rejects.
 * No real file I/O — avoids dangling WriteStream resources in tests.
 */
function makeFailingWriteAdapter() {
  return {
    openAppend: (_apiKey, filename) => ({
      storedKey: `/fake/${filename}`,
      write: () => Promise.reject(new Error('write error injected')),
      close: () => Promise.resolve(),
      sizeBytes: () => 0,
    }),
    keyDir: () => '/fake',
    describe: () => '✗ failing-write adapter',
  };
}

/** Adapter whose handle.close() always rejects. */
function makeFailingCloseAdapter(baseDir) {
  const real = createLocalAdapter(baseDir);
  return {
    ...real,
    openAppend: (apiKey, filename) => {
      const realHandle = real.openAppend(apiKey, filename);
      return {
        ...realHandle,
        close: () => Promise.reject(new Error('close error injected')),
      };
    },
  };
}

// ─── writeToBackendFile error handling ───────────────────────────────────────

describe('writeToBackendFile — error handling', () => {
  let baseDir;

  beforeEach(() => { baseDir = makeTmpDir(); });
  afterEach(() => { fs.rmSync(baseDir, { recursive: true, force: true }); });

  test('rethrows error when storage.openAppend throws', async () => {
    const openErr = new Error('storage unavailable');
    const adapter = makeFailingAppendAdapter(openErr);
    const db = makeDb();
    const fileHandles = new Map();
    const ctx = { apiKey: 'key1', sessionId: 'sess0001', lang: 'original', format: 'youtube', fileHandles };

    await assert.rejects(
      () => writeToBackendFile(ctx, 'Hello', undefined, db, adapter, buildVttCue),
      /storage unavailable/,
      'should rethrow the openAppend error',
    );
  });

  test('rethrows error when handle.write rejects', async () => {
    const adapter = makeFailingWriteAdapter();
    const db = makeDb();
    const fileHandles = new Map();
    const ctx = { apiKey: 'key1', sessionId: 'sess0001', lang: 'original', format: 'youtube', fileHandles };

    await assert.rejects(
      () => writeToBackendFile(ctx, 'Hello', undefined, db, adapter, buildVttCue),
      /write error injected/,
      'should rethrow the handle.write rejection',
    );
  });

  test('does not register DB file on openAppend failure', async () => {
    const adapter = makeFailingAppendAdapter(new Error('fail'));
    const db = makeDb();
    const fileHandles = new Map();
    const ctx = { apiKey: 'key1', sessionId: 'sess0001', lang: 'original', format: 'youtube', fileHandles };

    try { await writeToBackendFile(ctx, 'Hello', undefined, db, adapter, buildVttCue); } catch {}

    assert.equal(fileHandles.size, 0, 'no file handle should be registered on openAppend failure');
  });

  test('openAppend is not called again for same key after first write succeeds', async () => {
    let appendCalls = 0;
    const real = createLocalAdapter(baseDir);
    const counting = {
      ...real,
      openAppend: (...args) => { appendCalls++; return real.openAppend(...args); },
    };
    const db = makeDb();
    const fileHandles = new Map();
    const ctx = { apiKey: 'key1', sessionId: 'sess0001', lang: 'original', format: 'youtube', fileHandles };

    await writeToBackendFile(ctx, 'First', undefined, db, counting, buildVttCue);
    await writeToBackendFile(ctx, 'Second', undefined, db, counting, buildVttCue);

    assert.equal(appendCalls, 1, 'openAppend should only be called once per (lang, format) pair');
  });
});

// ─── closeFileHandles — resilience ───────────────────────────────────────────

describe('closeFileHandles — error resilience', () => {
  let baseDir;

  beforeEach(() => { baseDir = makeTmpDir(); });
  afterEach(() => { fs.rmSync(baseDir, { recursive: true, force: true }); });

  test('does not throw when one handle.close() rejects', async () => {
    const adapter = makeFailingCloseAdapter(baseDir);
    const db = makeDb();
    const fileHandles = new Map();
    const ctx = { apiKey: 'key1', sessionId: 'sess0001', lang: 'original', format: 'youtube', fileHandles };

    // Seed a handle into the map so closeFileHandles has something to close
    await writeToBackendFile(ctx, 'Hello', undefined, db, adapter, buildVttCue);
    assert.equal(fileHandles.size, 1);

    // closeFileHandles should not throw even if close() rejects
    await assert.doesNotReject(
      () => closeFileHandles(fileHandles),
      'closeFileHandles should swallow individual close() rejections',
    );
  });

  test('clears the map even when close() rejects', async () => {
    const adapter = makeFailingCloseAdapter(baseDir);
    const db = makeDb();
    const fileHandles = new Map();
    const ctx = { apiKey: 'key1', sessionId: 'sess0001', lang: 'original', format: 'youtube', fileHandles };

    await writeToBackendFile(ctx, 'Hello', undefined, db, adapter, buildVttCue);
    await closeFileHandles(fileHandles).catch(() => {});

    assert.equal(fileHandles.size, 0, 'map should be cleared even after close() failure');
  });

  test('handles multiple failing closes (all attempted, none throws)', async () => {
    const adapter = makeFailingCloseAdapter(baseDir);
    const db = makeDb();
    const fileHandles = new Map();

    // Write two different lang handles so we have two entries
    await writeToBackendFile(
      { apiKey: 'key1', sessionId: 'sess0001', lang: 'en', format: 'youtube', fileHandles },
      'English', undefined, db, adapter, buildVttCue,
    );
    await writeToBackendFile(
      { apiKey: 'key1', sessionId: 'sess0001', lang: 'fi', format: 'youtube', fileHandles },
      'Finnish', undefined, db, adapter, buildVttCue,
    );

    assert.equal(fileHandles.size, 2);
    await assert.doesNotReject(() => closeFileHandles(fileHandles));
    assert.equal(fileHandles.size, 0);
  });
});

