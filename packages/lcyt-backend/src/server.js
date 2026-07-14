import { randomBytes } from 'node:crypto';
import express from 'express';
import { EventBus } from 'lcyt/event-bus';
import { DskBus } from './dsk-bus.js';
import {
  initDb, writeSessionStat, incrementDomainHourlySessionEnd,
  getCaptionTargets, createCaptionTarget, updateCaptionTarget, deleteCaptionTarget,
  completeBroadcast,
} from './db.js';
import { SessionStore } from './store.js';
import { createCorsMiddleware } from './middleware/cors.js';
import { createAuthMiddleware } from './middleware/auth.js';
import { createSessionRouters } from './routes/session.js';
import { createAccountRouters } from './routes/account.js';
import { createOrganizationsRouter } from './routes/orgs.js';
import { createContentRouters } from './routes/content.js';
import { createIconRouter } from './routes/icons.js';
import { createAdminRouter } from './routes/admin.js';
import { createMcpTokensRouter } from './routes/mcp-tokens.js';
import { createEventsStreamRouter } from './routes/events-stream.js';
import { createEventsCatalogRouter } from './routes/events-catalog.js';
import { createMcpEndpointRouter } from './routes/mcp-endpoint.js';
import { createEventsPublishRouter } from './routes/events-publish.js';
import { createOperatorRouter } from './routes/operator.js';
import { OperatorManager } from './operator-manager.js';
import { attachBusAuditLog } from './db/bus-events.js';
import { setHlsSubsManager } from './routes/viewer.js';
import { getTranslationVendorConfig, getTranslationTargets } from './db/translation-config.js';
import {
  initProductionControl, createProductionRouter,
  listCameras, getCameraById, createCamera, updateCamera, deleteCamera,
  listMixers, getMixerById, createMixer, updateMixer, deleteMixer, buildSwitchCommand,
} from 'lcyt-production';
import {
  initDskControl, createDskRouters,
  listImages, getImageByKey, updateImageSettings, deleteImage,
} from 'lcyt-dsk';
import { initRtmpControl, createRtmpRouters } from 'lcyt-rtmp';
import { initFilesControl, closeFileHandles } from 'lcyt-files';
// Optional music detection plugin (lcyt-music) — load dynamically so the
// server can run when the optional package is not installed in minimal
// container/CI images.
let initMusicControl;
let createSoundCaptionProcessor;
let createMusicRouters;
try {
  const _music = await import('lcyt-music');
  initMusicControl = _music.initMusicControl ?? _music.default?.initMusicControl ?? _music.initMusicControl;
  createSoundCaptionProcessor = _music.createSoundCaptionProcessor ?? _music.default?.createSoundCaptionProcessor ?? _music.createSoundCaptionProcessor;
  createMusicRouters = _music.createMusicRouters ?? _music.default?.createMusicRouters ?? _music.createMusicRouters;
  console.info('✓ Optional plugin lcyt-music loaded');
} catch (err) {
  // If lcyt-music isn't available, try the renamed package lcyt-sound.
  const notFound = err && (err.code === 'ERR_MODULE_NOT_FOUND' || /Cannot find module|Cannot find package/i.test(String(err.message)));
  if (notFound) {
    try {
      const _sound = await import('lcyt-sound');
      initMusicControl = _sound.initMusicControl ?? _sound.default?.initMusicControl ?? _sound.initMusicControl;
      createSoundCaptionProcessor = _sound.createSoundCaptionProcessor ?? _sound.default?.createSoundCaptionProcessor ?? _sound.createSoundCaptionProcessor;
      createMusicRouters = _sound.createMusicRouters ?? _sound.default?.createMusicRouters ?? _sound.createMusicRouters;
      console.info('✓ Optional plugin lcyt-sound loaded');
    } catch (err2) {
      console.info('ℹ Optional plugins lcyt-music and lcyt-sound not available — continuing without music detection.');
      initMusicControl = async () => ({ });
      createSoundCaptionProcessor = (_opts) => () => undefined;
      createMusicRouters = () => [];
    }
  } else {
    // Unexpected error importing — surface info but fall back to no-op to keep server running.
    console.error('! Error while loading optional music plugin:', err);
    initMusicControl = async () => ({ });
    createSoundCaptionProcessor = (_opts) => () => undefined;
    createMusicRouters = () => [];
  }
}
import { initCueEngine, createCueProcessor, createCueRouter, createSoundCueListener } from 'lcyt-cues';
import {
  initAgent, createAgentRouter, createAiRouter,
  createAdminAiProvidersRouter, createProjectAiProvidersRouter, createRolesRouter,
  createRolesChatRouter, createProductionAssistantRouter, createVisionRolesRouter,
  createAiModelsRouter, createPlannerRouter,
  isServerEmbeddingAvailable, getAiConfigRaw, computeEmbeddings,
} from 'lcyt-agent';
import { createToolRegistry, createInProcessMcpBridge } from 'lcyt-tools';
import {
  initConnectors, createConnectorsRouter, createVariablesRouter,
  createGlobalNetworkRulesRouter, createOrgNetworkRulesRouter,
} from 'lcyt-connectors';
import { initActions, createActionsRouter } from 'lcyt-actions';
import { createAdminMiddleware } from './middleware/admin.js';
import { createProjectAccessMiddleware } from './middleware/project-access.js';
import { createSessionCaptionFileWriter } from './caption-file-writer.js';
import { createCaptionFanout } from './caption-fanout.js';
import { composeCaptionText } from './caption-files.js';
import { createUserAuthMiddleware } from './middleware/user-auth.js';

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
// One shared pub/sub bus for the whole backend. Every per-project SSE registry
// (DskBus, VariablesBus, RolesBus) and the per-session event stream publish
// through it, so events also reach the unified /events/stream endpoint and any
// in-process listeners. See src/event-bus.js (lcyt/event-bus).
const eventBus = new EventBus();
// Persist curated topics to the bus_events audit log (insert-only; not a replay
// buffer). High-frequency topics are excluded by the allowlist in db/bus-events.js.
attachBusAuditLog(eventBus, db, { log: (m) => console.warn(m) });
const store = new SessionStore({ db, eventBus });
const dskBus = new DskBus(eventBus);

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

// Inject translation-config + fan-out + caption-file helpers into SttManager
// for transcript delivery (Phase 5: server-side translation, per-target
// routed fan-out via the shared createCaptionFanout, backend caption-file
// archiving) — sttManager must not import lcyt-backend's own src/ directly,
// see setDeliveryHelpers()'s doc comment in lcyt-rtmp. Runs after
// initFilesControl so the writer can close over resolveStorage.
sttManager?.setDeliveryHelpers({
  getTranslationVendorConfig,
  getTranslationTargets,
  writeBackendCaptionFiles: createSessionCaptionFileWriter({ db, resolveStorage }),
  composeCaptionText,
  fanOutToTargets: createCaptionFanout({ db }),
});

// Music detection plugin — run DB migrations, create the SoundCaptionProcessor, and
// (when a session store is supplied) the MusicManager for server-side HLS audio analysis.
// The processor strips <!-- sound:... --> and <!-- bpm:... --> metacodes from captions
// and fires sound_label / bpm_update SSE events on the existing GET /events stream.
const { musicManager } = await initMusicControl(db, store);
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
// Also runs AI config DB migrations (ai_config table) and the AI model
// registry migrations (ai_providers / ai_provider_models / ai_provider_grants).
const {
  agent: _agent, providerRegistry: _providerRegistry,
  rolesBus: _rolesBus, assistantManager: _assistantManager, visionRoleManager: _visionRoleManager,
} = await initAgent(db, { eventBus });

// Bridge-relayed providers (plan/ai_model_registry): discovery/inference for a
// provider with bridge_instance_id set dispatches through the production
// bridge manager's SSE command channel. Setter injection — server.js is the
// only place that holds both plugin instances.
_providerRegistry.setBridgeManager(productionBridgeManager);

// Shared tool-schema/handler registry (plan/mcp) — every tool an
// agentic_chat role needs, defined once. server.js is the only place that
// holds lcyt-backend's caption-target DB helpers, lcyt-production's device
// registry, lcyt-dsk's image helpers, and the agent instance all together.
const _toolRegistry = createToolRegistry({
  db,
  captionTargets: { getCaptionTargets, createCaptionTarget, updateCaptionTarget, deleteCaptionTarget },
  production: {
    registry: productionRegistry, bridgeManager: productionBridgeManager,
    listCameras, getCameraById, createCamera, updateCamera, deleteCamera,
    listMixers, getMixerById, createMixer, updateMixer, deleteMixer, buildSwitchCommand,
  },
  agent: _agent,
  assets: { listImages, getImageByKey, updateImageSettings, deleteImage },
});
// Real MCP Server + in-process Client wiring (InMemoryTransport) — the
// agentic_chat turn loop consumes tools through this bridge, exactly the
// schema an external MCP client would see (see packages/lcyt-tools).
const _toolBridge = createInProcessMcpBridge(_toolRegistry);
const _toolsContext = {
  tools: _toolRegistry.tools,
  callTool: (name, args, ctx) => _toolBridge.callToolAs(ctx.apiKey, name, args),
};

// Hosted Operator (Phase 2 — plan_unified_external_control.md).
// Persistent event-fed agent session that subscribes to the EventBus and reacts
// autonomously, staging destructive actions for human confirmation.
const _operatorManager = new OperatorManager({
  eventBus, db, toolsContext: _toolsContext, assistantManager: _assistantManager,
});

// API Connectors & Variables plugin — {{ }} variable bindings backed by
// user-defined outbound API connectors. Runs its own DB migrations
// (api_connectors, api_requests, api_response_mappings, variables tables).
const { bus: _connectorsBus, engine: _connectorsEngine, scheduler: _connectorsScheduler } = initConnectors(db, {
  filesControl: { resolveStorage },
  eventBus,
});
// Named Actions plugin — runs its own migration (action_defs table).
initActions(db);

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
    const endedAt = new Date().toISOString();
    writeSessionStat(db, {
      sessionId: session.sessionId,
      apiKey: session.apiKey,
      domain: session.domain,
      startedAt: new Date(session.startedAt).toISOString(),
      endedAt,
      durationMs,
      captionsSent: session.captionsSent,
      captionsFailed: session.captionsFailed,
      finalSequence: session.sequence,
      endedBy: 'ttl',
      broadcastId: session.broadcastId ?? null,
    });
    // Transition the bound broadcast to completed (plan/broadcasts).
    if (session.broadcastId) {
      try {
        completeBroadcast(db, session.broadcastId, {
          youtubeVideoIds: session.youtubeVideoIds,
          endedAt,
        });
      } catch (err) {
        console.warn(`[broadcasts] completeBroadcast failed (broadcastId=${session.broadcastId})`, err);
      }
    }
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
const userAuth = createUserAuthMiddleware(jwtSecret);
// Project-scoped routers are gated by `scopedAuth('<resource>')`. Access = the
// token's scopes: session/user/project/device JWTs and full-access (NULL-scope)
// external tokens have full delegation; a scoped external token needs
// `<resource>:read` to GET and `<resource>:write` to mutate (see
// createProjectAccessMiddleware). The legacy per-plugin SSE endpoints stay
// JWT-only — `/variables/events` and `/stt/events` via their own `jwt.verify`,
// `/roles/:roleCode/events` via an in-handler external-token block — so external
// subscribers use the unified `/events/stream` instead.
const scopedAuth = (resource) => createProjectAccessMiddleware(db, jwtSecret, { requiredScope: resource });
// DSK routers require auth — must be created after auth is initialized.
const { dskRouter, dskTemplatesRouter, dskViewportsRouter, imagesRouter, dskRtmpRouter } = createDskRouters(db, dskBus, scopedAuth('dsk'), relayManager);
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
  // Admin panel is available if: user-based logins are enabled (any admin user can use it)
  // or the legacy ADMIN_KEY env var is set.
  if (loginEnabled || process.env.ADMIN_KEY) features.push('admin');
  if (process.env.RTMP_RELAY_ACTIVE === '1') features.push('rtmp');
  if (process.env.GRAPHICS_ENABLED === '1') features.push('graphics');
  if (sttManager) features.push('stt');
  if (process.env.MUSIC_DETECTION_ACTIVE === '1' && musicManager) features.push('music');
  features.push('files', 'viewer', 'production', 'ai', 'cues', 'agent');

  res.set('Cache-Control', 'public, max-age=30, stale-while-revalidate=60');
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
app.use('/orgs', createOrganizationsRouter(db, userAuth, { loginEnabled }));
app.use('/ai/models', createAiModelsRouter(db, userAuth));
app.use('/admin', createAdminRouter(db, jwtSecret));
app.use('/images',   imagesRouter);
app.use('/dsk',      dskRouter);
app.use('/dsk',      dskTemplatesRouter);
app.use('/dsk',      dskViewportsRouter);
app.use('/dsk-rtmp', dskRtmpRouter);
app.use(createContentRouters(db, auth, store, jwtSecret, { hlsManager, hlsSubsManager, sttManager, resolveStorage, invalidateStorageCache }, scopedAuth));
app.use('/cues', createCueRouter(db, scopedAuth('cue'), _cueEngine));
app.use('/mcp-tokens', createMcpTokensRouter(db, scopedAuth('token')));
// Unified external event stream over the shared EventBus (additive; the bespoke
// per-plugin SSE endpoints are unchanged). External tokens need an `events:read`
// scope; topics are further narrowed per-token by tokenAllowsTopic.
app.use('/events/stream', createProjectAccessMiddleware(db, jwtSecret, { requiredScope: 'events:read' }), createEventsStreamRouter(eventBus));
// Public catalog of subscribable event topics — single source of truth for the
// Setup Hub scope picker (no project data, so no auth). Mounted before the
// session `/events` router; that router only matches exactly `/events`.
app.use('/events/topics', createEventsCatalogRouter());
// Phase 3 — External event publishing (POST /events). Fenced to `external.*`
// namespace; rate/size limited; always audited. `requiredScope: 'events:write'`
// is enforced for external (`lcytmcp_`) tokens only — per
// createProjectAccessMiddleware's contract, session/user/project/device JWTs
// carry their own project-membership authorization and have full delegation,
// so the scope gate doesn't apply to them (same as every other scopedAuth()
// router in this file).
app.use('/events', createProjectAccessMiddleware(db, jwtSecret, { requiredScope: 'events:write' }), createEventsPublishRouter(eventBus));
// Phase 1 — In-process MCP endpoint (Streamable HTTP). Backed by the shared
// tool registry; scoped per-tool; destructive tools staged for confirmation.
// `requiredScope: 'mcp:connect'` is likewise enforced for external tokens
// only — see the note above /events.
app.use('/mcp', createProjectAccessMiddleware(db, jwtSecret, { requiredScope: 'mcp:connect' }), createMcpEndpointRouter({
  registry: _toolRegistry, eventBus, db, assistantManager: _assistantManager,
}));
// Phase 2 — Hosted operator (autonomous event-fed agent). Start/stop/status +
// confirm/reject pending actions.
app.use('/operator', scopedAuth('operator'), createOperatorRouter(_operatorManager));
app.use('/ai/providers', createProjectAiProvidersRouter(db, scopedAuth('ai'), { bridgeManager: productionBridgeManager }));
app.use('/ai', createAiRouter(db, scopedAuth('ai')));
app.use('/agent', createAgentRouter(db, scopedAuth('agent'), _agent));
app.use('/admin/ai-providers', createAdminAiProvidersRouter(db, createAdminMiddleware(db, jwtSecret), { bridgeManager: productionBridgeManager }));
app.use('/roles', createRolesRouter(db, scopedAuth('role')));
app.use('/roles', createRolesChatRouter(db, scopedAuth('role'), _toolsContext, _rolesBus, productionBridgeManager));
app.use('/roles', createVisionRolesRouter(db, scopedAuth('role'), _visionRoleManager, productionBridgeManager));
app.use('/roles/assistant', createProductionAssistantRouter(
  db, scopedAuth('role'), _toolsContext, _assistantManager, _agent,
  { listCameras, listMixers, registry: productionRegistry },
  productionBridgeManager,
));
app.use('/roles/planner', createPlannerRouter(db, scopedAuth('role'), _agent, productionBridgeManager));
app.use('/connectors', createConnectorsRouter(db, scopedAuth('connector')));
app.use('/actions', createActionsRouter(db, scopedAuth('action')));
app.use('/variables', createVariablesRouter(db, scopedAuth('variable'), _connectorsBus, _connectorsEngine, _connectorsScheduler, jwtSecret));
app.use('/admin/connector-network-rules', createGlobalNetworkRulesRouter(db, createAdminMiddleware(db, jwtSecret)));
app.use(createOrgNetworkRulesRouter(db, createUserAuthMiddleware(jwtSecret)));
app.use('/production', createProductionRouter(db, productionRegistry, productionBridgeManager, {
  publicUrl: process.env.PUBLIC_URL,
  mediamtxClient: productionMediamtxClient,
}));

// RTMP relay routes — only mounted when RTMP_RELAY_ACTIVE=1
if (process.env.RTMP_RELAY_ACTIVE === '1') {
  const { rtmpRouter, ingestionRouter, streamRouter, streamHlsRouter, radioRouter, previewRouter, cropRouter } =
    createRtmpRouters(db, auth, rtmp, { allowedRtmpDomains: _allowedRtmpDomains });
  app.use('/rtmp',       rtmpRouter);
  app.use('/ingestion',  ingestionRouter);
  app.use('/stream',     streamRouter);
  app.use('/stream-hls', streamHlsRouter);
  app.use('/radio',      radioRouter);
  app.use('/preview',    previewRouter);
  app.use('/crop',       cropRouter);
}

// Music detection (server-side HLS audio analysis) routes — only mounted when
// MUSIC_DETECTION_ACTIVE=1 and the optional lcyt-music plugin provided a MusicManager.
if (process.env.MUSIC_DETECTION_ACTIVE === '1' && musicManager) {
  app.use('/music', ...createMusicRouters(db, auth, musicManager));
}

// ---------------------------------------------------------------------------
// Exports (for testing and graceful shutdown wiring in index.js)
// ---------------------------------------------------------------------------

export { app, db, store, eventBus, relayManager, radioManager, hlsManager, hlsSubsManager, previewManager, sttManager, productionRegistry, productionBridgeManager, stopDsk, musicManager };
