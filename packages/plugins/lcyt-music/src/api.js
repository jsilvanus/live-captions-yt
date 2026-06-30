/**
 * lcyt-music plugin entry point.
 *
 * Phase 1: SoundCaptionProcessor + DB init (caption metacode handling, no routes).
 * Phase 2: MusicManager (server-side HLS audio analysis) + /music routes.
 *
 * Usage in lcyt-backend/src/server.js:
 *
 *   import { initMusicControl, createSoundCaptionProcessor, createMusicRouters } from 'lcyt-music';
 *
 *   const { musicManager } = await initMusicControl(db, store);
 *   const soundProcessor = createSoundCaptionProcessor({ store, db });
 *
 *   // Pass soundProcessor to session routers alongside dskCaptionProcessor:
 *   app.use(createSessionRouters(db, store, jwtSecret, auth, {
 *     relayManager,
 *     dskCaptionProcessor: _dskCaptionProcessor,
 *     soundCaptionProcessor: soundProcessor,
 *     resolveStorage,
 *   }));
 *
 *   // Opt-in server-side analysis routes (MUSIC_DETECTION_ACTIVE=1):
 *   if (process.env.MUSIC_DETECTION_ACTIVE === '1') {
 *     app.use('/music', createMusicRouters(db, auth, musicManager));
 *   }
 *
 *   // In graceful shutdown:
 *   await musicManager.stopAll();
 */

import { MusicManager } from './music-manager.js';
import { createSoundCaptionProcessor } from './sound-caption-processor.js';
import { createMusicRouter } from './routes/music.js';
import { createMusicConfigRouter } from './routes/music-config.js';

export { createSoundCaptionProcessor } from './sound-caption-processor.js';
export {
  runMigrations, insertMusicEvent, getRecentMusicEvents, getMusicEventsPage,
  getMusicConfig, setMusicConfig,
} from './db.js';
export { MusicManager } from './music-manager.js';

/**
 * Run DB migrations and construct the MusicManager for server-side
 * (HLS) audio analysis.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {import('../../lcyt-backend/src/store.js').SessionStore} [store]
 *   Only required if server-side analysis routes will be mounted; Phase-1-only
 *   callers (caption metacode processing alone) may omit it.
 * @returns {Promise<{ musicManager: MusicManager|null }>}
 */
export async function initMusicControl(db, store = null) {
  const { runMigrations } = await import('./db.js');
  runMigrations(db);

  if (!store) return { musicManager: null };

  const soundProcessor = createSoundCaptionProcessor({ store, db });
  const musicManager = new MusicManager(db, store, soundProcessor);
  return { musicManager };
}

/**
 * Build the /music routers (analysis control + per-key config).
 *
 * @param {import('better-sqlite3').Database} db
 * @param {import('express').RequestHandler} auth
 * @param {MusicManager} musicManager
 * @returns {import('express').Router[]}
 */
export function createMusicRouters(db, auth, musicManager) {
  return [
    createMusicRouter(db, auth, musicManager),
    createMusicConfigRouter(db, auth),
  ];
}
