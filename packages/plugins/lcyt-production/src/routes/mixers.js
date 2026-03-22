import { Router } from 'express';
import { createConnection } from 'node:net';
import { randomUUID } from 'node:crypto';
import { parseMixer } from '../registry.js';
import { getSwitchCommand as rolandGetSwitchCommand } from '../adapters/mixer/roland.js';
import { getSwitchCommand as amxGetSwitchCommand } from '../adapters/mixer/amx.js';
import { getSwitchCommand as atemGetSwitchCommand } from '../adapters/mixer/atem.js';
import { getSwitchCommand as monarchHdxGetSwitchCommand } from '../adapters/mixer/monarch_hdx.js';

const MIXER_TYPES = ['roland', 'amx', 'atem', 'monarch_hdx', 'lcyt'];

export function createMixersRouter(db, registry, bridgeManager = null, opts = {}) {
  const mediamtxClient = opts.mediamtxClient ?? null;
  const router = Router();

  // -------------------------------------------------------------------------
  // Text body parser for WHIP SDP routes
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

  // GET /production/mixers — list all mixers with connection status
  router.get('/', (_req, res) => {
    const rows = db
      .prepare('SELECT * FROM prod_mixers ORDER BY created_at')
      .all()
      .map(row => {
        const mixer = parseMixer(row);
        return {
          ...mixer,
          connected: registry.isMixerConnected(mixer.id),
          activeSource: registry.getActiveSource(mixer.id),
        };
      });
    res.json(rows);
  });

  // GET /production/mixers/:id — single mixer
  router.get('/:id', (req, res) => {
    const row = db.prepare('SELECT * FROM prod_mixers WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Mixer not found' });
    const mixer = parseMixer(row);
    res.json({
      ...mixer,
      connected: registry.isMixerConnected(mixer.id),
      activeSource: registry.getActiveSource(mixer.id),
    });
  });

  // POST /production/mixers — create mixer
  router.post('/', (req, res) => {
    const { name, type, connectionConfig = {}, bridgeInstanceId = null, connectionSource = 'backend', outputKey = null } = req.body;
    if (!name || typeof name !== 'string') {
      return res.status(400).json({ error: 'name is required' });
    }
    if (!type || !MIXER_TYPES.includes(type)) {
      return res.status(400).json({ error: `type must be one of: ${MIXER_TYPES.join(', ')}` });
    }
    const id = randomUUID();
    db.prepare(`
      INSERT INTO prod_mixers (id, name, type, connection_config, bridge_instance_id, connection_source, output_key)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, name, type, JSON.stringify(connectionConfig), bridgeInstanceId, connectionSource, outputKey);

    const mixer = parseMixer(db.prepare('SELECT * FROM prod_mixers WHERE id = ?').get(id));
    registry.reloadMixer(id).catch(err =>
      console.warn(`[production-control] reloadMixer after create: ${err.message}`)
    );
    res.status(201).json({ ...mixer, connected: false, activeSource: null });
  });

  // PUT /production/mixers/:id — update mixer
  router.put('/:id', (req, res) => {
    const { id } = req.params;
    const existing = db.prepare('SELECT * FROM prod_mixers WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: 'Mixer not found' });

    const {
      name             = existing.name,
      type             = existing.type,
      connectionConfig = JSON.parse(existing.connection_config),
      bridgeInstanceId = existing.bridge_instance_id,
      connectionSource = existing.connection_source ?? 'backend',
      outputKey        = existing.output_key,
    } = req.body;

    if (type && !MIXER_TYPES.includes(type)) {
      return res.status(400).json({ error: `type must be one of: ${MIXER_TYPES.join(', ')}` });
    }

    db.prepare(`
      UPDATE prod_mixers SET name = ?, type = ?, connection_config = ?, bridge_instance_id = ?, connection_source = ?, output_key = ?
      WHERE id = ?
    `).run(name, type, JSON.stringify(connectionConfig), bridgeInstanceId ?? null, connectionSource, outputKey ?? null, id);

    const mixer = parseMixer(db.prepare('SELECT * FROM prod_mixers WHERE id = ?').get(id));
    registry.reloadMixer(id).catch(err =>
      console.warn(`[production-control] reloadMixer after update: ${err.message}`)
    );
    res.json({ ...mixer, connected: registry.isMixerConnected(id), activeSource: registry.getActiveSource(id) });
  });

  // DELETE /production/mixers/:id — delete mixer
  router.delete('/:id', (req, res) => {
    const { id } = req.params;
    const existing = db.prepare('SELECT * FROM prod_mixers WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: 'Mixer not found' });

    db.prepare('DELETE FROM prod_mixers WHERE id = ?').run(id);
    registry.removeMixer(id).catch(() => {});
    res.status(204).end();
  });

  // POST /production/mixers/:id/switch/:inputNumber — switch program source
  router.post('/:id/switch/:inputNumber', async (req, res) => {
    const { id, inputNumber } = req.params;
    const input = Number(inputNumber);
    if (!Number.isInteger(input) || input < 0) {
      return res.status(400).json({ error: 'inputNumber must be a non-negative integer' });
    }
    const row = db.prepare('SELECT * FROM prod_mixers WHERE id = ?').get(id);
    if (!row) return res.status(404).json({ error: 'Mixer not found' });

    try {
      const mixer = parseMixer(row);

      // Bridge routing: if mixer is assigned to a bridge, relay via SSE
      if (mixer.bridgeInstanceId && bridgeManager) {
        if (!bridgeManager.isConnected(mixer.bridgeInstanceId)) {
          return res.status(503).json({ error: 'Bridge is not connected' });
        }
        const command = buildSwitchCommand(mixer, input);
        // lcyt mixer returns null — skip bridge dispatch, fall through to registry
        if (command !== null) {
          await bridgeManager.sendCommand(mixer.bridgeInstanceId, command);
          return res.json({ ok: true, mixerId: id, activeSource: input });
        }
      }

      // Direct via registry (handles lcyt in-memory tracking and all non-bridge cases)
      await registry.switchSource(id, input);
      res.json({ ok: true, mixerId: id, activeSource: input });
    } catch (err) {
      const status = err.message.includes('not connected') || err.message.includes('timed out') ? 503 : 400;
      res.status(status).json({ error: err.message });
    }
  });

  // GET /production/mixers/:id/active — current active input
  router.get('/:id/active', (req, res) => {
    const { id } = req.params;
    const existing = db.prepare('SELECT * FROM prod_mixers WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: 'Mixer not found' });

    res.json({
      mixerId: id,
      activeSource: registry.getActiveSource(id),
      connected: registry.isMixerConnected(id),
    });
  });

  // POST /production/mixers/:id/test — test reachability
  router.post('/:id/test', async (req, res) => {
    const row = db.prepare('SELECT * FROM prod_mixers WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Mixer not found' });

    if (row.type === 'lcyt') {
      return res.status(400).json({ ok: false, error: 'Connection test is not applicable for the LCYT software mixer' });
    }
    if (row.type === 'atem') {
      return res.status(400).json({ ok: false, error: 'Connection test not supported for UDP-based ATEM devices' });
    }

    if (row.type === 'monarch_hdx') {
      const { host, protocol = 'http', username = 'admin', password = 'admin' } =
        JSON.parse(row.connection_config || '{}');
      if (!host) return res.status(400).json({ ok: false, error: 'connectionConfig.host is not set' });
      const auth = Buffer.from(`${username}:${password}`).toString('base64');
      try {
        const r = await fetch(`${protocol}://${host}/Monarch/sdk/status`, {
          headers: { Authorization: `Basic ${auth}` },
          signal: AbortSignal.timeout(4_000),
        });
        if (r.ok) {
          const body = await r.json().catch(() => ({}));
          return res.json({ ok: true, host, status: body });
        }
        return res.status(502).json({ ok: false, host, error: `HTTP ${r.status}` });
      } catch (err) {
        return res.status(502).json({ ok: false, host, error: err.message });
      }
    }

    const { host, port = row.type === 'amx' ? 1319 : 8023 } =
      JSON.parse(row.connection_config || '{}');
    if (!host) return res.status(400).json({ ok: false, error: 'connectionConfig.host is not set' });

    const TIMEOUT_MS = 4_000;
    const result = await new Promise((resolve) => {
      const socket = createConnection({ host, port: Number(port) }, () => {
        socket.destroy();
        resolve({ ok: true });
      });
      socket.setTimeout(TIMEOUT_MS);
      socket.on('timeout', () => { socket.destroy(); resolve({ ok: false, error: 'Connection timed out' }); });
      socket.on('error', (err) => resolve({ ok: false, error: err.message }));
    });

    res.status(result.ok ? 200 : 502).json({ ...result, host, port });
  });

  // -------------------------------------------------------------------------
  // LCYT Software Mixer — sources and WHIP proxy
  // -------------------------------------------------------------------------

  // GET /production/mixers/:id/sources — camera sources for this mixer
  router.get('/:id/sources', async (req, res) => {
    const row = db.prepare('SELECT * FROM prod_mixers WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Mixer not found' });
    if (row.type !== 'lcyt') {
      return res.status(400).json({ error: 'Sources endpoint is only available for LCYT software mixers' });
    }

    const cameras = db
      .prepare('SELECT * FROM prod_cameras WHERE mixer_input IS NOT NULL ORDER BY sort_order, created_at')
      .all();

    const origin = `${req.protocol}://${req.get('host')}`;
    const sources = await Promise.all(cameras.map(async cam => {
      let isLive = null;
      if (mediamtxClient && cam.camera_key) {
        try { isLive = await mediamtxClient.isPathPublishing(cam.camera_key); } catch { /* ignore */ }
      }
      return {
        cameraId:   cam.id,
        name:       cam.name,
        mixerInput: cam.mixer_input,
        cameraKey:  cam.camera_key ?? null,
        controlType: cam.control_type,
        hlsUrl:     cam.camera_key ? `${origin}/stream-hls/${cam.camera_key}/index.m3u8` : null,
        thumbUrl:   cam.camera_key ? `${origin}/preview/${cam.camera_key}/incoming.jpg` : null,
        isLive,
      };
    }));

    res.json(sources);
  });

  // GET /production/mixers/:id/whip-url — WHIP proxy info for LCYT mixer output
  router.get('/:id/whip-url', async (req, res) => {
    const row = db.prepare('SELECT * FROM prod_mixers WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Mixer not found' });
    if (row.type !== 'lcyt') {
      return res.status(400).json({ error: 'WHIP output is only available for LCYT software mixers' });
    }
    if (!row.output_key) {
      return res.status(400).json({ error: 'Mixer has no output_key configured' });
    }

    const origin = `${req.protocol}://${req.get('host')}`;
    res.json({
      outputKey: row.output_key,
      whipUrl:   `/production/mixers/${row.id}/whip`,
      hlsUrl:    `${origin}/stream-hls/${row.output_key}/index.m3u8`,
    });
  });

  // POST /production/mixers/:id/whip — proxy SDP offer to MediaMTX WHIP endpoint
  router.post('/:id/whip', async (req, res) => {
    const row = db.prepare('SELECT * FROM prod_mixers WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Mixer not found' });
    if (row.type !== 'lcyt') return res.status(400).json({ error: 'Mixer is not an LCYT software mixer' });
    if (!row.output_key) return res.status(400).json({ error: 'Mixer has no output_key configured' });
    if (!mediamtxClient) {
      return res.status(503).json({ error: 'MediaMTX is not configured (MEDIAMTX_API_URL not set)' });
    }

    const sdpOffer = req.rawBody;
    if (!sdpOffer) return res.status(400).json({ error: 'SDP offer body is required' });

    // Kick any existing publisher so the new mixer page replaces it
    try { await mediamtxClient.kickPath(row.output_key); } catch { /* no-op if no publisher */ }

    const whipUrl = `${mediamtxClient.webrtcBaseUrl}/${encodeURIComponent(row.output_key)}/whip`;
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
        .set('Location', `/production/mixers/${row.id}/whip`)
        .send(answerSdp);
    } catch (err) {
      res.status(502).json({ error: `WHIP proxy failed: ${err.message}` });
    }
  });

  // PATCH /production/mixers/:id/whip — proxy trickle ICE candidates
  router.patch('/:id/whip', async (req, res) => {
    const row = db.prepare('SELECT * FROM prod_mixers WHERE id = ?').get(req.params.id);
    if (!row || !row.output_key || !mediamtxClient) return res.status(204).end();

    const body = req.rawBody ?? '';
    const whipUrl = `${mediamtxClient.webrtcBaseUrl}/${encodeURIComponent(row.output_key)}/whip`;
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

  // DELETE /production/mixers/:id/whip — terminate WHIP session (kick publisher)
  router.delete('/:id/whip', async (req, res) => {
    const row = db.prepare('SELECT * FROM prod_mixers WHERE id = ?').get(req.params.id);
    if (!row || !row.output_key || !mediamtxClient) return res.status(204).end();

    try { await mediamtxClient.kickPath(row.output_key); } catch { /* ignore */ }
    res.status(204).end();
  });

  return router;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build the bridge command object for a mixer source switch.
 * Returns null for mixer types that do not use bridge dispatch (e.g. lcyt).
 */
function buildSwitchCommand(mixer, inputNumber) {
  if (mixer.type === 'lcyt') return null;
  if (mixer.type === 'roland') {
    return {
      host:    mixer.connectionConfig.host,
      port:    mixer.connectionConfig.port ?? 8023,
      payload: rolandGetSwitchCommand(mixer.connectionConfig, inputNumber),
    };
  }
  if (mixer.type === 'amx') {
    return {
      host:    mixer.connectionConfig.host,
      port:    mixer.connectionConfig.port ?? 1319,
      payload: amxGetSwitchCommand(mixer.connectionConfig, inputNumber),
    };
  }
  if (mixer.type === 'atem') {
    return atemGetSwitchCommand(mixer.connectionConfig, inputNumber);
  }
  if (mixer.type === 'monarch_hdx') {
    return monarchHdxGetSwitchCommand(mixer.connectionConfig, inputNumber);
  }
  throw new Error(`No bridge command builder for mixer type '${mixer.type}'`);
}
