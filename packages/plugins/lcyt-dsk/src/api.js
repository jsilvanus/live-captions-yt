/**
 * lcyt-dsk plugin — main entry point.
 *
 * Mirrors the production-control (lcyt-production) plugin pattern:
 *
 *   import { initDskControl, createDskRouters } from 'lcyt-dsk';
 *
 *   // At startup (after db + store + relayManager are ready):
 *   const { captionProcessor, stop: stopDsk } = await initDskControl(db, store, relayManager);
 *
 *   // Route mounting:
 *   const { dskRouter, dskTemplatesRouter, imagesRouter, dskRtmpRouter } =
 *     createDskRouters(db, store, auth, relayManager);
 *   app.use('/dsk',      dskRouter);
 *   app.use('/dsk',      dskTemplatesRouter);
 *   app.use('/images',   imagesRouter);
 *   app.use('/dsk-rtmp', dskRtmpRouter);
 *
 *   // Pass captionProcessor to createCaptionsRouter so it handles <!-- graphics:... -->:
 *   app.use('/captions', createCaptionsRouter(store, auth, db, relayManager, captionProcessor));
 *
 *   // In graceful shutdown:
 *   await stopDsk();
 */

import { runMigrations } from './db.js';
import { startRenderer, stopRenderer } from './renderer.js';
import { createDskCaptionProcessor } from './caption-processor.js';
import { createDskRouter } from './routes/dsk.js';
import { createDskTemplatesRouter } from './routes/dsk-templates.js';
import { createImagesRouter } from './routes/images.js';
import { createDskRtmpRouter } from './routes/dsk-rtmp.js';
import { createEditorAuth } from './middleware/editor-auth.js';
export { deleteAllImages } from './db/images.js';

/**
 * Initialise the DSK plugin.
 *
 * - Runs DB migrations (dsk_templates table + caption_files image columns)
 * - Starts the Playwright headless Chromium renderer
 * - Returns a captionProcessor function for injection into createCaptionsRouter()
 * - Returns a stop() function for graceful shutdown
 *
 * @param {import('better-sqlite3').Database} db
 * @param {object} store  — SessionStore instance (needs addDskSubscriber / emitDskEvent)
 * @param {object|null} relayManager  — RtmpRelayManager instance (or null if relay inactive)
 * @returns {Promise<{ captionProcessor: Function, stop: Function }>}
 */
export async function initDskControl(db, store, relayManager) {
  runMigrations(db);
  await startRenderer();
  const captionProcessor = createDskCaptionProcessor({ db, store, relayManager });
  return { captionProcessor, stop: stopRenderer };
}

/**
 * Create all DSK Express routers.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {object} store
 * @param {import('express').RequestHandler} auth  — JWT Bearer auth middleware
 * @param {object|null} relayManager
 * @returns {{ dskRouter, dskTemplatesRouter, imagesRouter, dskRtmpRouter }}
 */
export function createDskRouters(db, store, auth, relayManager) {
  const editorAuth = createEditorAuth(db);
  return {
    /** Mount at /dsk  — public SSE + image list */
    dskRouter: createDskRouter(db, store),
    /** Mount at /dsk  — authenticated template CRUD + renderer control */
    dskTemplatesRouter: createDskTemplatesRouter(db, auth, editorAuth, relayManager),
    /** Mount at /images — authenticated upload; public serve */
    imagesRouter: createImagesRouter(db, auth),
    /** Mount at /dsk-rtmp — nginx-rtmp on_publish callbacks */
    dskRtmpRouter: createDskRtmpRouter(relayManager),
  };
}
