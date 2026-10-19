import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import { Readable } from 'node:stream';
import { createAuthWithBypass } from '../auth-bypass.js';
import { parseCamera } from '../registry.js';
import { linkedFeedKeys, withCameraFeedKeys, ensureWhipFeed, findWhipFeedKey, unlinkCameraFeeds } from '../camera-feeds.js';
import { captureCameraThumbnail, deleteCameraThumbnailFile, thumbnailPath, thumbnailObjectKey } from '../camera-thumbnail.js';
import { requireTier } from '../route-access.js';
import { createProductionCommands, commandStatus } from '../commands.js';

// The 'rtmp' type is gone (feeds-and-devices PR 7): a pushed feed is a prod_feeds row linked to a camera of type 'none'.
const CAMERA_CONTROL_TYPES = ['none', 'amx', 'visca-ip', 'webcam', 'mobile'];
const BROWSER_CAMERA_TYPES = new Set(['webcam', 'mobile']);
// A camera's stream key is a feed key now (camera_key was dropped): create a feed (POST /feeds) and link it.
const CAMERA_KEY_REMOVED = 'cameraKey is no longer stored on cameras: create a feed (POST /feeds) and link it to the camera';

// Whether a request carries anything auth() would recognise as a credential
// (Authorization header, x-api-key, a query-string token, or an auth
// cookie) — mirrors middleware/project-access.js's extractAuthToken() plus
// the x-api-key project-id hint it also reads. Mirrors routes/mixers.js's
// identical helper (see CONSIDER.md's note on this carve-out pattern being
// hand-rolled per-router rather than shared).
function hasAuthCredentials(req) {
  if (req.headers.authorization) return true;
  if (req.headers['x-api-key']) return true;
  if (req.query?.token) return true;
  const cookie = req.headers.cookie || '';
  if (/(?:^|;\s*)(lcyt_project|lcyt_identity)=/.test(cookie)) return true;
  return false;
}

// Routes that must stay unauthenticated even after opts.auth is supplied:
// - /whip, /whip-url: CameraStreamPage.jsx is a capability-URL kiosk page
//   with no login flow of its own — but it now optionally sends the
//   device-role JWT from sessionStorage['lcyt-device'] (DeviceLoginPage.jsx)
//   as Authorization: Bearer when one is present. So this carve-out, like
//   mixers.js's /switch, only applies when the request carries no
//   credentials at all — a credentialed request goes through auth() as
//   normal (and canAccessCamera() below then enforces ownership), while a
//   bare capability URL with no device login stays exactly as open as
//   before this pass (no regression for deployments with no device roles
//   configured yet).
// - /thumbnail, /thumbnail.jpg: served as plain <img src> tags in the
//   production console (panes/index.jsx) — browsers don't attach
//   Authorization headers to image requests, so gating these would just
//   break every camera thumbnail tile. Stays unconditionally open.
function isUnauthenticatedCameraRoute(req) {
  const path = req.path;
  if (/\/thumbnail(\.jpg)?$/.test(path)) return true;
  if (/\/preset\/[^/]+\/thumbnail(\.jpg)?$/.test(path)) return true;
  if (/\/whip(-url)?(\/|$)/.test(path)) return !hasAuthCredentials(req);
  return false;
}

export function createCamerasRouter(db, registry, bridgeManager = null, opts = {}) {
  const commands = opts.commands ?? createProductionCommands({ db, registry, bridgeManager });
  const mediamtxClient = opts.mediamtxClient ?? null;
  const cameraThumbnailOpts = opts.cameraThumbnail ?? {};
  const perceptionManager = opts.perceptionManager ?? null;
  // Real session/user/device auth (createProjectAccessMiddleware, same as
  // every other project-scoped router) — optional so existing route-level
  // tests that construct this router directly keep working unauthenticated
  // (matching today's behavior) unless they explicitly opt in. server.js
  // always supplies it in production.
  const auth = opts.auth ?? null;
  const router = Router();

  const authMiddleware = createAuthWithBypass(auth, isUnauthenticatedCameraRoute);
  if (authMiddleware) router.use(authMiddleware);

  // Setup-tier CRUD vs. Production-tier live-control (plan_project_roles.md,
  // decided 2026-07-26) — see route-access.js's doc comment for the fail-open-
  // on-no-session / fail-closed-once-authenticated semantics this relies on.
  // POST /:id/thumbnail/capture and the perception/start|stop routes are
  // deliberately left ungated — genuinely ambiguous tier, see CONSIDER.md.
  const requireSetup = requireTier(opts.deps ?? {}, 'setup');
  const requireProduction = requireTier(opts.deps ?? {}, 'production');

  /**
   * Build the computed thumbnailUrl field for a parsed camera row.
   * @param {object} camera  parseCamera() output
   * @param {import('express').Request} req
   */
  async function withThumbnailUrl(camera, req) {
    const origin = `${req.protocol}://${req.get('host')}`;
    const presetRows = await db.prod_camera_preset_thumbnails.findMany({ where: { camera_id: camera.id } });
    const presetThumbnails = {};
    for (const r of presetRows) {
      presetThumbnails[r.preset_id] = {
        url: `${origin}/production/cameras/${camera.id}/preset/${encodeURIComponent(r.preset_id)}/thumbnail`,
        capturedAt: r.captured_at,
      };
    }
    return {
      ...camera,
      thumbnailUrl: camera.thumbnailCapturedAt ? `${origin}/production/cameras/${camera.id}/thumbnail` : null,
      presetThumbnails,
    };
  }

  /**
   * Ownership check: a camera with an owner_api_key set is only visible/
   * writable to the session that owns it; a camera with no owner (created
   * before this column existed, or via crud.js with no ownerApiKey) stays in
   * the pre-existing open/legacy bucket. When no auth middleware is wired in
   * at all (req.session is undefined), every camera is treated as accessible
   * — matches this router's previous fully-open behavior in that config.
   * @param {{owner_api_key: string|null}} row  raw DB row (pre-parseCamera)
   * @param {import('express').Request} req
   * @returns {boolean}
   */
  function canAccessCamera(row, req) {
    if (!req.session?.apiKey) return true;
    return row.owner_api_key == null || row.owner_api_key === req.session.apiKey;
  }

  /**
   * Attach a computed `live` field for any camera with a feed: webcam/mobile
   * (WHIP) and pushed feeds all publish to a MediaMTX path under the feed's
   * key, so one liveness check covers them. `null` means "unknown" (no feed,
   * or no MediaMTX client configured) — same dim/neutral-dot convention the
   * Feeds card uses.
   * @param {object} camera  parseCamera() output (already has thumbnailUrl attached)
   * @returns {Promise<object>}
   */
  async function withLive(camera) {
    if (!camera.cameraKey || !mediamtxClient) return { ...camera, live: null };
    let live = null;
    try { live = await mediamtxClient.isPathPublishing(camera.cameraKey); } catch { /* ignore */ }
    return { ...camera, live };
  }

  // -------------------------------------------------------------------------
  // Text body parser for WHIP SDP routes (must come before route definitions)
  // -------------------------------------------------------------------------
  router.use(
    '/:id/whip',
    (req, res, next) => {
      const ct = req.headers['content-type'] ?? '';
      if (ct.includes('application/sdp') || ct.includes('trickle-ice-sdpfrag')) {
        let body = '';
        req.setEncoding('utf8');
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => { req.rawBody = body; next(); });
        req.on('error', next);
      } else {
        next();
      }
    },
  );

  // GET /production/cameras — list all cameras. Filtered to the caller's own
  // + legacy/unowned cameras (plan_ingest_feeds.md's cross-tenant review
  // finding) — only takes effect once auth is wired in (req.session.apiKey set).
  router.get('/', async (req, res) => {
    const all = await db.prod_cameras.findMany({ orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }] });
    const rows = await Promise.all(all
      .filter(row => canAccessCamera(row, req))
      .map(row => withThumbnailUrl(parseCamera(row), req)));
    res.json(await Promise.all((await withCameraFeedKeys(db, rows)).map(withLive)));
  });

  // GET /production/cameras/:id — single camera
  router.get('/:id', async (req, res) => {
    const row = await db.prod_cameras.findUnique({ where: { id: req.params.id } });
    // 404 (not 403) for a foreign camera — don't confirm its existence to a
    // caller who doesn't own it.
    if (!row || !canAccessCamera(row, req)) return res.status(404).json({ error: 'Camera not found' });
    const [camera] = await withCameraFeedKeys(db, [await withThumbnailUrl(parseCamera(row), req)]);
    res.json(await withLive(camera));
  });

  // POST /production/cameras — create camera
  router.post('/', requireSetup, async (req, res) => {
    const {
      name, mixerInput, mixerId = null, controlType = 'none', controlConfig = {},
      sortOrder = 0, bridgeInstanceId = null, connectionSource = 'backend',
      cameraKey, label = null, zone = null, overlapLinks = [],
    } = req.body;
    if (!name || typeof name !== 'string') {
      return res.status(400).json({ error: 'name is required' });
    }
    if (!CAMERA_CONTROL_TYPES.includes(controlType)) {
      return res.status(400).json({ error: `controlType must be one of: ${CAMERA_CONTROL_TYPES.join(', ')}` });
    }
    if (cameraKey != null) return res.status(400).json({ error: CAMERA_KEY_REMOVED });
    const id = randomUUID();
    // Stamped from the now-real auth context when available; null (the
    // pre-existing open/legacy behavior) when this router is used without
    // auth wired in (e.g. existing route-level tests).
    const ownerApiKey = req.session?.apiKey ?? null;
    await db.prod_cameras.create({
      data: {
        id, name, mixer_input: mixerInput ?? null, control_type: controlType, control_config: JSON.stringify(controlConfig),
        bridge_instance_id: bridgeInstanceId, sort_order: sortOrder, connection_source: connectionSource,
        owner_api_key: ownerApiKey, label, zone,
        overlap_links: JSON.stringify(overlapLinks), mixer_id: mixerId,
      },
    });

    const [camera] = await withCameraFeedKeys(db, [parseCamera(await db.prod_cameras.findUnique({ where: { id } }))]);
    registry.reloadCamera(id).catch(err =>
      console.warn(`[production-control] reloadCamera after create: ${err.message}`)
    );
    res.status(201).json(camera);
  });

  // PUT /production/cameras/:id — update camera
  router.put('/:id', requireSetup, async (req, res) => {
    const { id } = req.params;
    const existing = await db.prod_cameras.findUnique({ where: { id } });
    if (!existing || !canAccessCamera(existing, req)) return res.status(404).json({ error: 'Camera not found' });

    const {
      name             = existing.name,
      mixerInput       = existing.mixer_input,
      mixerId          = existing.mixer_id,
      controlType      = existing.control_type,
      controlConfig    = JSON.parse(existing.control_config),
      sortOrder        = existing.sort_order,
      bridgeInstanceId = existing.bridge_instance_id,
      connectionSource = existing.connection_source ?? 'backend',
      label            = existing.label,
      zone             = existing.zone,
      overlapLinks     = JSON.parse(existing.overlap_links || '[]'),
    } = req.body;

    if (controlType && !CAMERA_CONTROL_TYPES.includes(controlType)) {
      return res.status(400).json({ error: `controlType must be one of: ${CAMERA_CONTROL_TYPES.join(', ')}` });
    }
    if (req.body?.cameraKey != null) return res.status(400).json({ error: CAMERA_KEY_REMOVED });

    await db.prod_cameras.updateMany({
      where: { id },
      data: {
        name, mixer_input: mixerInput ?? null, control_type: controlType, control_config: JSON.stringify(controlConfig),
        bridge_instance_id: bridgeInstanceId ?? null, sort_order: sortOrder, connection_source: connectionSource,
        label, zone, overlap_links: JSON.stringify(overlapLinks), mixer_id: mixerId ?? null,
      },
    });

    const [camera] = await withCameraFeedKeys(db, [parseCamera(await db.prod_cameras.findUnique({ where: { id } }))]);
    registry.reloadCamera(id).catch(err =>
      console.warn(`[production-control] reloadCamera after update: ${err.message}`)
    );
    res.json(camera);
  });

  // DELETE /production/cameras/:id — delete camera
  router.delete('/:id', requireSetup, async (req, res) => {
    const { id } = req.params;
    const existing = await db.prod_cameras.findUnique({ where: { id } });
    if (!existing || !canAccessCamera(existing, req)) return res.status(404).json({ error: 'Camera not found' });

    await db.prod_cameras.deleteMany({ where: { id } });
    await unlinkCameraFeeds(db, id);
    registry.removeCamera(id).catch(() => {});
    const presetIds = (await db.prod_camera_preset_thumbnails.findMany({ where: { camera_id: id }, select: { preset_id: true } })).map(r => r.preset_id);
    await db.prod_camera_preset_thumbnails.deleteMany({ where: { camera_id: id } });
    await deleteCameraThumbnailFile(id, cameraThumbnailOpts.thumbnailsDir, presetIds, cameraThumbnailOpts.thumbnailStore ?? null);
    res.status(204).end();
  });

  // POST /production/cameras/:id/thumbnail/capture — capture a still frame as this camera's thumbnail
  router.post('/:id/thumbnail/capture', async (req, res) => {
    const row = await db.prod_cameras.findUnique({ where: { id: req.params.id } });
    if (!row || !canAccessCamera(row, req)) return res.status(404).json({ error: 'Camera not found' });

    const [camera] = await withCameraFeedKeys(db, [parseCamera(row)]);
    const { apiKey, mixerId, presetId } = req.body ?? {};
    if (presetId != null && typeof presetId !== 'string') return res.status(400).json({ error: 'presetId must be a string' });
    const result = await captureCameraThumbnail(db, camera, registry, {
      apiKey, mixerId, presetId, ...cameraThumbnailOpts,
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    res.json({ ok: true, presetId: presetId || null, thumbnailCapturedAt: result.thumbnailCapturedAt, sizeBytes: result.sizeBytes });
  });

  // GET /production/cameras/:id/thumbnail(.jpg) — serve the saved thumbnail
  async function sendStoredJpeg(store, key, res) {
    try {
      const opened = await store.stream(key);
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'private, max-age=60');
      if (opened.contentLength != null) res.setHeader('Content-Length', String(opened.contentLength));
      const source = opened.stream?.pipe ? opened.stream : Readable.fromWeb(opened.stream);
      source.pipe(res);
    } catch {
      res.status(404).json({ error: 'Thumbnail file not found on disk' });
    }
  }

  async function serveThumbnail(req, res) {
    const row = await db.prod_cameras.findUnique({ where: { id: req.params.id }, select: { thumbnail_captured_at: true } });
    if (!row || !row.thumbnail_captured_at) {
      return res.status(404).json({ error: 'No thumbnail captured for this camera' });
    }

    if (cameraThumbnailOpts.thumbnailStore) {
      return sendStoredJpeg(cameraThumbnailOpts.thumbnailStore, thumbnailObjectKey(req.params.id, null), res);
    }

    const filepath = thumbnailPath(req.params.id, cameraThumbnailOpts.thumbnailsDir);
    if (!fs.existsSync(filepath)) return res.status(404).json({ error: 'Thumbnail file not found on disk' });

    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=60');
    try { res.setHeader('Content-Length', fs.statSync(filepath).size); } catch { /* ignore */ }
    fs.createReadStream(filepath).pipe(res);
  }
  function sendJpeg(filepath, res) {
    if (!fs.existsSync(filepath)) return res.status(404).json({ error: 'Thumbnail file not found on disk' });
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=60');
    try { res.setHeader('Content-Length', fs.statSync(filepath).size); } catch { /* ignore */ }
    fs.createReadStream(filepath).pipe(res);
  }

  // GET /production/cameras/:id/preset/:presetId/thumbnail(.jpg) — per-preset reference image
  async function servePresetThumbnail(req, res) {
    const row = await db.prod_camera_preset_thumbnails.findUnique({
      where: { camera_id_preset_id: { camera_id: req.params.id, preset_id: req.params.presetId } },
    });
    if (!row) return res.status(404).json({ error: 'No thumbnail captured for this preset' });
    if (cameraThumbnailOpts.thumbnailStore) {
      return sendStoredJpeg(cameraThumbnailOpts.thumbnailStore, thumbnailObjectKey(req.params.id, req.params.presetId), res);
    }
    sendJpeg(thumbnailPath(req.params.id, cameraThumbnailOpts.thumbnailsDir, req.params.presetId), res);
  }
  router.get('/:id/preset/:presetId/thumbnail', servePresetThumbnail);
  router.get('/:id/preset/:presetId/thumbnail.jpg', servePresetThumbnail);
  router.get('/:id/thumbnail', serveThumbnail);
  router.get('/:id/thumbnail.jpg', serveThumbnail);

  // POST /production/cameras/:id/preset/:presetId — trigger preset.
  // Ownership, bridge-vs-direct routing and the production-follow
  // notification (plan_vertical_crop.md §4) all live in ProductionCommands
  // (src/commands.js), shared with the AI tools and the action runner. The
  // acting session's apiKey (null for an unauthenticated kiosk request) is
  // what production-follow scopes the crop_source_map lookup to.
  router.post('/:id/preset/:presetId', requireProduction, async (req, res) => {
    const { id, presetId } = req.params;
    const result = await commands.callCameraPreset(req.session?.apiKey ?? null, id, presetId, { source: 'http' });
    if (!result.ok) return res.status(commandStatus(result)).json({ error: result.error });
    res.json({ ok: true, cameraId: id, presetId });
  });

  // -------------------------------------------------------------------------
  // fps30 tracker subsystem dispatch (plan_video_perception.md Phase 2)
  // -------------------------------------------------------------------------

  // POST /production/cameras/:id/perception/start — start a per-camera
  // perception job on the compute orchestration layer. Dedicated-feed
  // cameras only (needs a cameraKey) — shared/mixer-only cameras are
  // Phase 3's job, not this route's.
  router.post('/:id/perception/start', async (req, res) => {
    if (!perceptionManager) return res.status(503).json({ error: 'Perception dispatch not configured' });
    const row = await db.prod_cameras.findUnique({ where: { id: req.params.id } });
    if (!row || !canAccessCamera(row, req)) return res.status(404).json({ error: 'Camera not found' });

    const [camera] = await withCameraFeedKeys(db, [parseCamera(row)]);
    const apiKey = req.session?.apiKey ?? row.owner_api_key ?? null;
    if (!apiKey) return res.status(400).json({ error: 'No apiKey available for this camera (unowned camera needs an authenticated session)' });

    try {
      const result = await perceptionManager.start(apiKey, camera, { emitIntervalMs: req.body?.emitIntervalMs });
      res.json({ ok: true, ...result });
    } catch (err) {
      if (err.code === 'NOT_CONFIGURED') return res.status(503).json({ error: err.message });
      if (err.code === 'NO_FEED') return res.status(400).json({ error: err.message });
      res.status(502).json({ error: 'Failed to start perception job', message: err.message });
    }
  });

  // POST /production/cameras/:id/perception/auto { enabled } — keep this camera's perception job running
  // while its feed is live (started and stopped by the auto-start reconciler)
  router.post('/:id/perception/auto', async (req, res) => {
    const row = await db.prod_cameras.findUnique({ where: { id: req.params.id } });
    if (!row || !canAccessCamera(row, req)) return res.status(404).json({ error: 'Camera not found' });
    const enabled = req.body?.enabled;
    if (typeof enabled !== 'boolean') return res.status(400).json({ error: 'enabled must be a boolean' });
    if (enabled && !(await linkedFeedKeys(db, [row.id])).has(row.id)) return res.status(400).json({ error: 'camera has no feed (dedicated-feed cameras only)' });
    await db.prod_cameras.updateMany({ where: { id: req.params.id }, data: { perception_enabled: enabled ? 1 : 0 } });
    res.json({ ok: true, perceptionEnabled: enabled });
  });

  // POST /production/cameras/:id/perception/stop
  router.post('/:id/perception/stop', async (req, res) => {
    if (!perceptionManager) return res.status(503).json({ error: 'Perception dispatch not configured' });
    const row = await db.prod_cameras.findUnique({ where: { id: req.params.id } });
    if (!row || !canAccessCamera(row, req)) return res.status(404).json({ error: 'Camera not found' });

    const stopped = await perceptionManager.stop(req.params.id);
    res.json({ ok: true, stopped });
  });

  // GET /production/cameras/:id/perception/status
  router.get('/:id/perception/status', async (req, res) => {
    if (!perceptionManager) return res.status(503).json({ error: 'Perception dispatch not configured' });
    const row = await db.prod_cameras.findUnique({ where: { id: req.params.id } });
    if (!row || !canAccessCamera(row, req)) return res.status(404).json({ error: 'Camera not found' });

    res.json({ ok: true, status: perceptionManager.status(req.params.id) });
  });

  // -------------------------------------------------------------------------
  // Browser camera — WHIP info and proxy
  // -------------------------------------------------------------------------

  // GET /production/cameras/:id/whip-url — WHIP proxy info for a browser camera.
  // The WHIP path is the camera's WHIP feed (prod_feeds, transport 'whip'); a camera that has none gets one now.
  router.get('/:id/whip-url', async (req, res) => {
    const row = await db.prod_cameras.findUnique({ where: { id: req.params.id } });
    // A credential-less kiosk request never sets req.session (see
    // isUnauthenticatedCameraRoute() above), so canAccessCamera() correctly
    // fails open for it; a device-role JWT scoped to a different project is
    // rejected same as any other cross-tenant camera read.
    if (!row || !canAccessCamera(row, req)) return res.status(404).json({ error: 'Camera not found' });

    if (!BROWSER_CAMERA_TYPES.has(row.control_type)) {
      return res.status(400).json({ error: 'Camera is not a browser camera (webcam or mobile)' });
    }
    const feedKey = await ensureWhipFeed(db, row);
    if (!feedKey) return res.status(400).json({ error: 'Camera has no owning project, so it cannot get a WHIP feed' });

    let isLive = null;
    if (mediamtxClient) {
      try { isLive = await mediamtxClient.isPathPublishing(feedKey); } catch { /* ignore */ }
    }

    const origin = `${req.protocol}://${req.get('host')}`;
    res.json({
      cameraName: row.name,
      cameraKey:  feedKey,
      whipUrl:    `/production/cameras/${row.id}/whip`,
      hlsUrl:     `${origin}/stream-hls/${feedKey}/index.m3u8`,
      isLive,
    });
  });

  // POST /production/cameras/:id/whip — proxy SDP offer to MediaMTX WHIP endpoint
  router.post('/:id/whip', async (req, res) => {
    const row = await db.prod_cameras.findUnique({ where: { id: req.params.id } });
    if (!row || !canAccessCamera(row, req)) return res.status(404).json({ error: 'Camera not found' });
    if (!BROWSER_CAMERA_TYPES.has(row.control_type)) {
      return res.status(400).json({ error: 'Camera is not a browser camera' });
    }
    const feedKey = await ensureWhipFeed(db, row);
    if (!feedKey) return res.status(400).json({ error: 'Camera has no owning project, so it cannot get a WHIP feed' });
    if (!mediamtxClient) {
      return res.status(503).json({ error: 'MediaMTX is not configured (MEDIAMTX_API_URL not set)' });
    }

    const sdpOffer = req.rawBody;
    if (!sdpOffer) return res.status(400).json({ error: 'SDP offer body is required' });

    // Kick any existing publisher so the new device replaces it
    try { await mediamtxClient.kickPath(feedKey); } catch { /* no-op if no publisher */ }

    const whipUrl = `${mediamtxClient.webrtcBaseUrl}/${encodeURIComponent(feedKey)}/whip`;
    try {
      const upstream = await fetch(whipUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/sdp' },
        body: sdpOffer,
      });

      if (!upstream.ok && upstream.status !== 201) {
        const errText = await upstream.text().catch(() => '');
        return res.status(502).json({ error: `MediaMTX WHIP error ${upstream.status}: ${errText.slice(0, 200)}` });
      }

      const answerSdp = await upstream.text();
      res.status(201)
        .set('Content-Type', 'application/sdp')
        .set('Location', `/production/cameras/${row.id}/whip`)
        .send(answerSdp);
    } catch (err) {
      res.status(502).json({ error: `WHIP proxy failed: ${err.message}` });
    }
  });

  // PATCH /production/cameras/:id/whip — proxy trickle ICE candidates to MediaMTX
  router.patch('/:id/whip', async (req, res) => {
    const row = await db.prod_cameras.findUnique({ where: { id: req.params.id } });
    if (!row || !canAccessCamera(row, req)) return res.status(404).json({ error: 'Camera not found' });
    const feedKey = await findWhipFeedKey(db, row.id);
    if (!feedKey || !mediamtxClient) return res.status(204).end();

    const body = req.rawBody ?? '';
    const whipUrl = `${mediamtxClient.webrtcBaseUrl}/${encodeURIComponent(feedKey)}/whip`;
    try {
      const upstream = await fetch(whipUrl, {
        method: 'PATCH',
        headers: { 'Content-Type': req.headers['content-type'] ?? 'application/trickle-ice-sdpfrag' },
        body,
      });
      res.status(upstream.status).end();
    } catch {
      res.status(204).end();
    }
  });

  // DELETE /production/cameras/:id/whip — terminate WHIP session (kick publisher)
  router.delete('/:id/whip', async (req, res) => {
    const row = await db.prod_cameras.findUnique({ where: { id: req.params.id } });
    if (!row || !canAccessCamera(row, req)) return res.status(204).end();
    const feedKey = await findWhipFeedKey(db, row.id);
    if (!feedKey || !mediamtxClient) return res.status(204).end();

    try { await mediamtxClient.kickPath(feedKey); } catch { /* ignore */ }
    res.status(204).end();
  });

  return router;
}
