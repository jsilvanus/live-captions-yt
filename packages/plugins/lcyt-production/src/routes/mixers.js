import { Router } from 'express';
import { createConnection } from 'node:net';
import { randomUUID } from 'node:crypto';
import { parseMixer } from '../registry.js';
import { getSwitchCommand as rolandGetSwitchCommand } from '../adapters/mixer/roland.js';
import { getSwitchCommand as amxGetSwitchCommand } from '../adapters/mixer/amx.js';
import { getSwitchCommand as atemGetSwitchCommand } from '../adapters/mixer/atem.js';
import { getSwitchCommand as monarchHdxGetSwitchCommand } from '../adapters/mixer/monarch_hdx.js';

const MIXER_TYPES = ['roland', 'amx', 'atem', 'monarch_hdx'];

export function createMixersRouter(db, registry, bridgeManager = null) {
  const router = Router();

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
    const { name, type, connectionConfig = {}, bridgeInstanceId = null } = req.body;
    if (!name || typeof name !== 'string') {
      return res.status(400).json({ error: 'name is required' });
    }
    if (!type || !MIXER_TYPES.includes(type)) {
      return res.status(400).json({ error: `type must be one of: ${MIXER_TYPES.join(', ')}` });
    }
    const id = randomUUID();
    db.prepare(`
      INSERT INTO prod_mixers (id, name, type, connection_config, bridge_instance_id)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, name, type, JSON.stringify(connectionConfig), bridgeInstanceId);

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
    } = req.body;

    if (type && !MIXER_TYPES.includes(type)) {
      return res.status(400).json({ error: `type must be one of: ${MIXER_TYPES.join(', ')}` });
    }

    db.prepare(`
      UPDATE prod_mixers SET name = ?, type = ?, connection_config = ?, bridge_instance_id = ?
      WHERE id = ?
    `).run(name, type, JSON.stringify(connectionConfig), bridgeInstanceId ?? null, id);

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
        await bridgeManager.sendCommand(mixer.bridgeInstanceId, command);
      } else {
        // Direct TCP via registry
        await registry.switchSource(id, input);
      }

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

  // POST /production/mixers/:id/test — test reachability (no persistent connection)
  router.post('/:id/test', async (req, res) => {
    const row = db.prepare('SELECT * FROM prod_mixers WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Mixer not found' });

    if (row.type === 'atem') {
      return res.status(400).json({ ok: false, error: 'Connection test not supported for UDP-based ATEM devices' });
    }

    if (row.type === 'monarch_hdx') {
      // HTTP reachability test — fetch status page from the Monarch
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

  return router;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build the bridge command object for a mixer source switch.
 *
 * Roland/AMX return `{ host, port, payload }` (no `type`), which BridgeManager
 * treats as a legacy `tcp_send` command. ATEM returns a typed object
 * `{ type: 'atem_switch', host, meIndex, inputNumber }`. Monarch HDx returns
 * `{ type: 'http_request', method, url, headers, body }`.
 *
 * @param {object} mixer
 * @param {number} inputNumber
 * @returns {object} command passed to BridgeManager.sendCommand()
 */
function buildSwitchCommand(mixer, inputNumber) {
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
