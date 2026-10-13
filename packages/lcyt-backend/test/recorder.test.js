import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { initDb } from '../src/db.js';
import { startVideoRecording, getVideo, getVideoStorageDir } from '../src/db/videos.js';
import {
  mediaMtxRecordPath, configureMediaMtxRecording, concatListText, listRecordedSegments, finalizeVideoRecording,
} from '../src/recording/recorder.js';

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;

/** A small fragmented-MP4 segment like MediaMTX writes (h264 + aac). */
function makeSegment(file, seconds, hz) {
  const r = spawnSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', `testsrc=size=320x180:rate=25:duration=${seconds}`,
    '-f', 'lavfi', '-i', `sine=frequency=${hz}:duration=${seconds}`,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest',
    '-movflags', '+frag_keyframe+empty_moov+default_base_moof', file,
  ]);
  assert.equal(r.status, 0, String(r.stderr));
}

describe('recorder', () => {
  let tempDir;
  let db;
  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'lcyt-recorder-'));
    process.env.VIDEOS_STORAGE_DIR = join(tempDir, 'recordings');
    db = await initDb(':memory:');
    await db.prepare('INSERT INTO api_keys (key, owner) VALUES (?, ?)').run('demo-key', 'demo');
  });
  afterEach(async () => {
    try { await db?.close?.(); } catch {}
    rmSync(tempDir, { recursive: true, force: true });
    delete process.env.VIDEOS_STORAGE_DIR;
    delete process.env.MEDIAMTX_RECORD_DIR;
  });

  it('builds a MediaMTX recordPath template with %path and time variables', () => {
    const p = mediaMtxRecordPath('demo-key', 'vid1');
    assert.ok(p.startsWith(join(tempDir, 'recordings').split('\\').join('/')));
    assert.match(p, /\/demo-key\/vid1\/%path\/%Y-%m-%d_%H-%M-%S-%f$/);
  });

  it('uses MEDIAMTX_RECORD_DIR for the path MediaMTX sees', () => {
    process.env.MEDIAMTX_RECORD_DIR = '/recordings';
    assert.equal(mediaMtxRecordPath('demo-key', 'vid1'), '/recordings/demo-key/vid1/%path/%Y-%m-%d_%H-%M-%S-%f');
  });

  it('patches MediaMTX with boolean/duration settings and never throws', async () => {
    const calls = [];
    const client = { addPath: async (...a) => calls.push(['add', ...a]), patchPath: async (...a) => calls.push(['patch', ...a]) };
    assert.equal(await configureMediaMtxRecording(client, { pathName: 'p', apiKey: 'demo-key', videoId: 'v', enabled: true }), true);
    const cfg = calls.find((c) => c[0] === 'patch')[2];
    assert.equal(cfg.record, true);
    assert.equal(cfg.recordFormat, 'fmp4');
    assert.equal(cfg.recordDeleteAfter, '0s');
    const bad = { addPath: async () => {}, patchPath: async () => { throw new Error('boom'); } };
    assert.equal(await configureMediaMtxRecording(bad, { pathName: 'p', apiKey: 'demo-key', videoId: 'v', enabled: false }), false);
  });

  it('escapes quotes in the concat list', () => {
    assert.equal(concatListText(["/a/it's.mp4"]), "file '/a/it'\\''s.mp4'\n");
  });

  it('finalize without segments marks the video failed', async () => {
    const v = (await startVideoRecording(db, 'demo-key', { title: 'empty' })).video;
    const r = await finalizeVideoRecording(db, 'demo-key', v.id, { settleMs: 0 });
    assert.equal(r.ok, false);
    assert.equal((await getVideo(db, 'demo-key', v.id)).status, 'failed');
  });

  it('finalize builds a playable HLS VOD from MediaMTX segments in time order', { skip: !hasFfmpeg }, async () => {
    const v = (await startVideoRecording(db, 'demo-key', { title: 'real' })).video;
    const dir = getVideoStorageDir('demo-key', v.id);
    mkdirSync(join(dir, 'ingest-path'), { recursive: true });
    makeSegment(join(dir, 'ingest-path', '2026-10-12_08-00-04-000000.mp4'), 2, 880);
    makeSegment(join(dir, 'ingest-path', '2026-10-12_08-00-00-000000.mp4'), 2, 440);
    assert.deepEqual(listRecordedSegments(dir).map((s) => s.rel.split('/').pop()),
      ['2026-10-12_08-00-00-000000.mp4', '2026-10-12_08-00-04-000000.mp4']);

    const r = await finalizeVideoRecording(db, 'demo-key', v.id, { settleMs: 0 });
    assert.equal(r.ok, true);
    const playlist = readFileSync(join(dir, 'playlist.m3u8'), 'utf8');
    assert.match(playlist, /#EXT-X-PLAYLIST-TYPE:VOD/);
    assert.match(playlist, /#EXT-X-ENDLIST/);
    assert.ok(readdirSync(dir).some((f) => f.endsWith('.ts')));
    assert.equal(listRecordedSegments(dir).length, 0, 'raw segments are removed');
    const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', join(dir, 'playlist.m3u8')]);
    assert.ok(Number(String(probe.stdout).trim()) >= 3.5, `duration ${probe.stdout}`);
    const done = await getVideo(db, 'demo-key', v.id);
    assert.equal(done.status, 'completed');
    assert.ok(done.sizeBytes > 0);
  });
});
