#!/usr/bin/env node
/**
 * Move LCYT stored files between the local filesystem and S3.
 *
 *   npm run files:migrate -w packages/lcyt-backend -- --to s3 [--dry-run] [--delete-source] [--area graphics,icons,...]
 *
 * Reads the same environment as the backend: DB_PATH, the local directories
 * (GRAPHICS_DIR, ICONS_DIR, DSK_THUMBNAILS_DIR, CAMERA_THUMBNAILS_DIR,
 * VIDEOS_STORAGE_DIR, BACKUP_DIR, FILES_DIR) and S3_BUCKET, S3_REGION,
 * S3_ENDPOINT, S3_PREFIX, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY.
 * Stop uploads (or the backend) while it runs. Re-running is safe.
 */
import { join, resolve } from 'node:path';
import { createLocalObjectStore, createS3ObjectStore, createLocalAdapter, createS3Adapter } from 'lcyt-files';
import { initDb } from '../src/db.js';
import { migrateFiles, MIGRATE_AREAS } from '../src/storage/files-migrate.js';

function parseArgs(argv) {
  const out = { to: null, dryRun: false, deleteSource: false, areas: MIGRATE_AREAS };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--to') out.to = argv[++i];
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--delete-source') out.deleteSource = true;
    else if (a === '--area') out.areas = String(argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--help' || a === '-h') out.help = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  return out;
}

const usage = `Usage: files-migrate --to s3|local [--dry-run] [--delete-source] [--area ${MIGRATE_AREAS.join(',')}]`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || (args.to !== 's3' && args.to !== 'local')) {
    console.log(usage);
    process.exit(args.help ? 0 : 1);
  }
  const bucket = process.env.S3_BUCKET;
  if (!bucket) throw new Error('S3_BUCKET must be set');
  const s3 = {
    bucket,
    region: process.env.S3_REGION || 'auto',
    endpoint: process.env.S3_ENDPOINT || undefined,
    credentials: process.env.S3_ACCESS_KEY_ID
      ? { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '' }
      : undefined,
  };
  const dirs = {
    graphics: resolve(process.env.GRAPHICS_DIR || '/data/images'),
    icons: resolve(process.env.ICONS_DIR || '/data/icons'),
    dskThumbnails: resolve(process.env.DSK_THUMBNAILS_DIR || join(process.cwd(), 'data', 'dsk-thumbnails')),
    cameraThumbnails: resolve(process.env.CAMERA_THUMBNAILS_DIR || '/data/camera-thumbnails'),
    recordings: resolve(process.env.VIDEOS_STORAGE_DIR || join(process.cwd(), 'recordings')),
    backups: resolve(process.env.BACKUP_DIR || '/backups'),
  };
  const prefixes = {
    graphics: 'graphics', icons: 'icons', dskThumbnails: 'thumbnails/dsk',
    cameraThumbnails: 'thumbnails/camera', recordings: 'recordings', backups: 'backups',
  };

  const local = { stores: {}, captions: createLocalAdapter(resolve(process.env.FILES_DIR || '/data/files')) };
  const remote = { stores: {}, captions: await createS3Adapter({ ...s3, prefix: process.env.S3_PREFIX || 'captions' }) };
  for (const area of Object.keys(dirs)) {
    local.stores[area] = createLocalObjectStore({ baseDir: dirs[area] });
    remote.stores[area] = await createS3ObjectStore({ ...s3, prefix: prefixes[area] });
  }

  const db = initDb(process.env.DB_PATH || './lcyt-backend.db');
  const [from, to] = args.to === 's3' ? [local, remote] : [remote, local];
  console.log(`${args.dryRun ? '[dry run] ' : ''}Moving files to ${args.to}: ${args.areas.join(', ')}`);
  const result = await migrateFiles({
    db,
    direction: args.to,
    from,
    to,
    areas: args.areas,
    dryRun: args.dryRun,
    deleteSource: args.deleteSource,
    thumbnailsBaseDir: dirs.dskThumbnails,
    log: (msg) => console.warn(`  ! ${msg}`),
  });
  let failed = 0;
  for (const [area, s] of Object.entries(result)) {
    failed += s.failed;
    console.log(`${area.padEnd(18)} copied ${s.copied}, already there ${s.skipped}, failed ${s.failed}, source deleted ${s.deleted}, ${s.bytes} bytes${s.rowsUpdated ? `, ${s.rowsUpdated} rows updated` : ''}`);
  }
  db.close();
  process.exit(failed > 0 ? 2 : 0);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
