import { join, resolve } from 'node:path';
import { createObjectStoreFromEnv } from 'lcyt-files';

export function isMediaStorageS3(settings = null) {
  const mode = settings ? settings.get('storage.file_storage') : (process.env.FILE_STORAGE || 'local');
  return mode === 's3';
}

export async function createMediaStores(settings = null) {
  const graphicsDir = resolve(process.env.GRAPHICS_DIR || '/data/images');
  const iconsDir = resolve(process.env.ICONS_DIR || '/data/icons');
  const dskThumbnailsDir = resolve(process.env.DSK_THUMBNAILS_DIR || join(process.cwd(), 'data', 'dsk-thumbnails'));
  const cameraThumbnailsDir = resolve(process.env.CAMERA_THUMBNAILS_DIR || '/data/camera-thumbnails');
  const recordingsDir = resolve(process.env.VIDEOS_STORAGE_DIR || join(process.cwd(), 'recordings'));

  const [graphicsStore, iconsStore, dskThumbnailsStore, cameraThumbnailsStore, recordingsStore] = await Promise.all([
    createObjectStoreFromEnv({ settings, localBaseDir: graphicsDir, s3Prefix: 'graphics' }),
    createObjectStoreFromEnv({ settings, localBaseDir: iconsDir, s3Prefix: 'icons' }),
    createObjectStoreFromEnv({ settings, localBaseDir: dskThumbnailsDir, s3Prefix: 'thumbnails/dsk' }),
    createObjectStoreFromEnv({ settings, localBaseDir: cameraThumbnailsDir, s3Prefix: 'thumbnails/camera' }),
    createObjectStoreFromEnv({ settings, localBaseDir: recordingsDir, s3Prefix: 'recordings' }),
  ]);

  return {
    graphicsStore,
    iconsStore,
    dskThumbnailsStore,
    cameraThumbnailsStore,
    recordingsStore,
  };
}
