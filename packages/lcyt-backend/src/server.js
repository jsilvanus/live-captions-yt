import { randomBytes } from 'node:crypto';
import express from 'express';
import {
  initDb, writeSessionStat, incrementDomainHourlySessionEnd,
  writeRtmpStreamStart, writeRtmpStreamEnd, incrementRtmpAnonDailyStat,
} from './db.js';
import { SessionStore } from './store.js';
import { RtmpRelayManager, probeFfmpeg } from './rtmp-manager.js';
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
import { createFileRouter } from './routes/files.js';
import { createRtmpRouter } from './routes/rtmp.js';
import { createStreamRouter } from './routes/stream.js';
import { createViewerRouter, setHlsSubsManager } from './routes/viewer.js';
import { createVideoRouter } from './routes/video.js';
import { HlsSubsManager } from './hls-subs-manager.js';
import { createIconRouter } from './routes/icons.js';
import { createYouTubeRouter } from './routes/youtube.js';
import { createRadioRouter } from './routes/radio.js';
import { RadioManager } from './radio-manager.js';
import { createStreamHlsRouter } from './routes/stream-hls.js';
import { HlsManager } from './hls-manager.js';
import { createPreviewRouter } from './routes/preview.js';
import { PreviewManager } from './preview-manager.js';
import { initProductionControl, createProductionRouter } from 'lcyt-production';
import { initDskControl, createDskRouters } from 'lcyt-dsk';

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

// Production control — run DB migrations, start device registry and bridge manager
const {
  registry: productionRegistry,
  bridgeManager: productionBridgeManager,
} = await initProductionControl(db);

// Stat tracking: map from `${apiKey}:${slot}` → rtmp_stream_stats row id
const _rtmpStatIds = new Map();

const _rtmpRelayActive = process.env.RTMP_RELAY_ACTIVE === '1';
if (!_rtmpRelayActive) {
  console.info('ℹ RTMP_RELAY_ACTIVE is not set — RTMP relay disabled. Set RTMP_RELAY_ACTIVE=1 to enable.');
}
const _ffprobe = _rtmpRelayActive
  ? probeFfmpeg()
  : { available: false, hasLibx264: false, hasEia608: false, hasSubrip: false };

const relayManager = new RtmpRelayManager({
  ffmpegCaps: _ffprobe,
  onStreamStarted(apiKey, slot, { targetUrl, targetName, captionMode, startedAt }) {
    try {
      const id = writeRtmpStreamStart(db, {
        apiKey,
        slot,
        targetUrl,
        targetName,
        captionMode,
        startedAt: startedAt.toISOString(),
      });
      _rtmpStatIds.set(`${apiKey}:${slot}`, id);
    } catch (err) {
      console.error(`[rtmp] Failed to write stream start stat: ${err.message}`);
    }
  },
  onStreamEnded(apiKey, slot, { targetUrl, captionMode, startedAt, endedAt, durationMs, captionsSent = 0 }) {
    try {
      const statKey = `${apiKey}:${slot}`;
      const statId  = _rtmpStatIds.get(statKey);
      _rtmpStatIds.delete(statKey);
      if (statId) {
        writeRtmpStreamEnd(db, {
          streamStatId: statId,
          endedAt: endedAt.toISOString(),
          durationMs,
          captionsSent: captionsSent || 0,
        });
      }
      incrementRtmpAnonDailyStat(db, { targetUrl, captionMode, durationMs });
    } catch (err) {
      console.error(`[rtmp] Failed to write stream end stat: ${err.message}`);
    }
  },
});

// Radio manager: RTMP → audio-only HLS.
// Always instantiated (no capability flag), but ffmpeg must be installed.
const radioManager = new RadioManager();

// HLS manager: RTMP → video+audio HLS embed.
// Always instantiated; ffmpeg must be installed.
const hlsManager = new HlsManager();

// HLS subtitle sidecar: caption cues → rolling WebVTT segments per language.
const hlsSubsManager = new HlsSubsManager();
setHlsSubsManager(hlsSubsManager);
// Remove any stale subs directories left by a previous run.
hlsSubsManager.sweepStaleDir().catch(() => {});

// Preview manager: RTMP → JPEG thumbnail (incoming stream preview).
// Always instantiated; ffmpeg must be installed.
const previewManager = new PreviewManager();

// DSK plugin: DB migrations, Playwright renderer, caption processor.
const { captionProcessor: _dskCaptionProcessor, stop: stopDsk } = await initDskControl(db, store, relayManager);
const { dskRouter, dskTemplatesRouter, imagesRouter, dskRtmpRouter } = createDskRouters(db, store, auth, relayManager);

// Rehydrate persisted sessions so sequence counters and metadata survive restarts.
store.rehydrate();

store.onSessionEnd = (session) => {
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
//  - unset (default): enabled
//  - '0' or 'false': disabled
//  - numeric string: number of hops to trust
//  - other string: passed through to Express as-is
{
  const tp = process.env.TRUST_PROXY;
  let val;
  if (tp === undefined) val = true;
  else if (tp === '0' || tp?.toLowerCase() === 'false') val = false;
  else if (/^\d+$/.test(tp)) val = Number(tp);
  else val = tp;
  app.set('trust proxy', val);
  console.info(`✓ Express trust proxy: ${String(val)}`);
}

// Auth middleware instance — created here so /icons can be mounted before the
// global express.json body parser (the icons upload route uses its own 400kb parser).
const auth = createAuthMiddleware(jwtSecret);

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
    activeSessions: store.size(),
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

app.use('/live', createLiveRouter(db, store, jwtSecret));
app.use('/captions', createCaptionsRouter(store, auth, db, relayManager, _dskCaptionProcessor));
app.use('/events', createEventsRouter(store, jwtSecret));
app.use('/sync', createSyncRouter(store, auth));
app.use('/keys', createKeysRouter(db));
app.use('/stats', createStatsRouter(db, auth, store));
app.use('/mic', createMicRouter(store, auth));
app.use('/usage', createUsageRouter(db));
app.use('/file', createFileRouter(db, auth, store, jwtSecret));
app.use('/images',   imagesRouter);
app.use('/dsk',      dskRouter);
app.use('/dsk',      dskTemplatesRouter);
app.use('/dsk-rtmp', dskRtmpRouter);
app.use('/rtmp', createRtmpRouter(db, relayManager));
app.use('/stream', createStreamRouter(db, auth, relayManager, _allowedRtmpDomains));
app.use('/viewer', createViewerRouter(db));
app.use('/video',  createVideoRouter(db, hlsManager, hlsSubsManager));
app.use('/radio', createRadioRouter(db, radioManager));
app.use('/stream-hls', createStreamHlsRouter(db, hlsManager));
app.use('/preview', createPreviewRouter(previewManager));
app.use('/youtube', createYouTubeRouter(auth));
app.use('/production', createProductionRouter(db, productionRegistry, productionBridgeManager, {
  publicUrl: process.env.PUBLIC_URL,
}));

// ---------------------------------------------------------------------------
// Exports (for testing and graceful shutdown wiring in index.js)
// ---------------------------------------------------------------------------

export { app, db, store, relayManager, radioManager, hlsManager, hlsSubsManager, previewManager, productionRegistry, productionBridgeManager, stopDsk };
