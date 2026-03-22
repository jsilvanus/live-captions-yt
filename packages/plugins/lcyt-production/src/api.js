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
 * @returns {import('express').Router}
 */
export function createProductionRouter(db, registry, bridgeManager, opts = {}) {
  const router = Router();
  const mediamtxClient = opts.mediamtxClient ?? null;

  router.use('/cameras',  createCamerasRouter(db, registry, bridgeManager, { mediamtxClient }));
  router.use('/mixers',   createMixersRouter(db, registry, bridgeManager, { mediamtxClient }));
  router.use('/bridge',   createBridgeRouter(db, bridgeManager, opts.publicUrl));
  router.use('/encoders', createEncodersRouter(db, bridgeManager));

  return router;
}
