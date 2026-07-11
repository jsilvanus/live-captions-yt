/**
 * Tests for createSessionCaptionFileWriter — backend caption-file archiving
 * for delivery paths that bypass POST /captions (server-side STT).
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createLocalAdapter } from 'lcyt-files/src/adapters/local.js';
import { initDb, createKey } from '../src/db.js';
import { createSessionCaptionFileWriter } from '../src/caption-file-writer.js';

let db, filesDir, adapter;

before(() => {
  db = initDb(':memory:');
  createKey(db, { key: 'writer-key', owner: 'Writer', backend_file_enabled: 1 });
  createKey(db, { key: 'disabled-key', owner: 'NoFiles' });
  filesDir = mkdtempSync(join(tmpdir(), 'lcyt-file-writer-'));
  adapter = createLocalAdapter(filesDir);
});

after(() => {
  db.close();
  rmSync(filesDir, { recursive: true, force: true });
});

function makeSession(apiKey, startedAt) {
  return { apiKey, sessionId: 'sess-writer-1', startedAt, _fileHandles: new Map() };
}

async function waitForFiles(apiKey, ext, count, ready, timeoutMs = 2000) {
  const keyDir = join(filesDir, apiKey.replace(/[^a-zA-Z0-9-]/g, '_'));
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    let names = [];
    try { names = readdirSync(keyDir).filter(n => n.endsWith(ext)); } catch {}
    const contents = names.map(n => readFileSync(join(keyDir, n), 'utf8')).filter(ready);
    if (contents.length >= count) return contents;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${count} ${ext} file(s)`);
    await new Promise(r => setTimeout(r, 25));
  }
}

describe('createSessionCaptionFileWriter', () => {
  it('writes original + translations with per-language formats and session-relative VTT cues', async () => {
    const write = createSessionCaptionFileWriter({ db, resolveStorage: async () => adapter });
    const startedAt = new Date('2026-01-01T12:00:00.000Z').getTime();
    const session = makeSession('writer-key', startedAt);

    write(session, {
      text: 'Hello spoken world',
      translations: { 'fi-FI': 'Hei puhuttu maailma' },
      fileFormats: { 'fi-FI': 'vtt' },
      timestamp: new Date(startedAt + 9_000).toISOString().replace('Z', ''),
    });

    // fi-FI requested vtt → WEBVTT file with a session-relative cue
    const vtt = await waitForFiles('writer-key', '.vtt', 1, c => c.includes('-->'));
    assert.ok(vtt[0].startsWith('WEBVTT\n\n'));
    assert.ok(vtt[0].includes('00:00:09.000 --> 00:00:12.000'), vtt[0]);
    assert.ok(vtt[0].includes('Hei puhuttu maailma'));

    // original had no format entry → default plain-text 'youtube'
    const txt = await waitForFiles('writer-key', '.txt', 1, c => c.includes('Hello spoken world'));
    assert.ok(!txt[0].includes('WEBVTT'));
  });

  it('does nothing when backend file saving is disabled for the key', async () => {
    const write = createSessionCaptionFileWriter({ db, resolveStorage: async () => adapter });
    const session = makeSession('disabled-key', Date.now());

    write(session, { text: 'Should not be written', translations: {} });
    await new Promise(r => setTimeout(r, 100));

    const keyDir = join(filesDir, 'disabled-key');
    let names = [];
    try { names = readdirSync(keyDir); } catch {}
    assert.equal(names.length, 0);
    assert.equal(session._fileHandles.size, 0);
  });

  it('is a no-op without resolveStorage and never throws', () => {
    const write = createSessionCaptionFileWriter({ db, resolveStorage: null });
    assert.doesNotThrow(() => write(makeSession('writer-key', Date.now()), { text: 'x' }));
  });
});
