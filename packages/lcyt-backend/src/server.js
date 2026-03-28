import { randomBytes } from 'node:crypto';
import express from 'express';
import { DskBus } from './dsk-bus.js';
import {
  initDb, writeSessionStat, incrementDomainHourlySessionEnd,
} from './db.js';
import { SessionStore } from './store.js';
import { createCorsMiddleware } from './middleware/cors.js';
import { createAuthMiddleware } from './middleware/auth.js';
import { createSessionRouters } from './routes/session.js';
import { createAccountRouters } from './routes/account.js';
import { createContentRouters } from './routes/content.js';
import { createIconRouter } from './routes/icons.js';
import { setHlsSubsManager } from './routes/viewer.js';
import { initProductionControl, createProductionRouter } from 'lcyt-production';
import { initDskControl, createDskRouters } from 'lcyt-dsk';
import { initRtmpControl, createRtmpRouters } from 'lcyt-rtmp';
import { initFilesControl, closeFileHandles } from 'lcyt-files';
import { initMusicControl, createSoundCaptionProcessor } from 'lcyt-music';
import { initCueEngine, createCueProcessor, createCueRouter, createSoundCueListener } from 'lcyt-cues';
import {
  initAgent, createAgentRouter, createAiRouter,
  isServerEmbeddingAvailable, getAiConfigRaw, computeEmbeddings,
} from 'lcyt-agent';

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

// ALLOWED_RTMP_DOMAINS — restricts which domains may use the /stream relay endpoints.
// If unset, falls back to ALLOWED_DOMAINS so operators only need to set one variable.
const _allowedRtmpDomains = process.env.ALLOWED_RTMP_DOMAINS ?? _allowedDomains;
if (process.env.ALLOWED_RTMP_DOMAINS) {
  if (_allowedRtmpDomains === '*') {
    console.warn('⚠ ALLOWED_RTMP_DOMAINS=* — RTMP relay accessible from any domain.');
  } else {
    console.info(`✓ Allowed RTMP relay domains: ${_allowedRtmpDomains}`);
  }
} else {
  console.info('ℹ ALLOWED_RTMP_DOMAINS not set — falling back to ALLOWED_DOMAINS for RTMP relay access.');
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

const loginEnabled = process.env.USE_USER_LOGINS !== '0';
if (loginEnabled) {
  console.info('✓ User logins enabled. Set USE_USER_LOGINS=0 to disable.');
} else {
  console.info('ℹ User logins disabled (USE_USER_LOGINS=0).');
}

if (process.env.GRAPHICS_ENABLED === '1') {
  const graphicsDir = process.env.GRAPHICS_DIR || '/data/images';
  const maxFileMB   = ((Number(process.env.GRAPHICS_MAX_FILE_BYTES)    || 5  * 1024 * 1024) / 1024 / 1024).toFixed(0);
  const maxStoreMB  = ((Number(process.env.GRAPHICS_MAX_STORAGE_BYTES) || 50 * 1024 * 1024) / 1024 / 1024).toFixed(0);
  console.info(`✓ Graphics upload enabled — dir: ${graphicsDir}, max file: ${maxFileMB} MB, max per-key storage: ${maxStoreMB} MB`);
} else {
  console.info('ℹ GRAPHICS_ENABLED is not set — POST /images (upload) is disabled. Set GRAPHICS_ENABLED=1 to enable.');
}

if (process.env.RTMP_APPLICATION) {
  console.info(`✓ RTMP application name: ${process.env.RTMP_APPLICATION} — /rtmp will reject other app names.`);
} else {
  console.info('ℹ RTMP_APPLICATION not set — /rtmp will accept any application name.');
}

// YouTube OAuth configuration check
if (process.env.YOUTUBE_CLIENT_ID) {
  console.info('✓ YouTube OAuth configured (YOUTUBE_CLIENT_ID is set).');
} else {
  console.warn('⚠ YOUTUBE_CLIENT_ID is not set — YouTube OAuth (GET /youtube/config) will return 503.');
  console.warn('  Set YOUTUBE_CLIENT_ID to a Google OAuth 2.0 Web application client ID to enable YouTube integration.');
}

// Nginx configuration reminder
console.info('ℹ nginx: see scripts/nginx-app.conf.sample for an example nginx vhost configuration.');
if (process.env.RTMP_RELAY_ACTIVE === '1') {
  console.info('  RTMP relay is active. Ensure nginx-rtmp is configured with on_publish/on_publish_done pointing to /rtmp.');
} else {
  console.info('  RTMP relay is inactive. Set RTMP_RELAY_ACTIVE=1 and configure nginx-rtmp to enable it.');
}

// ---------------------------------------------------------------------------
// Database and session store
// ---------------------------------------------------------------------------

const db = initDb();
const store = new SessionStore({ db });
const dskBus = new DskBus();

// Production control — run DB migrations, start device registry and bridge manager
const {
  registry: productionRegistry,
  bridgeManager: productionBridgeManager,
  mediamtxClient: productionMediamtxClient,
} = await initProductionControl(db);

// RTMP plugin — run DB migrations, create all manager instances.
// Always initialized so migrations run regardless of RTMP_RELAY_ACTIVE.
// Pass the session store so SttManager can inject transcripts into session._sendQueue.
const rtmp = await initRtmpControl(db, store);
const { relayManager, hlsManager, radioManager, previewManager, hlsSubsManager, sttManager } = rtmp;

// Wire hlsSubsManager into the viewer route for subtitle sidecar delivery.
setHlsSubsManager(hlsSubsManager);
hlsSubsManager.sweepStaleDir().catch(() => {});

// DSK plugin: DB migrations, Playwright renderer, caption processor.
// Only initialised when GRAPHICS_ENABLED=1 (same flag that gates image upload and Chromium install).
let _dskCaptionProcessor = null;
let stopDsk = async () => {};
if (process.env.GRAPHICS_ENABLED === '1') {
  ({ captionProcessor: _dskCaptionProcessor, stop: stopDsk } = await initDskControl(db, dskBus, relayManager));
}

// Files plugin — storage adapter for caption file I/O (local FS or S3).
// Always initialised so FILE_STORAGE configuration is logged at startup.
const { storage, resolveStorage, invalidateStorageCache } = await initFilesControl(db);

// Music detection plugin — run DB migrations and create the SoundCaptionProcessor.
// The processor strips <!-- sound:... --> and <!-- bpm:... --> metacodes from captions
// and fires sound_label / bpm_update SSE events on the existing GET /events stream.
await initMusicControl(db);
const _soundCaptionProcessor = createSoundCaptionProcessor({ store, db });

// Cue Engine plugin — run DB migrations, create the CueEngine and CueProcessor.
// The processor strips <!-- cue:... --> metacodes and evaluates phrase/regex/section
// rules, firing cue_fired SSE events on GET /events and logging to the cue_events table.
const { engine: _cueEngine } = await initCueEngine(db);
const _cueProcessor = createCueProcessor({ store, db, engine: _cueEngine });

// Wire sound_label events (from lcyt-music) to cue engine for
// music_start, music_stop, and silence cue rules.
createSoundCueListener({ store, engine: _cueEngine });

// AI Agent — central AI service. Owns AI configuration, embedding calls,
// context window management, and future vision/LLM features.
// Also runs AI config DB migrations (ai_config table).
const { agent: _agent } = await initAgent(db);

// Wire the agent's embedding capabilities into the CueEngine for
// fuzzy semantic matching via cue[semantic]:phrase metacodes.
_cueEngine.setEmbeddingFn(computeEmbeddings);
_cueEngine.setAiConfigFn((apiKey) => _agent.getAiConfig(apiKey));
// Wire the agent's event cue evaluation for cue[events]:description metacodes.
_cueEngine.setAgentEvaluateFn((apiKey, desc, opts) => _agent.evaluateEventCue(apiKey, desc, opts));
if (_agent.isServerEmbeddingAvailable()) {
  console.info('✓ Server-level embedding API configured (via lcyt-agent)');
}

// Rehydrate persisted sessions so sequence counters and metadata survive restarts.
store.rehydrate();

store.onSessionEnd = async (session) => {
  // Close open caption file handles before cleanup.
  // For local FS this is a graceful flush; for S3 this completes the multipart upload.
  if (session._fileHandles?.size > 0) {
    await closeFileHandles(session._fileHandles).catch(() => {});
  }

  const durationMs = Date.now() - (session.startedAt || Date.now());
  // Some persisted sessions may lack an apiKey (nullable in older DBs);
  // avoid writing a session_stats row when apiKey is missing to prevent NOT NULL errors.
  if (session.apiKey) {
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
  } else {
    console.warn(`[store] session ended without apiKey (sessionId=${session.sessionId}) — skipping session_stats write`);
  }
  incrementDomainHourlySessionEnd(db, session.domain, durationMs);
};

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------

const app = express();

// Configure Express `trust proxy` to match deployment. When behind a reverse
// proxy (nginx, load balancer) the `X-Forwarded-*` headers are set and certain
// middleware (eg. express-rate-limit) requires `trust proxy` to be enabled so
// it can correctly identify client IPs. Control via the `TRUST_PROXY` env var:
//  - unset (default): 1 hop (single reverse proxy in front)
//  - '0' or 'false': disabled
//  - numeric string: number of hops to trust
//  - other string: passed through to Express as-is
{
  const tp = process.env.TRUST_PROXY;
  let val;
  if (tp === undefined) val = 1;
  else if (tp === '0' || tp?.toLowerCase() === 'false') val = false;
  else if (/^\d+$/.test(tp)) val = Number(tp);
  else val = tp;
  app.set('trust proxy', val);
  console.info(`✓ Express trust proxy: ${String(val)}`);
}

// Auth middleware instance — created here so /icons can be mounted before the
// global express.json body parser (the icons upload route uses its own 400kb parser).
const auth = createAuthMiddleware(jwtSecret);

// DSK routers require auth — must be created after auth is initialized.
const { dskRouter, dskTemplatesRouter, dskViewportsRouter, imagesRouter, dskRtmpRouter } = createDskRouters(db, dskBus, auth, relayManager);

// Dynamic CORS middleware — must run before all routers (including /icons) so
// that OPTIONS preflight requests are handled and CORS headers are set.
app.use(createCorsMiddleware(store));

// Mount /icons BEFORE the global JSON body parser so uploads can use the
// router-local 400kb parser without hitting the global 64kb limit first.
app.use('/icons', createIconRouter(db, auth, store));

// JSON body parser — 64KB limit prevents abuse
// NOTE: /icons must be mounted before this to use its own 400kb parser for uploads.
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

// Default: never cache any response. Cacheable routes override this explicitly.
app.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  res.set('Permissions-Policy', 'on-device-speech-recognition=*');
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
  app.use(express.static(staticDir, {
    setHeaders(res) {
      res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
    },
  }));
  console.info(`✓ Serving static client from: ${staticDir}`);
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// Health check — no auth required
app.get('/health', (req, res) => {
  // Build feature list based on enabled capabilities
  const features = ['captions', 'sync'];
  if (loginEnabled) features.push('login');
  if (process.env.RTMP_RELAY_ACTIVE === '1') features.push('rtmp');
  if (process.env.GRAPHICS_ENABLED === '1') features.push('graphics');
  if (sttManager) features.push('stt');
  features.push('files', 'viewer', 'production', 'ai', 'cues', 'agent');

  res.status(200).json({
    ok: true,
    uptime: Math.floor(process.uptime()),
    activeSessions: store.size(),
    loginEnabled,
    features,
    ...(process.env.RTMP_RELAY_ACTIVE === '1' ? {
      rtmpIngest: {
        host: process.env.RTMP_HOST || 'rtmp.lcyt.fi',
        app:  process.env.RTMP_APP  || 'stream',
      },
    } : {}),
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

app.use(createSessionRouters(db, store, jwtSecret, auth, { relayManager, dskCaptionProcessor: _dskCaptionProcessor, soundCaptionProcessor: _soundCaptionProcessor, cueProcessor: _cueProcessor, resolveStorage }));
app.use(createAccountRouters(db, jwtSecret, { loginEnabled }));
app.use('/images',   imagesRouter);
app.use('/dsk',      dskRouter);
app.use('/dsk',      dskTemplatesRouter);
app.use('/dsk',      dskViewportsRouter);
app.use('/dsk-rtmp', dskRtmpRouter);
app.use(createContentRouters(db, auth, store, jwtSecret, { hlsManager, hlsSubsManager, sttManager, resolveStorage, invalidateStorageCache }));
app.use('/cues', createCueRouter(db, auth, _cueEngine));
app.use('/ai', createAiRouter(db, auth));
app.use('/agent', createAgentRouter(db, auth, _agent));
app.use('/production', createProductionRouter(db, productionRegistry, productionBridgeManager, {
  publicUrl: process.env.PUBLIC_URL,
  mediamtxClient: productionMediamtxClient,
}));

// RTMP relay routes — only mounted when RTMP_RELAY_ACTIVE=1
if (process.env.RTMP_RELAY_ACTIVE === '1') {
  const { rtmpRouter, streamRouter, streamHlsRouter, radioRouter, previewRouter } =
    createRtmpRouters(db, auth, rtmp, { allowedRtmpDomains: _allowedRtmpDomains });
  app.use('/rtmp',       rtmpRouter);
  app.use('/stream',     streamRouter);
  app.use('/stream-hls', streamHlsRouter);
  app.use('/radio',      radioRouter);
  app.use('/preview',    previewRouter);
}

// ---------------------------------------------------------------------------
// Exports (for testing and graceful shutdown wiring in index.js)
// ---------------------------------------------------------------------------

export { app, db, store, relayManager, radioManager, hlsManager, hlsSubsManager, previewManager, sttManager, productionRegistry, productionBridgeManager, stopDsk };
