/**
 * lcyt-files plugin entry point.
 *
 * Provides storage-adapter–backed caption file I/O for lcyt-backend.
 * Supports local filesystem (default) and S3-compatible object storage.
 *
 * Usage in lcyt-backend/src/server.js:
 *
 *   import { initFilesControl, createFilesRouter, writeToBackendFile, closeFileHandles } from 'lcyt-files';
 *
 *   const { storage } = await initFilesControl(db);
 *
 *   // Wire into captions.js:
 *   app.use(createSessionRouters(db, store, jwtSecret, auth, { relayManager, dskCaptionProcessor, storage }));
 *
 *   // Wire into content.js:
 *   app.use(createContentRouters(db, auth, store, jwtSecret, { ..., storage }));
 *
 *   // Close handles when a session ends:
 *   store.onSessionEnd = async (session) => {
 *     if (session._fileHandles) await closeFileHandles(session._fileHandles);
 *     // ... other teardown ...
 *   };
 */

export { writeToBackendFile, closeFileHandles } from './caption-files.js';
export { createFilesRouter } from './routes/files.js';

import { createStorageAdapter } from './storage.js';

/**
 * Initialise the files plugin: create the storage adapter and log its config.
 *
 * Does not run any DB migrations — the `caption_files` table is owned by
 * lcyt-backend's schema.js and already exists.
 *
 * @param {import('better-sqlite3').Database} _db  (reserved for future per-key DB config)
 * @returns {Promise<{ storage: import('./adapters/types.js').StorageAdapter }>}
 */
export async function initFilesControl(_db) {
  const storage = await createStorageAdapter();
  console.info(storage.describe?.() ?? '✓ File storage initialised');
  return { storage };
}
