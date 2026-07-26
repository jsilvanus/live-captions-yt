import express from 'express';
import bodyParser from 'body-parser';
import Database from 'better-sqlite3';
import { runMigrations } from '../../plugins/lcyt-production/src/db.js';
import { BridgeManager } from '../../plugins/lcyt-production/src/bridge-manager.js';
import { createBridgeRouter } from '../../plugins/lcyt-production/src/routes/bridge.js';

export function createTestServer(dbPath) {
  const db = new Database(dbPath || ':memory:');

  // Real migrations, not a hand-rolled subset — routes/bridge.js's security-
  // rules endpoints need bridge_security_rules to exist too, not just
  // prod_bridge_instances.
  runMigrations(db);

  const bridgeManager = new BridgeManager(db);

  const app = express();
  app.use(bodyParser.json());

  // Mount bridge router under /production/bridge
  const prodRouter = createBridgeRouter(db, bridgeManager, 'http://localhost');
  app.use('/production/bridge', prodRouter);

  return { app, db, bridgeManager };
}
