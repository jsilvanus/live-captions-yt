/**
 * Production control — Express router plugin.
 *
 * Usage in lcyt-backend/src/server.js:
 *   import { createProductionRouter, initProductionControl } from 'production-control';
 *   const { registry, bridgeManager } = await initProductionControl(db);
 *   app.use('/production', createProductionRouter(db, registry, bridgeManager));
 */

import { Router } from 'express';
import { runMigrations } from './db.js';
import { DeviceRegistry } from './registry.js';
import { BridgeManager } from './bridge-manager.js';
import { MediaMtxClient } from './mediamtx-client.js';
import { OBSClient } from './obs-client.js';
import { createCamerasRouter } from './routes/cameras.js';
import { createMixersRouter } from './routes/mixers.js';
import { createBridgeRouter } from './routes/bridge.js';
import { createEncodersRouter } from './routes/encoders.js';

/**
 * Run DB migrations and start the device registry and bridge manager.
 * Call once at server startup before mounting routes.
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {Promise<{ registry: DeviceRegistry, bridgeManager: BridgeManager, mediamtxClient: MediaMtxClient|null }>}
 */
export async function initProductionControl(db) {
  runMigrations(db);
  const bridgeManager = new BridgeManager(db);
  const registry = new DeviceRegistry(db);
  await registry.start();

  // Instantiate MediaMTX client only when the API URL is configured
  const mediamtxClient = process.env.MEDIAMTX_API_URL
    ? new MediaMtxClient()
    : null;

  if (mediamtxClient) {
    console.info('[production-control] MediaMTX client initialised — WebRTC WHIP proxy enabled');
  }

  return { registry, bridgeManager, mediamtxClient };
}

/**
 * Create the Express router for all production control endpoints.
 * Mount at /production in the main server.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {DeviceRegistry} registry
 * @param {BridgeManager} bridgeManager
 * @param {object} [opts]
 * @param {string} [opts.publicUrl]      Server's public URL for .env generation
 * @param {MediaMtxClient} [opts.mediamtxClient]  MediaMTX REST client (optional)
 * @param {object} [opts.cameraThumbnail]  Overrides for camera-thumbnail.js's defaults (thumbnailsDir/previewBaseUrl) — tests only, env vars suffice in production
 * @param {object} [opts.metrics]  Optional backend metrics handle (plan_metering_audit §3.2: production.commands)
 * @param {import('express').RequestHandler} [opts.auth]  Session/user/device auth middleware (createProjectAccessMiddleware) applied to the camera CRUD routes (plan_ingest_feeds.md's cross-tenant review finding) and the mixer routes (plan_vertical_crop.md §4 — a mixer switch needs the acting session's apiKey to report to registry.onProgramChanged()); WHIP/thumbnail/sources kiosk routes stay unauthenticated in both routers. Omit to keep this router's historical fully-open behavior (e.g. existing route-level tests).
 * @returns {import('express').Router}
 */
export function createProductionRouter(db, registry, bridgeManager, opts = {}) {
  const router = Router();
  const mediamtxClient = opts.mediamtxClient ?? null;
  const metrics = opts.metrics ?? null;

  // Single choke point for the production.commands counter: every mutating
  // command endpoint (camera preset, mixer switch, encoder start/stop/test)
  // passes through here. CRUD (create/update/delete device) is excluded —
  // that's configuration, covered by the write-audit middleware instead.
  router.use((req, res, next) => {
    if (req.method === 'POST' && /\/(preset|switch|start|stop|test|command)(\/|$)/.test(req.path)) {
      res.on('finish', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          metrics?.count('production.commands', 1, { project: req.auth?.projectId || req.session?.apiKey || '' });
        }
      });
    }
    next();
  });

  router.use('/cameras',  createCamerasRouter(db, registry, bridgeManager, { mediamtxClient, cameraThumbnail: opts.cameraThumbnail, auth: opts.auth }));
  router.use('/mixers',   createMixersRouter(db, registry, bridgeManager, { mediamtxClient, auth: opts.auth }));
  router.use('/bridge',   createBridgeRouter(db, bridgeManager, opts.publicUrl));
  router.use('/encoders', createEncodersRouter(db, bridgeManager));

  return router;
}

// Re-export OBSClient for use by bridge and adapters
export { OBSClient };

// Plain, directly-callable camera/mixer CRUD (for packages/lcyt-tools — plan/mcp)
export {
  listCameras, getCameraById, createCamera, updateCamera, deleteCamera,
  listMixers, getMixerById, createMixer, updateMixer, deleteMixer,
  buildSwitchCommand,
} from './crud.js';
