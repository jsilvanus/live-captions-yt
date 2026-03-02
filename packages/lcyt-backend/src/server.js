import { randomBytes } from 'node:crypto';
import express from 'express';
import { initDb, writeSessionStat, incrementDomainHourlySessionEnd } from './db.js';
import { SessionStore } from './store.js';
import { createCorsMiddleware } from './middleware/cors.js';
import { createAuthMiddleware } from './middleware/auth.js';
import { createLiveRouter } from './routes/live.js';
import { createCaptionsRouter } from './routes/captions.js';
import { createEventsRouter } from './routes/events.js';
import { createSyncRouter } from './routes/sync.js';
import { createKeysRouter } from './routes/keys.js';
import { createStatsRouter } from './routes/stats.js';
import { createMicRouter } from './routes/mic.js';
import { createUsageRouter } from './routes/usage.js';

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

const DEFAULT_ALLOWED_DOMAINS = 'lcyt.fi,www.lcyt.fi,localhost';
const _allowedDomains = process.env.ALLOWED_DOMAINS ?? DEFAULT_ALLOWED_DOMAINS;
if (_allowedDomains === '*') {
  console.warn('⚠ ALLOWED_DOMAINS=* — sessions allowed from any domain.');
} else {
  if (!process.env.ALLOWED_DOMAINS) {
    console.info(`ℹ ALLOWED_DOMAINS not set — using default domains: ${DEFAULT_ALLOWED_DOMAINS}`);
  }
  console.info(`✓ Allowed session domains: ${_allowedDomains}`);
}

if (process.env.USAGE_PUBLIC) {
  console.info('✓ GET /usage is public (USAGE_PUBLIC is set).');
} else {
  console.info('ℹ GET /usage requires X-Admin-Key (set USAGE_PUBLIC to make it public).');
}

if (process.env.FREE_APIKEY_ACTIVE !== '1') {
  console.info('ℹ FREE_APIKEY_ACTIVE is not set — POST /keys?freetier is disabled.');
} else {
  console.info('✓ Free-tier API key endpoint enabled at POST /keys?freetier');
}

// ---------------------------------------------------------------------------
// Database and session store
// ---------------------------------------------------------------------------

const db = initDb();
const store = new SessionStore();

store.onSessionEnd = (session) => {
  const durationMs = Date.now() - session.startedAt;
  writeSessionStat(db, {
    sessionId: session.sessionId,
    apiKey: session.apiKey,
    domain: session.domain,
    startedAt: new Date(session.startedAt).toISOString(),
    endedAt: new Date().toISOString(),
    durationMs,
    captionsSent: session.captionsSent,
    captionsFailed: session.captionsFailed,
    finalSequence: session.sequence,
    endedBy: 'ttl',
  });
  incrementDomainHourlySessionEnd(db, session.domain, durationMs);
};

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------

const app = express();

// JSON body parser — 64KB limit prevents abuse
app.use(express.json({ limit: '64kb' }));

// Request logging middleware
app.use((req, res, next) => {
  if (req.path === '/health') {
    res.on('finish', () => process.stdout.write('.'));
    return next();
  }
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    console.log(`${req.method} ${req.path} ${res.statusCode} ${ms}ms`);
  });
  next();
});

// Dynamic CORS middleware
app.use(createCorsMiddleware(store));

// Default: never cache any response. Cacheable routes override this explicitly.
app.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

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

// Contact info — no auth required
const _contactInfo = (() => {
  const name = process.env.CONTACT_NAME;
  const email = process.env.CONTACT_EMAIL;
  if (name && email) {
    console.info(`✓ Contact info configured: ${name} <${email}>`);
    return {
      name, email,
      ...(process.env.CONTACT_PHONE ? { phone: process.env.CONTACT_PHONE } : {}),
      ...(process.env.CONTACT_WEBSITE ? { website: process.env.CONTACT_WEBSITE } : {}),
    };
  }
  console.info('ℹ CONTACT_NAME/CONTACT_EMAIL not set — GET /contact will return 404.');
  return null;
})();

app.get('/contact', (req, res) => {
  if (!_contactInfo) return res.status(404).json({ error: 'Contact information not configured' });
  res.set('Cache-Control', 'public, max-age=3600');
  res.status(200).json(_contactInfo);
});

// Auth middleware instance shared by captions and sync routers
const auth = createAuthMiddleware(jwtSecret);

app.use('/live', createLiveRouter(db, store, jwtSecret));
app.use('/captions', createCaptionsRouter(store, auth, db));
app.use('/events', createEventsRouter(store, jwtSecret));
app.use('/sync', createSyncRouter(store, auth));
app.use('/keys', createKeysRouter(db));
app.use('/stats', createStatsRouter(db, auth, store));
app.use('/mic', createMicRouter(store, auth));
app.use('/usage', createUsageRouter(db));

// ---------------------------------------------------------------------------
// Exports (for testing and graceful shutdown wiring in index.js)
// ---------------------------------------------------------------------------

export { app, db, store };
