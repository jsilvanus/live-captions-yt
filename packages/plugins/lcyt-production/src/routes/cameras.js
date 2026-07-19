import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import { parseCamera } from '../registry.js';
import { captureCameraThumbnail, deleteCameraThumbnailFile, thumbnailPath } from '../camera-thumbnail.js';

// 'rtmp' (plan_ingest_feeds.md §1a): a named feed pushed via RTMP rather
// than WHIP — no PTZ, uses camera_key/mixer_input exactly like webcam/mobile.
const CAMERA_CONTROL_TYPES = ['none', 'amx', 'visca-ip', 'webcam', 'mobile', 'rtmp'];
const BROWSER_CAMERA_TYPES = new Set(['webcam', 'mobile']);

export function createCamerasRouter(db, registry, bridgeManager = null, opts = {}) {
  const mediamtxClient = opts.mediamtxClient ?? null;
  const cameraThumbnailOpts = opts.cameraThumbnail ?? {};
  const router = Router();

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

  // GET /production/cameras — list all cameras
  router.get('/', (req, res) => {
    const rows = db
      .prepare('SELECT * FROM prod_cameras ORDER BY sort_order, created_at')
      .all()
      .map(row => withThumbnailUrl(parseCamera(row), req));
    res.json(rows);
  });

  // GET /production/cameras/:id — single camera
  router.get('/:id', (req, res) => {
    const row = db.prepare('SELECT * FROM prod_cameras WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Camera not found' });
    res.json(withThumbnailUrl(parseCamera(row), req));
  });

  // POST /production/cameras — create camera
  router.post('/', (req, res) => {
    const {
      name, mixerInput, controlType = 'none', controlConfig = {},
      sortOrder = 0, bridgeInstanceId = null, connectionSource = 'backend',
      cameraKey = null,
    } = req.body;
    if (!name || typeof name !== 'string') {
      return res.status(400).json({ error: 'name is required' });
    }
    if (!CAMERA_CONTROL_TYPES.includes(controlType)) {
      return res.status(400).json({ error: `controlType must be one of: ${CAMERA_CONTROL_TYPES.join(', ')}` });
    }
    const id = randomUUID();
    db.prepare(`
      INSERT INTO prod_cameras (id, name, mixer_input, control_type, control_config, bridge_instance_id, sort_order, connection_source, camera_key)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, name, mixerInput ?? null, controlType, JSON.stringify(controlConfig), bridgeInstanceId, sortOrder, connectionSource, cameraKey ?? null);

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
    if (!existing) return res.status(404).json({ error: 'Camera not found' });

    const {
      name             = existing.name,
      mixerInput       = existing.mixer_input,
      controlType      = existing.control_type,
      controlConfig    = JSON.parse(existing.control_config),
      sortOrder        = existing.sort_order,
      bridgeInstanceId = existing.bridge_instance_id,
      connectionSource = existing.connection_source ?? 'backend',
      cameraKey        = existing.camera_key,
    } = req.body;

    if (controlType && !CAMERA_CONTROL_TYPES.includes(controlType)) {
      return res.status(400).json({ error: `controlType must be one of: ${CAMERA_CONTROL_TYPES.join(', ')}` });
    }

    db.prepare(`
      UPDATE prod_cameras
      SET name = ?, mixer_input = ?, control_type = ?, control_config = ?,
          bridge_instance_id = ?, sort_order = ?, connection_source = ?, camera_key = ?
      WHERE id = ?
    `).run(name, mixerInput ?? null, controlType, JSON.stringify(controlConfig),
           bridgeInstanceId ?? null, sortOrder, connectionSource, cameraKey ?? null, id);

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
    if (!existing) return res.status(404).json({ error: 'Camera not found' });

    db.prepare('DELETE FROM prod_cameras WHERE id = ?').run(id);
    registry.removeCamera(id).catch(() => {});
    deleteCameraThumbnailFile(id, cameraThumbnailOpts.thumbnailsDir);
    res.status(204).end();
  });

  // POST /production/cameras/:id/thumbnail/capture — capture a still frame as this camera's thumbnail
  router.post('/:id/thumbnail/capture', async (req, res) => {
    const row = db.prepare('SELECT * FROM prod_cameras WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Camera not found' });

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
    if (!row) return res.status(404).json({ error: 'Camera not found' });

    try {
      const camera = parseCamera(row);

      // Bridge routing: if camera is assigned to a bridge, relay via SSE
      if (camera.bridgeInstanceId && bridgeManager) {
        if (!bridgeManager.isConnected(camera.bridgeInstanceId)) {
          return res.status(503).json({ error: 'Bridge is not connected' });
        }
        const presets = camera.controlConfig?.presets ?? [];
        const preset  = presets.find(p => p.id === presetId);
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

      res.json({ ok: true, cameraId: id, presetId });
    } catch (err) {
      const status = err.message.includes('not connected') || err.message.includes('timed out') ? 503 : 400;
      res.status(status).json({ error: err.message });
    }
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
