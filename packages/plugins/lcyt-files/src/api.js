/**
 * lcyt-files plugin entry point.
 *
 * Provides storage-adapter–backed caption file I/O for lcyt-backend.
 * Supports three storage modes:
 *   1. local (default)          — local filesystem via FILES_DIR
 *   2. build-time S3            — operator-configured via S3_* env vars
 *   3. user-defined (runtime) S3 — per-key credentials stored in DB;
 *                                  requires "custom-storage" project feature
 *
 * Usage in lcyt-backend/src/server.js:
 *
 *   import { initFilesControl, createFilesRouter, writeToBackendFile, closeFileHandles } from 'lcyt-files';
 *
 *   const { storage, resolveStorage, invalidateStorageCache } = await initFilesControl(db);
 *
 *   // Wire into captions.js (resolveStorage selects the right adapter per key):
 *   app.use(createSessionRouters(db, store, jwtSecret, auth, { relayManager, dskCaptionProcessor, resolveStorage }));
 *
 *   // Wire into content.js:
 *   app.use(createContentRouters(db, auth, store, jwtSecret, { ..., resolveStorage, invalidateStorageCache }));
 *
 *   // Close handles when a session ends:
 *   store.onSessionEnd = async (session) => {
 *     if (session._fileHandles) await closeFileHandles(session._fileHandles);
 *     // ... other teardown ...
 *   };
 */

export { writeToBackendFile, closeFileHandles } from './caption-files.js';
export { createFilesRouter } from './routes/files.js';

import { createStorageAdapter, createStorageResolver } from './storage.js';
import { runFilesDbMigrations } from './db.js';
import logger from 'lcyt/logger';

/**
 * Initialise the files plugin: run DB migrations, create the global storage
 * adapter, and create the per-key storage resolver.
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {Promise<{
 *   storage: import('./adapters/types.js').StorageAdapter,
 *   resolveStorage: (apiKey: string) => Promise<import('./adapters/types.js').StorageAdapter>,
 *   invalidateStorageCache: (apiKey: string) => void,
 * }>}
 */
export async function initFilesControl(db) {
  // Create the key_storage_config table if it doesn't exist
  runFilesDbMigrations(db);

  // Create the global (operator-configured) adapter
  const storage = await createStorageAdapter();
  logger.info(storage.describe?.() ?? '✓ File storage initialised');

  // Create the per-key resolver (falls back to global adapter when no per-key config)
  const { resolveStorage, invalidateCache } = createStorageResolver(db, storage);

  return { storage, resolveStorage, invalidateStorageCache: invalidateCache };
}