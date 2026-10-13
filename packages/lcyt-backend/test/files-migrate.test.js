import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalObjectStore, createS3ObjectStore, createLocalAdapter, createS3Adapter } from 'lcyt-files';
import { startMockS3Server } from '../../plugins/lcyt-files/test/helpers/mock-s3-server.js';
import { initDb, createKey } from '../src/db.js';
import { getDialect } from '../src/db/connection.js';
import { createVideo, getVideo } from '../src/db/videos.js';
import { migrateFiles } from '../src/storage/files-migrate.js';

const STORE_AREAS = ['graphics', 'icons', 'dskThumbnails', 'cameraThumbnails', 'recordings', 'backups'];

describe('migrateFiles', () => {
  let db, root, mock, local, remote, apiKey, videoId, captionPath, savedRecDir;

  before(async () => {
    root = await mkdtemp(join(tmpdir(), 'lcyt-migrate-'));
    savedRecDir = process.env.VIDEOS_STORAGE_DIR;
    process.env.VIDEOS_STORAGE_DIR = join(root, 'recordings');
    db = await initDb(':memory:');
    apiKey = (await createKey(db, { owner: 'Migrate' })).key;
    mock = await startMockS3Server();
    const s3 = { bucket: 'b', region: 'auto', endpoint: `http://127.0.0.1:${mock.port}`, credentials: { accessKeyId: 'x', secretAccessKey: 'y' } };
    local = { stores: {}, captions: createLocalAdapter(join(root, 'files')) };
    remote = { stores: {}, captions: await createS3Adapter({ ...s3, prefix: 'captions' }) };
    for (const area of STORE_AREAS) {
      local.stores[area] = createLocalObjectStore({ baseDir: join(root, area === 'recordings' ? 'recordings' : area) });
      remote.stores[area] = await createS3ObjectStore({ ...s3, prefix: area });
    }
    await local.stores.graphics.put(`${apiKey}/logo.png`, 'png-bytes');
    await local.stores.icons.put(`${apiKey}/i.svg`, '<svg/>');
    videoId = (await createVideo(db, apiKey, { title: 'rec' })).video.id;
    const videoDir = join(process.env.VIDEOS_STORAGE_DIR, apiKey.replace(/[^a-zA-Z0-9._-]+/g, '-'), videoId);
    await mkdir(videoDir, { recursive: true });
    await writeFile(join(videoDir, 'segment1.ts'), 'segment-bytes');
    const handle = local.captions.openAppend(apiKey, 'a.txt');
    await handle.write('hello captions');
    await handle.close();
    captionPath = handle.storedKey;
    await db.prepare('INSERT INTO caption_files (api_key, filename, format) VALUES (?, ?, ?)').run(apiKey, captionPath, 'youtube');
  });

  after(async () => {
    if (savedRecDir === undefined) delete process.env.VIDEOS_STORAGE_DIR; else process.env.VIDEOS_STORAGE_DIR = savedRecDir;
    db.close();
    await mock.stop();
    await rm(root, { recursive: true, force: true });
  });

  it('dry run changes nothing', async () => {
    const result = await migrateFiles({ db, direction: 's3', from: local, to: remote, dryRun: true });
    assert.ok(result.graphics.copied >= 1);
    assert.strictEqual(await remote.stores.graphics.exists(`${apiKey}/logo.png`), false);
    assert.strictEqual((await getVideo(db, apiKey, videoId)).storageType, 'local');
    assert.strictEqual((await db.prepare('SELECT filename FROM caption_files').get()).filename, captionPath);
  });

  it('moves everything to S3 and switches the rows', async () => {
    const result = await migrateFiles({ db, direction: 's3', from: local, to: remote });
    assert.strictEqual(Object.values(result).reduce((n, s) => n + s.failed, 0), 0);
    assert.strictEqual(await remote.stores.graphics.exists(`${apiKey}/logo.png`), true);
    assert.strictEqual(await remote.stores.icons.exists(`${apiKey}/i.svg`), true);
    const video = await getVideo(db, apiKey, videoId);
    assert.strictEqual(video.storageType, 's3');
    assert.strictEqual(await remote.stores.recordings.exists(`${video.storageKey}/segment1.ts`), true);
    const row = await db.prepare('SELECT filename FROM caption_files').get();
    assert.notStrictEqual(row.filename, captionPath);
    const opened = await remote.captions.openRead(apiKey, row.filename, 'youtube');
    const chunks = [];
    for await (const c of opened.stream) chunks.push(c);
    assert.strictEqual(Buffer.concat(chunks).toString(), 'hello captions');
    // Source kept without --delete-source.
    assert.strictEqual(await local.stores.graphics.exists(`${apiKey}/logo.png`), true);
    assert.ok(existsSync(captionPath));
  });

  it('is idempotent: a second run copies nothing', async () => {
    const result = await migrateFiles({ db, direction: 's3', from: local, to: remote });
    assert.strictEqual(result.graphics.copied, 0);
    assert.ok(result.graphics.skipped >= 1);
    assert.strictEqual(result.captions.copied, 0);
  });

  it('moves back to local with --delete-source and removes the S3 copies', async () => {
    await rm(join(root, 'graphics'), { recursive: true, force: true });
    const result = await migrateFiles({ db, direction: 'local', from: remote, to: local, deleteSource: true });
    assert.strictEqual(Object.values(result).reduce((n, s) => n + s.failed, 0), 0);
    assert.strictEqual(await local.stores.graphics.exists(`${apiKey}/logo.png`), true);
    assert.strictEqual(await remote.stores.graphics.exists(`${apiKey}/logo.png`), false);
    const video = await getVideo(db, apiKey, videoId);
    assert.strictEqual(video.storageType, 'local');
    const row = await db.prepare('SELECT filename FROM caption_files').get();
    assert.ok(existsSync(row.filename));
  });

  it('rewrites absolute DSK thumbnail paths to store keys', async () => {
    // PostgreSQL has the table from the migrations; on SQLite only the dsk plugin creates it.
    if (getDialect() === 'sqlite') await db.exec('CREATE TABLE IF NOT EXISTS dsk_thumbnails (id INTEGER PRIMARY KEY AUTOINCREMENT, api_key TEXT NOT NULL, name TEXT NOT NULL, storage_path TEXT NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL)');
    const base = join(root, 'dskThumbnails');
    await mkdir(join(base, 'k'), { recursive: true });
    await writeFile(join(base, 'k', 't.png'), 'png');
    await db.prepare('INSERT INTO dsk_thumbnails (api_key, name, storage_path, width, height) VALUES (?, ?, ?, 1, 1)').run(apiKey, 't', join(base, 'k', 't.png'));
    const result = await migrateFiles({ db, direction: 's3', from: local, to: remote, areas: ['dskThumbnails'], thumbnailsBaseDir: base });
    assert.strictEqual(result.dskThumbnails.rowsUpdated, 1);
    assert.strictEqual((await db.prepare('SELECT storage_path FROM dsk_thumbnails').get()).storage_path, 'k/t.png');
    assert.strictEqual(await remote.stores.dskThumbnails.exists('k/t.png'), true);
  });

  it('rejects an unknown direction or area', async () => {
    await assert.rejects(() => migrateFiles({ db, direction: 'x', from: local, to: remote }));
    await assert.rejects(() => migrateFiles({ db, direction: 's3', from: local, to: remote, areas: ['nope'] }));
  });
});
