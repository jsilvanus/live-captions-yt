/**
 * lcyt-cues plugin entry point — Cue Engine.
 *
 * The Cue Engine watches for specific phrases, patterns, or section changes in the
 * caption stream and fires cue events. These events are logged to the cue_events table
 * (rundown log) and emitted as SSE events on the session GET /events stream.
 *
 * Cue rules can be managed via HTTP (CRUD on /cues/rules) or triggered explicitly
 * using the <!-- cue:label --> metacode in caption text.
 *
 * Usage in lcyt-backend/src/server.js:
 *
 *   import { initCueEngine, createCueProcessor, createCueRouter } from 'lcyt-cues';
 *
 *   const { engine } = await initCueEngine(db);
 *   const cueProcessor = createCueProcessor({ store, db, engine });
 *   app.use('/cues', createCueRouter(db, auth, engine));
 *
 *   // Pass cueProcessor to session routers alongside dsk/sound processors:
 *   app.use(createSessionRouters(db, store, jwtSecret, auth, {
 *     ...,
 *     cueProcessor,
 *   }));
 */

export { createCueProcessor, createSoundCueListener, createTrackerCueListener, createCueEmitter } from './cue-processor.js';
export { CueEngine, jaroWinkler, fuzzyWordMatch } from './cue-engine.js';
export { createCueRouter } from './routes/cues.js';
export {
  runMigrations, insertCueEvent, getRecentCueEvents,
  listCueRules, getCueRule, insertCueRule, updateCueRule, deleteCueRule,
  listNamedConditions, getNamedCondition, getNamedConditionByName,
  insertNamedCondition, updateNamedCondition, deleteNamedCondition,
} from './db.js';

/**
 * Create the CueEngine instance (the cue tables come from lcyt-backend's schema, no migrations).
 * Call once at backend startup before mounting any routes.
 *
 * @param {import('lcyt-backend/db').Db} db Prisma client
 * @returns {Promise<{ engine: import('./cue-engine.js').CueEngine }>}
 */
export async function initCueEngine(db) {
  const { CueEngine } = await import('./cue-engine.js');
  const engine = new CueEngine(db);

  return { engine };
}
