/**
 * lcyt-music plugin entry point — Phase 1.
 *
 * Phase 1 exports only the SoundCaptionProcessor and DB init.
 * No HTTP routes or MusicManager in Phase 1 (server-side HLS analysis is Phase 2).
 *
 * Usage in lcyt-backend/src/server.js:
 *
 *   import { initMusicControl, createSoundCaptionProcessor } from 'lcyt-music';
 *
 *   await initMusicControl(db);
 *   const soundProcessor = createSoundCaptionProcessor({ store, db });
 *
 *   // Pass to session routers alongside dskCaptionProcessor:
 *   app.use(createSessionRouters(db, store, jwtSecret, auth, {
 *     relayManager,
 *     dskCaptionProcessor: _dskCaptionProcessor,
 *     soundCaptionProcessor: soundProcessor,
 *     resolveStorage,
 *   }));
 */

export { createSoundCaptionProcessor } from './sound-caption-processor.js';
export { runMigrations, insertMusicEvent, getRecentMusicEvents } from './db.js';

/**
 * Run DB migrations for the music plugin.
 * Call once at backend startup before mounting any routes.
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {Promise<void>}
 */
export async function initMusicControl(db) {
  const { runMigrations } = await import('./db.js');
  runMigrations(db);
}
