/**
 * Tests for the local filesystem storage adapter and caption-file write helpers.
 *
 * Uses a real temp directory — no mocking of fs. The DB is a simple stub object.
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createLocalAdapter } from '../src/adapters/local.js';
import { writeToBackendFile, closeFileHandles } from '../src/caption-files.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeTmpDir() {
  return mkdtempSync(join(tmpdir(), 'lcyt-files-test-'));
}

function makeDb(overrides = {}) {
  const registered = [];
  const updated = [];
  return {
    registered,
    updated,
    prepare: (sql) => {
      if (sql.includes('INSERT INTO caption_files')) {
        return {
          run: (...args) => {
            const id = registered.length + 1;
            registered.push({ id, args });
            return { lastInsertRowid: id };
          },
        };
      }
      if (sql.includes('UPDATE caption_files')) {
        return { run: (...args) => { updated.push(args); } };
      }
      return { run: () => {}, get: () => null, all: () => [] };
    },
    ...overrides,
  };
}

function buildVttCue(seq, startMs, endMs, text) {
  const fmt = ms => {
    const hh = String(Math.floor(ms / 3600000)).padStart(2, '0');
    const mm = String(Math.floor((ms % 3600000) / 60000)).padStart(2, '0');
    const ss = String(Math.floor((ms % 60000) / 1000)).padStart(2, '0');
    const msStr = String(ms % 1000).padStart(3, '0');
    return `${hh}:${mm}:${ss}.${msStr}`;
  };
  return `${seq}\n${fmt(startMs)} --> ${fmt(endMs)}\n${text}\n\n`;
}

// ─── createLocalAdapter ───────────────────────────────────────────────────────

describe('createLocalAdapter', () => {
  let baseDir;

  beforeEach(() => { baseDir = makeTmpDir(); });
  afterEach(() => { rmSync(baseDir, { recursive: true, force: true }); });

  test('keyDir creates subdirectory', () => {
    const adapter = createLocalAdapter(baseDir);
    const dir = adapter.keyDir('myApiKey123');
    assert.match(dir, /myApiKey123/);
    assert.ok(existsSync(dir));
  });

  test('keyDir sanitizes special characters', () => {
    const adapter = createLocalAdapter(baseDir);
    const dir = adapter.keyDir('key/with:special!chars');
    // Should not contain path separators
    assert.doesNotMatch(dir.slice(baseDir.length + 1), /\//);
  });

  test('openAppend returns handle with storedKey', () => {
    const adapter = createLocalAdapter(baseDir);
    const handle = adapter.openAppend('myApiKey123', 'test.txt');
    assert.ok(handle.storedKey.endsWith('test.txt'));
    return handle.close();
  });

  test('write() appends data to file', async () => {
    const adapter = createLocalAdapter(baseDir);
    const handle = adapter.openAppend('myApiKey123', 'captions.txt');
    await handle.write('Hello\n');
    await handle.write('World\n');
    await handle.close();
    const content = readFileSync(handle.storedKey, 'utf8');
    assert.equal(content, 'Hello\nWorld\n');
  });

  test('sizeBytes() returns current file size', async () => {
    const adapter = createLocalAdapter(baseDir);
    const handle = adapter.openAppend('myApiKey123', 'size.txt');
    await handle.write('abcdef\n');
    // Size is available after writes are flushed
    await handle.close();
    assert.ok(handle.sizeBytes() >= 7);
  });

  test('openRead() returns a readable stream', async () => {
    const adapter = createLocalAdapter(baseDir);
    // Write a file first
    const wHandle = adapter.openAppend('myApiKey123', 'read.txt');
    await wHandle.write('test content');
    await wHandle.close();

    const { stream, contentType, size } = adapter.openRead('myApiKey123', wHandle.storedKey, 'youtube');
    assert.equal(contentType, 'text/plain');
    assert.ok(size > 0);
    // Read stream to end
    const chunks = [];
    await new Promise((resolve, reject) => {
      stream.on('data', c => chunks.push(c));
      stream.on('end', resolve);
      stream.on('error', reject);
    });
    assert.equal(Buffer.concat(chunks).toString(), 'test content');
  });

  test('openRead() sets vtt content type for vtt format', async () => {
    const adapter = createLocalAdapter(baseDir);
    const wHandle = adapter.openAppend('key1', 'subs.vtt');
    await wHandle.write('WEBVTT\n\n');
    await wHandle.close();
    const { stream, contentType } = adapter.openRead('key1', wHandle.storedKey, 'vtt');
    assert.equal(contentType, 'text/vtt');
    // Drain stream to avoid dangling resource
    await new Promise((resolve, reject) => {
      stream.resume();
      stream.on('end', resolve);
      stream.on('error', reject);
    });
  });

  test('deleteFile() removes the file', async () => {
    const adapter = createLocalAdapter(baseDir);
    const handle = adapter.openAppend('myApiKey123', 'del.txt');
    await handle.write('bye');
    await handle.close();
    assert.ok(existsSync(handle.storedKey));
    await adapter.deleteFile('myApiKey123', handle.storedKey);
    assert.ok(!existsSync(handle.storedKey));
  });

  test('deleteFile() is safe when file does not exist', async () => {
    const adapter = createLocalAdapter(baseDir);
    await assert.doesNotReject(() => adapter.deleteFile('myApiKey123', '/nonexistent/path/file.txt'));
  });

  test('describe() returns informative string', () => {
    const adapter = createLocalAdapter(baseDir);
    const desc = adapter.describe();
    assert.ok(desc.includes('local'));
    assert.ok(desc.includes(baseDir));
  });
});

// ─── writeToBackendFile ───────────────────────────────────────────────────────

describe('writeToBackendFile', () => {
  let baseDir;

  beforeEach(() => { baseDir = makeTmpDir(); });
  afterEach(() => { rmSync(baseDir, { recursive: true, force: true }); });

  test('creates new file handle on first call and appends plain text', async () => {
    const adapter = createLocalAdapter(baseDir);
    const db = makeDb();
    const fileHandles = new Map();
    const ctx = { apiKey: 'key1', sessionId: 'sess0001', lang: 'original', format: 'youtube', fileHandles };

    await writeToBackendFile(ctx, 'Hello world', undefined, db, adapter, buildVttCue);

    assert.equal(fileHandles.size, 1);
    assert.equal(db.registered.length, 1);
    const entry = fileHandles.get('original:youtube');
    const content = readFileSync(entry.handle.storedKey, 'utf8');
    assert.ok(content.includes('Hello world'));
  });

  test('reuses existing handle on second call', async () => {
    const adapter = createLocalAdapter(baseDir);
    const db = makeDb();
    const fileHandles = new Map();
    const ctx = { apiKey: 'key1', sessionId: 'sess0001', lang: 'original', format: 'youtube', fileHandles };

    await writeToBackendFile(ctx, 'Line 1', undefined, db, adapter, buildVttCue);
    await writeToBackendFile(ctx, 'Line 2', undefined, db, adapter, buildVttCue);

    // Only one DB registration even with two writes
    assert.equal(db.registered.length, 1);
    assert.equal(fileHandles.size, 1);
    const entry = fileHandles.get('original:youtube');
    const content = readFileSync(entry.handle.storedKey, 'utf8');
    assert.ok(content.includes('Line 1'));
    assert.ok(content.includes('Line 2'));
  });

  test('separate handles per lang', async () => {
    const adapter = createLocalAdapter(baseDir);
    const db = makeDb();
    const fileHandles = new Map();

    await writeToBackendFile(
      { apiKey: 'key1', sessionId: 'sess0001', lang: 'original', format: 'youtube', fileHandles },
      'Original', undefined, db, adapter, buildVttCue,
    );
    await writeToBackendFile(
      { apiKey: 'key1', sessionId: 'sess0001', lang: 'fi-FI', format: 'youtube', fileHandles },
      'Suomi', undefined, db, adapter, buildVttCue,
    );

    assert.equal(fileHandles.size, 2);
    assert.equal(db.registered.length, 2);
  });

  test('writes VTT header and cue for vtt format', async () => {
    const adapter = createLocalAdapter(baseDir);
    const db = makeDb();
    const fileHandles = new Map();
    const ts = new Date('2026-01-01T12:00:00.000Z').toISOString();

    await writeToBackendFile(
      { apiKey: 'key1', sessionId: 'sess0001', lang: 'original', format: 'vtt', fileHandles },
      'VTT caption', ts, db, adapter, buildVttCue,
    );

    const entry = fileHandles.get('original:vtt');
    await entry.handle.close();
    const content = readFileSync(entry.handle.storedKey, 'utf8');
    assert.ok(content.startsWith('WEBVTT\n\n'));
    assert.ok(content.includes('VTT caption'));
    assert.ok(content.includes('-->'));
  });

  test('increments sequence number', async () => {
    const adapter = createLocalAdapter(baseDir);
    const db = makeDb();
    const fileHandles = new Map();
    const ctx = { apiKey: 'key1', sessionId: 'sess0001', lang: 'original', format: 'youtube', fileHandles };

    await writeToBackendFile(ctx, 'A', undefined, db, adapter, buildVttCue);
    await writeToBackendFile(ctx, 'B', undefined, db, adapter, buildVttCue);
    await writeToBackendFile(ctx, 'C', undefined, db, adapter, buildVttCue);

    const entry = fileHandles.get('original:youtube');
    assert.equal(entry.seq.current, 3);
  });
});

// ─── closeFileHandles ─────────────────────────────────────────────────────────

describe('closeFileHandles', () => {
  let baseDir;

  beforeEach(() => { baseDir = makeTmpDir(); });
  afterEach(() => { rmSync(baseDir, { recursive: true, force: true }); });

  test('closes all open handles and clears the map', async () => {
    const adapter = createLocalAdapter(baseDir);
    const db = makeDb();
    const fileHandles = new Map();

    await writeToBackendFile(
      { apiKey: 'key1', sessionId: 'sess0001', lang: 'original', format: 'youtube', fileHandles },
      'text', undefined, db, adapter, buildVttCue,
    );
    await writeToBackendFile(
      { apiKey: 'key1', sessionId: 'sess0001', lang: 'fi-FI', format: 'youtube', fileHandles },
      'suomi', undefined, db, adapter, buildVttCue,
    );

    assert.equal(fileHandles.size, 2);
    await closeFileHandles(fileHandles);
    assert.equal(fileHandles.size, 0);
  });

  test('is a no-op for null or empty map', async () => {
    await assert.doesNotReject(() => closeFileHandles(null));
    await assert.doesNotReject(() => closeFileHandles(new Map()));
  });
});
