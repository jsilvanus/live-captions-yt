import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import { parseCamera } from '../registry.js';
import { captureCameraThumbnail, deleteCameraThumbnailFile, thumbnailPath } from '../camera-thumbnail.js';

// 'rtmp' (plan_ingest_feeds.md §1a): a named feed pushed via RTMP rather
// than WHIP — no PTZ, uses camera_key/mixer_input exactly like webcam/mobile.
const CAMERA_CONTROL_TYPES = ['none', 'amx', 'visca-ip', 'webcam', 'mobile', 'rtmp'];
const BROWSER_CAMERA_TYPES = new Set(['webcam', 'mobile']);
// Mirrors lcyt-rtmp's rtmp-manager.js SAFE_NAME_RE — camera_key becomes a raw
// MediaMTX path/shell-command fragment in that plugin's runOnPublish
// registration (code-review follow-up: an unsafe camera_key previously
// wasn't rejected until relay start time, where it could abort unrelated
// relay slots — see rtmp-manager.js's per-group try/catch).
const CAMERA_KEY_RE = /^[A-Za-z0-9_-]+$/;

// Routes that must stay unauthenticated even after opts.auth is supplied:
// - /whip, /whip-url: CameraStreamPage.jsx is a capability-URL kiosk page
//   with no login flow (a dedicated device opens a bare URL and pushes its
//   webcam) — see plan_ingest_feeds.md's code-review follow-up in
//   CONSIDER.md for wiring these into the existing (currently-unused)
//   device-role JWT mechanism instead, out of scope here.
// - /thumbnail, /thumbnail.jpg: served as plain <img src> tags in the
//   production console (panes/index.jsx) — browsers don't attach
//   Authorization headers to image requests, so gating these would just
//   break every camera thumbnail tile.
function isUnauthenticatedCameraRoute(path) {
  return /\/whip(-url)?(\/|$)/.test(path) || /\/thumbnail(\.jpg)?$/.test(path);
}

export function createCamerasRouter(db, registry, bridgeManager = null, opts = {}) {
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

  if (auth) {
    router.use((req, res, next) => {
      if (isUnauthenticatedCameraRoute(req.path)) return next();
      return auth(req, res, next);
    });
  }

  /**
   * Build the computed thumbnailUrl field for a parsed camera row.
   * @param {object} camera  parseCamera() output
   * @param {import('express').Request} req
   */
  function withThumbnailUrl(camera, req) {
    const origin = `${req.protocol}://${req.get('host')}`;
    return {
      ...camera,
      thumbnailUrl: camera.thumbnailCapturedAt ? `${origin}/production/cameras/${camera.id}/thumbnail` : null,
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
   * Attach a computed `live` field for any camera with a camera_key —
   * webcam/mobile (WHIP) and 'rtmp' (plan_ingest_feeds.md §2b) all publish
   * to a MediaMTX path under that name, so the same liveness check already
   * used by GET /:id/whip-url works uniformly for all three. `null` means
   * "unknown" (no camera_key, or no MediaMTX client configured) — same
   * dim/neutral-dot convention the Ingestion card's video/dsk slots use.
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
    const rows = db
      .prepare('SELECT * FROM prod_cameras ORDER BY sort_order, created_at')
      .all()
      .filter(row => canAccessCamera(row, req))
      .map(row => withThumbnailUrl(parseCamera(row), req));
    res.json(await Promise.all(rows.map(withLive)));
  });

  // GET /production/cameras/:id — single camera
  router.get('/:id', async (req, res) => {
    const row = db.prepare('SELECT * FROM prod_cameras WHERE id = ?').get(req.params.id);
    // 404 (not 403) for a foreign camera — don't confirm its existence to a
    // caller who doesn't own it.
    if (!row || !canAccessCamera(row, req)) return res.status(404).json({ error: 'Camera not found' });
    res.json(await withLive(withThumbnailUrl(parseCamera(row), req)));
  });

  // POST /production/cameras — create camera
  router.post('/', (req, res) => {
    const {
      name, mixerInput, controlType = 'none', controlConfig = {},
      sortOrder = 0, bridgeInstanceId = null, connectionSource = 'backend',
      cameraKey = null, label = null, zone = null, overlapLinks = [],
    } = req.body;
    if (!name || typeof name !== 'string') {
      return res.status(400).json({ error: 'name is required' });
    }
    if (!CAMERA_CONTROL_TYPES.includes(controlType)) {
      return res.status(400).json({ error: `controlType must be one of: ${CAMERA_CONTROL_TYPES.join(', ')}` });
    }
    if (cameraKey != null && !CAMERA_KEY_RE.test(cameraKey)) {
      return res.status(400).json({ error: 'cameraKey may only contain letters, digits, underscore, and hyphen' });
    }
    const id = randomUUID();
    // Stamped from the now-real auth context when available; null (the
    // pre-existing open/legacy behavior) when this router is used without
    // auth wired in (e.g. existing route-level tests).
    const ownerApiKey = req.session?.apiKey ?? null;
    db.prepare(`
      INSERT INTO prod_cameras (id, name, mixer_input, control_type, control_config, bridge_instance_id, sort_order, connection_source, camera_key, owner_api_key, label, zone, overlap_links)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, name, mixerInput ?? null, controlType, JSON.stringify(controlConfig), bridgeInstanceId, sortOrder, connectionSource, cameraKey ?? null, ownerApiKey, label, zone, JSON.stringify(overlapLinks));

    const camera = parseCamera(db.prepare('SELECT * FROM prod_cameras WHERE id = ?').get(id));
    registry.reloadCamera(id).catch(err =>
      console.warn(`[production-control] reloadCamera after create: ${err.message}`)
    );
    res.status(201).json(camera);
  });

  // PUT /production/cameras/:id — update camera
  router.put('/:id', (req, res) => {
    const { id } = req.params;
    const existing = db.prepare('SELECT * FROM prod_cameras WHERE id = ?').get(id);
    if (!existing || !canAccessCamera(existing, req)) return res.status(404).json({ error: 'Camera not found' });

    const {
      name             = existing.name,
      mixerInput       = existing.mixer_input,
      controlType      = existing.control_type,
      controlConfig    = JSON.parse(existing.control_config),
      sortOrder        = existing.sort_order,
      bridgeInstanceId = existing.bridge_instance_id,
      connectionSource = existing.connection_source ?? 'backend',
      cameraKey        = existing.camera_key,
      label            = existing.label,
      zone             = existing.zone,
      overlapLinks     = JSON.parse(existing.overlap_links || '[]'),
    } = req.body;

    if (controlType && !CAMERA_CONTROL_TYPES.includes(controlType)) {
      return res.status(400).json({ error: `controlType must be one of: ${CAMERA_CONTROL_TYPES.join(', ')}` });
    }
    if (cameraKey != null && !CAMERA_KEY_RE.test(cameraKey)) {
      return res.status(400).json({ error: 'cameraKey may only contain letters, digits, underscore, and hyphen' });
    }

    db.prepare(`
      UPDATE prod_cameras
      SET name = ?, mixer_input = ?, control_type = ?, control_config = ?,
          bridge_instance_id = ?, sort_order = ?, connection_source = ?, camera_key = ?,
          label = ?, zone = ?, overlap_links = ?
      WHERE id = ?
    `).run(name, mixerInput ?? null, controlType, JSON.stringify(controlConfig),
           bridgeInstanceId ?? null, sortOrder, connectionSource, cameraKey ?? null,
           label, zone, JSON.stringify(overlapLinks), id);

    const camera = parseCamera(db.prepare('SELECT * FROM prod_cameras WHERE id = ?').get(id));
    registry.reloadCamera(id).catch(err =>
      console.warn(`[production-control] reloadCamera after update: ${err.message}`)
    );
    res.json(camera);
  });

  // DELETE /production/cameras/:id — delete camera
  router.delete('/:id', (req, res) => {
    const { id } = req.params;
    const existing = db.prepare('SELECT * FROM prod_cameras WHERE id = ?').get(id);
    if (!existing || !canAccessCamera(existing, req)) return res.status(404).json({ error: 'Camera not found' });

    db.prepare('DELETE FROM prod_cameras WHERE id = ?').run(id);
    registry.removeCamera(id).catch(() => {});
    deleteCameraThumbnailFile(id, cameraThumbnailOpts.thumbnailsDir);
    res.status(204).end();
  });

  // POST /production/cameras/:id/thumbnail/capture — capture a still frame as this camera's thumbnail
  router.post('/:id/thumbnail/capture', async (req, res) => {
    const row = db.prepare('SELECT * FROM prod_cameras WHERE id = ?').get(req.params.id);
    if (!row || !canAccessCamera(row, req)) return res.status(404).json({ error: 'Camera not found' });

    const camera = parseCamera(row);
    const { apiKey, mixerId } = req.body ?? {};
    const result = await captureCameraThumbnail(db, camera, registry, {
      apiKey, mixerId, ...cameraThumbnailOpts,
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    res.json({ ok: true, thumbnailCapturedAt: result.thumbnailCapturedAt, sizeBytes: result.sizeBytes });
  });

  // GET /production/cameras/:id/thumbnail(.jpg) — serve the saved thumbnail
  function serveThumbnail(req, res) {
    const row = db.prepare('SELECT thumbnail_captured_at FROM prod_cameras WHERE id = ?').get(req.params.id);
    if (!row || !row.thumbnail_captured_at) {
      return res.status(404).json({ error: 'No thumbnail captured for this camera' });
    }

    const filepath = thumbnailPath(req.params.id, cameraThumbnailOpts.thumbnailsDir);
    if (!fs.existsSync(filepath)) return res.status(404).json({ error: 'Thumbnail file not found on disk' });

    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=60');
    try { res.setHeader('Content-Length', fs.statSync(filepath).size); } catch { /* ignore */ }
    fs.createReadStream(filepath).pipe(res);
  }
  router.get('/:id/thumbnail', serveThumbnail);
  router.get('/:id/thumbnail.jpg', serveThumbnail);

  // POST /production/cameras/:id/preset/:presetId — trigger preset
  router.post('/:id/preset/:presetId', async (req, res) => {
    const { id, presetId } = req.params;
    const row = db.prepare('SELECT * FROM prod_cameras WHERE id = ?').get(id);
    if (!row || !canAccessCamera(row, req)) return res.status(404).json({ error: 'Camera not found' });

    try {
      const camera = parseCamera(row);
      // Whichever project's session recalled this preset — production-follow
      // (plan_vertical_crop.md §4) scopes the crop_source_map lookup to it,
      // same reasoning as the mixer-switch route above; prod_cameras has an
      // owner_api_key but it's optional/legacy, not what "which project is
      // driving this camera right now" means for the crop follow.
      const apiKey = req.session?.apiKey ?? null;
      // The crop editor's cameraPresetSources() (lcyt-web) binds
      // crop_source_map.camera_preset to a preset's presetNumber (VISCA) or
      // array index (AMX, which carries no numeric id) — never to `.id`,
      // which is what :presetId/req.params actually is here. Recompute the
      // same key the frontend used so production-follow can actually match
      // a row (plan_vertical_crop.md §4) instead of comparing a UUID to an
      // index/number, which would never match.
      const allPresets = camera.controlConfig?.presets ?? [];
      const presetIndex = allPresets.findIndex(p => p.id === presetId);
      const presetForFollow = presetIndex === -1 ? null : allPresets[presetIndex];
      const presetKey = presetForFollow
        ? (Number.isInteger(presetForFollow.presetNumber) ? presetForFollow.presetNumber : presetIndex)
        : presetId;

      // Bridge routing: if camera is assigned to a bridge, relay via SSE
      if (camera.bridgeInstanceId && bridgeManager) {
        if (!bridgeManager.isConnected(camera.bridgeInstanceId)) {
          return res.status(503).json({ error: 'Bridge is not connected' });
        }
        const preset = presetForFollow;
        if (!preset) {
          return res.status(400).json({ error: `Unknown preset '${presetId}'` });
        }
        await bridgeManager.sendCommand(camera.bridgeInstanceId, {
          host:    camera.controlConfig.host,
          port:    camera.controlConfig.port,
          payload: preset.command + '\r\n',
        });
      } else {
        // Direct TCP via registry
        await registry.callPreset(id, presetId);
      }

      registry.notifyCameraPresetRecalled({ apiKey, cameraId: id, preset: presetKey });
      res.json({ ok: true, cameraId: id, presetId });
    } catch (err) {
      const status = err.message.includes('not connected') || err.message.includes('timed out') ? 503 : 400;
      res.status(status).json({ error: err.message });
    }
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
    const row = db.prepare('SELECT * FROM prod_cameras WHERE id = ?').get(req.params.id);
    if (!row || !canAccessCamera(row, req)) return res.status(404).json({ error: 'Camera not found' });

    const camera = parseCamera(row);
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

  // POST /production/cameras/:id/perception/stop
  router.post('/:id/perception/stop', async (req, res) => {
    if (!perceptionManager) return res.status(503).json({ error: 'Perception dispatch not configured' });
    const row = db.prepare('SELECT * FROM prod_cameras WHERE id = ?').get(req.params.id);
    if (!row || !canAccessCamera(row, req)) return res.status(404).json({ error: 'Camera not found' });

    const stopped = await perceptionManager.stop(req.params.id);
    res.json({ ok: true, stopped });
  });

  // GET /production/cameras/:id/perception/status
  router.get('/:id/perception/status', (req, res) => {
    if (!perceptionManager) return res.status(503).json({ error: 'Perception dispatch not configured' });
    const row = db.prepare('SELECT * FROM prod_cameras WHERE id = ?').get(req.params.id);
    if (!row || !canAccessCamera(row, req)) return res.status(404).json({ error: 'Camera not found' });

    res.json({ ok: true, status: perceptionManager.status(req.params.id) });
  });

  // -------------------------------------------------------------------------
  // Browser camera — WHIP info and proxy
  // -------------------------------------------------------------------------

  // GET /production/cameras/:id/whip-url — WHIP proxy info for a browser camera
  router.get('/:id/whip-url', async (req, res) => {
    const row = db.prepare('SELECT * FROM prod_cameras WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Camera not found' });

    if (!BROWSER_CAMERA_TYPES.has(row.control_type)) {
      return res.status(400).json({ error: 'Camera is not a browser camera (webcam or mobile)' });
    }
    if (!row.camera_key) {
      return res.status(400).json({ error: 'Camera has no camera_key configured' });
    }

    let isLive = null;
    if (mediamtxClient) {
      try { isLive = await mediamtxClient.isPathPublishing(row.camera_key); } catch { /* ignore */ }
    }

    const origin = `${req.protocol}://${req.get('host')}`;
    res.json({
      cameraName: row.name,
      cameraKey:  row.camera_key,
      whipUrl:    `/production/cameras/${row.id}/whip`,
      hlsUrl:     `${origin}/stream-hls/${row.camera_key}/index.m3u8`,
      isLive,
    });
  });

  // POST /production/cameras/:id/whip — proxy SDP offer to MediaMTX WHIP endpoint
  router.post('/:id/whip', async (req, res) => {
    const row = db.prepare('SELECT * FROM prod_cameras WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Camera not found' });
    if (!BROWSER_CAMERA_TYPES.has(row.control_type)) {
      return res.status(400).json({ error: 'Camera is not a browser camera' });
    }
    if (!row.camera_key) {
      return res.status(400).json({ error: 'Camera has no camera_key configured' });
    }
    if (!mediamtxClient) {
      return res.status(503).json({ error: 'MediaMTX is not configured (MEDIAMTX_API_URL not set)' });
    }

    const sdpOffer = req.rawBody;
    if (!sdpOffer) return res.status(400).json({ error: 'SDP offer body is required' });

    // Kick any existing publisher so the new device replaces it
    try { await mediamtxClient.kickPath(row.camera_key); } catch { /* no-op if no publisher */ }

    const whipUrl = `${mediamtxClient.webrtcBaseUrl}/${encodeURIComponent(row.camera_key)}/whip`;
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
    const row = db.prepare('SELECT * FROM prod_cameras WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Camera not found' });
    if (!row.camera_key || !mediamtxClient) return res.status(204).end();

    const body = req.rawBody ?? '';
    const whipUrl = `${mediamtxClient.webrtcBaseUrl}/${encodeURIComponent(row.camera_key)}/whip`;
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
    const row = db.prepare('SELECT * FROM prod_cameras WHERE id = ?').get(req.params.id);
    if (!row || !row.camera_key || !mediamtxClient) return res.status(204).end();

    try { await mediamtxClient.kickPath(row.camera_key); } catch { /* ignore */ }
    res.status(204).end();
  });

  return router;
}
