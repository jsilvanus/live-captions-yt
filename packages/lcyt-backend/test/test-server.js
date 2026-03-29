import express from 'express';
import bodyParser from 'body-parser';
import Database from 'better-sqlite3';
import { BridgeManager } from '../../plugins/lcyt-production/src/bridge-manager.js';
import { createBridgeRouter } from '../../plugins/lcyt-production/src/routes/bridge.js';

export function createTestServer(dbPath) {
  const db = new Database(dbPath || ':memory:');

  // Ensure minimal table for prod_bridge_instances used by the router
  db.exec(`
    CREATE TABLE IF NOT EXISTS prod_bridge_instances (
      id TEXT PRIMARY KEY,
      name TEXT,
      token TEXT,
      status TEXT,
      last_seen TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  const bridgeManager = new BridgeManager(db);

  const app = express();
  app.use(bodyParser.json());

  // Mount bridge router under /production/bridge
  const prodRouter = createBridgeRouter(db, bridgeManager, 'http://localhost');
  app.use('/production/bridge', prodRouter);

  return { app, db, bridgeManager };
}
