import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalObjectStore } from 'lcyt-files';
import { initDb, createKey } from '../src/db.js';
import { purgeKeyFiles } from '../src/storage/purge-key-files.js';
import { iconKeySegment } from '../src/routes/icons.js';
import { createVideo, getVideo } from '../src/db/videos.js';

describe('purgeKeyFiles', () => {
  let db, root, stores, apiKey, otherKey;

  before(async () => {
    db = initDb(':memory:');
    root = await mkdtemp(join(tmpdir(), 'lcyt-purge-'));
    const make = (name) => createLocalObjectStore({ baseDir: join(root, name) });
    stores = {
      graphicsStore: make('graphics'),
      iconsStore: make('icons'),
      dskThumbnailsStore: make('dsk'),
      recordingsStore: make('recordings'),
    };
    apiKey = createKey(db, { owner: 'Purge' }).key;
    otherKey = createKey(db, { owner: 'Keep' }).key;
  });

  after(async () => {
    db.close();
    await rm(root, { recursive: true, force: true });
  });

  it('removes graphics, icons, DSK thumbnails, recordings and caption files of one key only', async () => {
    const seg = (k) => k.replace(/[^a-zA-Z0-9._-]+/g, '_');
    for (const k of [apiKey, otherKey]) {
      await stores.graphicsStore.put(`${seg(k)}/logo.png`, 'png');
      await stores.iconsStore.put(`${iconKeySegment(k)}/icon.svg`, 'svg');
      await stores.dskThumbnailsStore.put(`${seg(k)}/thumb.png`, 'png');
    }
    const video = createVideo(db, apiKey, { storageType: 's3', title: 'rec' }).video;
    await stores.recordingsStore.put(`${video.storageKey}/segment0.ts`, 'ts');
    const otherVideo = createVideo(db, otherKey, { storageType: 's3', title: 'rec2' }).video;
    await stores.recordingsStore.put(`${otherVideo.storageKey}/segment0.ts`, 'ts');

    db.prepare('INSERT INTO caption_files (api_key, filename) VALUES (?, ?)').run(apiKey, 'captions/a.txt');
    const deleted = [];
    const resolveStorage = async () => ({ deleteFile: async (k, f) => { deleted.push([k, f]); } });

    const { failures } = await purgeKeyFiles(db, apiKey, { mediaStores: stores, resolveStorage, imageRows: [{ filename: 'logo.png' }] });

    assert.deepStrictEqual(failures, []);
    assert.strictEqual(await stores.graphicsStore.exists(`${seg(apiKey)}/logo.png`), false);
    assert.strictEqual(await stores.iconsStore.exists(`${iconKeySegment(apiKey)}/icon.svg`), false);
    assert.strictEqual(await stores.dskThumbnailsStore.exists(`${seg(apiKey)}/thumb.png`), false);
    assert.strictEqual(await stores.recordingsStore.exists(`${video.storageKey}/segment0.ts`), false);
    assert.strictEqual(getVideo(db, apiKey, video.id), null);
    assert.deepStrictEqual(deleted, [[apiKey, 'captions/a.txt']]);

    // The other project is untouched.
    assert.strictEqual(await stores.graphicsStore.exists(`${seg(otherKey)}/logo.png`), true);
    assert.strictEqual(await stores.iconsStore.exists(`${iconKeySegment(otherKey)}/icon.svg`), true);
    assert.strictEqual(await stores.dskThumbnailsStore.exists(`${seg(otherKey)}/thumb.png`), true);
    assert.strictEqual(await stores.recordingsStore.exists(`${otherVideo.storageKey}/segment0.ts`), true);
  });

  it('reports a failing step and keeps going', async () => {
    const broken = { ...stores, iconsStore: { deletePrefix: async () => { throw new Error('boom'); } } };
    const { failures } = await purgeKeyFiles(db, otherKey, { mediaStores: broken });
    assert.deepStrictEqual(failures, ['icons']);
  });
});
