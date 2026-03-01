import { randomBytes } from 'node:crypto';
import express from 'express';
import { initDb } from './db.js';
import { SessionStore } from './store.js';
import { createCorsMiddleware } from './middleware/cors.js';
import { createAuthMiddleware } from './middleware/auth.js';
import { createLiveRouter } from './routes/live.js';
import { createCaptionsRouter } from './routes/captions.js';
import { createEventsRouter } from './routes/events.js';
import { createSyncRouter } from './routes/sync.js';
import { createKeysRouter } from './routes/keys.js';
import { createMicRouter } from './routes/mic.js';

// ---------------------------------------------------------------------------
// JWT secret
// ---------------------------------------------------------------------------

let jwtSecret = process.env.JWT_SECRET;

if (!jwtSecret) {
  jwtSecret = randomBytes(32).toString('hex');
  console.warn('⚠ JWT_SECRET is not set — using a random secret. Tokens will not survive restarts.');
  console.warn('  Set JWT_SECRET in your environment for production use.');
}

// ---------------------------------------------------------------------------
// Admin key notice
// ---------------------------------------------------------------------------

if (!process.env.ADMIN_KEY) {
  console.info('ℹ ADMIN_KEY is not set — /keys admin endpoints are disabled.');
  console.info('  Set ADMIN_KEY in your environment to enable API key management via HTTP.');
}

// ---------------------------------------------------------------------------
// Database and session store
// ---------------------------------------------------------------------------

const db = initDb();
const store = new SessionStore();

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------

const app = express();

// JSON body parser — 64KB limit prevents abuse
app.use(express.json({ limit: '64kb' }));

// Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    console.log(`${req.method} ${req.path} ${res.statusCode} ${ms}ms`);
  });
  next();
});

// Dynamic CORS middleware
app.use(createCorsMiddleware(store));

// ---------------------------------------------------------------------------
// Static file serving (optional)
// ---------------------------------------------------------------------------

// If STATIC_DIR is set, serve a built lcyt-web bundle from that directory.
// Example: STATIC_DIR=../lcyt-web/dist node src/index.js
if (process.env.STATIC_DIR) {
  const { resolve } = await import('node:path');
  const staticDir = resolve(process.env.STATIC_DIR);
  app.use(express.static(staticDir));
  console.info(`✓ Serving static client from: ${staticDir}`);
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// Health check — no auth required
app.get('/health', (req, res) => {
  res.status(200).json({
    ok: true,
    uptime: Math.floor(process.uptime()),
    activeSessions: store.size()
  });
});

// Auth middleware instance shared by captions and sync routers
const auth = createAuthMiddleware(jwtSecret);

app.use('/live', createLiveRouter(db, store, jwtSecret));
app.use('/captions', createCaptionsRouter(store, auth));
app.use('/events', createEventsRouter(store, jwtSecret));
app.use('/sync', createSyncRouter(store, auth));
app.use('/keys', createKeysRouter(db));
app.use('/mic', createMicRouter(store, auth));

// ---------------------------------------------------------------------------
// Exports (for testing and graceful shutdown wiring in index.js)
// ---------------------------------------------------------------------------

export { app, db, store };
