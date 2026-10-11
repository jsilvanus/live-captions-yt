import express from 'express';
import bodyParser from 'body-parser';
import { initDb } from '../src/db/index.js';
import { BridgeManager } from '../../plugins/lcyt-production/src/bridge-manager.js';
import { createBridgeRouter } from '../../plugins/lcyt-production/src/routes/bridge.js';

export async function createTestServer(dbPath) {
  // The production tables (prod_bridge_instances, bridge_security_rules, ...) come from the backend schema.
  const db = await initDb(dbPath || ':memory:');

  const bridgeManager = new BridgeManager(db);

  const app = express();
  app.use(bodyParser.json());

  // Mount bridge router under /production/bridge
  const prodRouter = createBridgeRouter(db, bridgeManager, 'http://localhost');
  app.use('/api/v1/production/bridge', prodRouter);

  return { app, db, bridgeManager };
}
