/**
 * Production control — Express router plugin.
 *
 * Usage in lcyt-backend/src/server.js:
 *   import { createProductionRouter, initProductionControl } from 'production-control';
 *   const { registry } = await initProductionControl(db);
 *   app.use('/production', createProductionRouter(db, registry));
 */

import { Router } from 'express';
import { runMigrations } from './db.js';
import { DeviceRegistry } from './registry.js';
import { createCamerasRouter } from './routes/cameras.js';
import { createMixersRouter } from './routes/mixers.js';

/**
 * Run DB migrations and start the device registry.
 * Call once at server startup before mounting routes.
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {Promise<{ registry: DeviceRegistry }>}
 */
export async function initProductionControl(db) {
  runMigrations(db);
  const registry = new DeviceRegistry(db);
  await registry.start();
  return { registry };
}

/**
 * Create the Express router for production control endpoints.
 * Mount at /production in the main server.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {DeviceRegistry} registry
 * @returns {import('express').Router}
 */
export function createProductionRouter(db, registry) {
  const router = Router();

  router.use('/cameras', createCamerasRouter(db, registry));
  router.use('/mixers', createMixersRouter(db, registry));

  // Phase 4: router.use('/bridge', createBridgeRouter(db));

  return router;
}
