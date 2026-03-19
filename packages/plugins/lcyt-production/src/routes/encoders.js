/**
 * Encoders route — CRUD + start/stop for hardware encoders.
 *
 * Supported types: 'monarch_hd', 'monarch_hdx'
 *
 * Connection sources:
 *   'backend'  — backend server calls the encoder's HTTP API directly
 *   'frontend' — frontend browser calls the encoder's HTTP API directly
 *                (backend stores config but does NOT route commands)
 *   'bridge'   — bridge agent calls the encoder's HTTP API via http_request command
 */

import { Router } from 'express';
import { randomUUID } from 'node:crypto';

const ENCODER_TYPES = ['monarch_hd', 'monarch_hdx'];
const VALID_CONNECTION_SOURCES = ['backend', 'frontend', 'bridge'];

export function parseEncoder(row) {
  return {
    ...row,
    connectionConfig: JSON.parse(row.connection_config || '{}'),
    connectionSource: row.connection_source ?? 'backend',
    bridgeInstanceId: row.bridge_instance_id,
    createdAt:        row.created_at,
  };
}

export function createEncodersRouter(db, bridgeManager = null) {
  const router = Router();

  // GET /production/encoders — list all encoders
  router.get('/', (_req, res) => {
    const rows = db
      .prepare('SELECT * FROM prod_encoders ORDER BY created_at')
      .all()
      .map(parseEncoder);
    res.json(rows);
  });

  // GET /production/encoders/:id — single encoder
  router.get('/:id', (req, res) => {
    const row = db.prepare('SELECT * FROM prod_encoders WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Encoder not found' });
    res.json(parseEncoder(row));
  });

  // POST /production/encoders — create encoder
  router.post('/', (req, res) => {
    const {
      name,
      type,
      connectionConfig   = {},
      connectionSource   = 'backend',
      bridgeInstanceId   = null,
    } = req.body;

    if (!name || typeof name !== 'string') {
      return res.status(400).json({ error: 'name is required' });
    }
    if (!type || !ENCODER_TYPES.includes(type)) {
      return res.status(400).json({ error: `type must be one of: ${ENCODER_TYPES.join(', ')}` });
    }
    if (!VALID_CONNECTION_SOURCES.includes(connectionSource)) {
      return res.status(400).json({ error: `connectionSource must be one of: ${VALID_CONNECTION_SOURCES.join(', ')}` });
    }

    const id = randomUUID();
    db.prepare(`
      INSERT INTO prod_encoders (id, name, type, connection_config, connection_source, bridge_instance_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, name, type, JSON.stringify(connectionConfig), connectionSource, bridgeInstanceId);

    res.status(201).json(parseEncoder(db.prepare('SELECT * FROM prod_encoders WHERE id = ?').get(id)));
  });

  // PUT /production/encoders/:id — update encoder
  router.put('/:id', (req, res) => {
    const { id } = req.params;
    const existing = db.prepare('SELECT * FROM prod_encoders WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: 'Encoder not found' });

    const {
      name             = existing.name,
      type             = existing.type,
      connectionConfig = JSON.parse(existing.connection_config),
      connectionSource = existing.connection_source ?? 'backend',
      bridgeInstanceId = existing.bridge_instance_id,
    } = req.body;

    if (type && !ENCODER_TYPES.includes(type)) {
      return res.status(400).json({ error: `type must be one of: ${ENCODER_TYPES.join(', ')}` });
    }
    if (!VALID_CONNECTION_SOURCES.includes(connectionSource)) {
      return res.status(400).json({ error: `connectionSource must be one of: ${VALID_CONNECTION_SOURCES.join(', ')}` });
    }

    db.prepare(`
      UPDATE prod_encoders
      SET name = ?, type = ?, connection_config = ?, connection_source = ?, bridge_instance_id = ?
      WHERE id = ?
    `).run(name, type, JSON.stringify(connectionConfig), connectionSource, bridgeInstanceId ?? null, id);

    res.json(parseEncoder(db.prepare('SELECT * FROM prod_encoders WHERE id = ?').get(id)));
  });

  // DELETE /production/encoders/:id — delete encoder
  router.delete('/:id', (req, res) => {
    const { id } = req.params;
    const existing = db.prepare('SELECT * FROM prod_encoders WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: 'Encoder not found' });

    db.prepare('DELETE FROM prod_encoders WHERE id = ?').run(id);
    res.status(204).end();
  });

  // POST /production/encoders/:id/start — start encoder
  router.post('/:id/start', async (req, res) => {
    const row = db.prepare('SELECT * FROM prod_encoders WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Encoder not found' });

    const encoder = parseEncoder(row);

    if (encoder.connectionSource === 'frontend') {
      return res.status(400).json({
        error: 'This encoder is configured for direct browser control. Trigger start from the frontend.',
      });
    }

    try {
      if (encoder.connectionSource === 'bridge') {
        await _sendBridgeCommand(encoder, 'start', bridgeManager);
      } else {
        await _directHttpCommand(encoder, 'start');
      }
      res.json({ ok: true, encoderId: encoder.id });
    } catch (err) {
      const status = err.message.includes('not connected') || err.message.includes('timed out') ? 503 : 502;
      res.status(status).json({ error: err.message });
    }
  });

  // POST /production/encoders/:id/stop — stop encoder
  router.post('/:id/stop', async (req, res) => {
    const row = db.prepare('SELECT * FROM prod_encoders WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Encoder not found' });

    const encoder = parseEncoder(row);

    if (encoder.connectionSource === 'frontend') {
      return res.status(400).json({
        error: 'This encoder is configured for direct browser control. Trigger stop from the frontend.',
      });
    }

    try {
      if (encoder.connectionSource === 'bridge') {
        await _sendBridgeCommand(encoder, 'stop', bridgeManager);
      } else {
        await _directHttpCommand(encoder, 'stop');
      }
      res.json({ ok: true, encoderId: encoder.id });
    } catch (err) {
      const status = err.message.includes('not connected') || err.message.includes('timed out') ? 503 : 502;
      res.status(status).json({ error: err.message });
    }
  });

  // POST /production/encoders/:id/test — test HTTP reachability
  router.post('/:id/test', async (req, res) => {
    const row = db.prepare('SELECT * FROM prod_encoders WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Encoder not found' });

    const encoder = parseEncoder(row);

    if (encoder.connectionSource === 'frontend') {
      return res.status(400).json({
        ok: false,
        error: 'This encoder uses browser-direct connection. Test from your browser.',
      });
    }

    const { host, protocol = 'http', username = 'admin', password = 'admin' } = encoder.connectionConfig;
    if (!host) return res.status(400).json({ ok: false, error: 'connectionConfig.host is not set' });

    const auth = Buffer.from(`${username}:${password}`).toString('base64');
    try {
      const r = await fetch(`${protocol}://${host}/Monarch/sdk/status`, {
        headers: { Authorization: `Basic ${auth}` },
        signal: AbortSignal.timeout(4_000),
      });
      const body = await r.json().catch(() => ({}));
      if (r.ok) return res.json({ ok: true, host, status: body });
      return res.status(502).json({ ok: false, host, error: `HTTP ${r.status}` });
    } catch (err) {
      return res.status(502).json({ ok: false, host, error: err.message });
    }
  });

  return router;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Make a direct HTTP call to a Monarch encoder (from the backend server).
 * @param {object} encoder
 * @param {'start'|'stop'} action
 */
async function _directHttpCommand(encoder, action) {
  const { host, protocol = 'http', username = 'admin', password = 'admin', encoderNumber = 1 } =
    encoder.connectionConfig;
  if (!host) throw new Error('connectionConfig.host is required');

  const auth = Buffer.from(`${username}:${password}`).toString('base64');
  const url  = `${protocol}://${host}/Monarch/sdk/encoder${encoderNumber}/${action}`;

  const r = await fetch(url, {
    method:  'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    body:    '{}',
    signal:  AbortSignal.timeout(8_000),
  });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new Error(`Encoder HTTP ${r.status}: ${text}`);
  }
}

/**
 * Send a start/stop command via bridge http_request.
 * @param {object} encoder
 * @param {'start'|'stop'} action
 * @param {object|null} bridgeManager
 */
async function _sendBridgeCommand(encoder, action, bridgeManager) {
  if (!bridgeManager) throw new Error('BridgeManager not available');
  if (!encoder.bridgeInstanceId) throw new Error('No bridge instance configured for this encoder');
  if (!bridgeManager.isConnected(encoder.bridgeInstanceId)) {
    throw new Error('Bridge is not connected');
  }

  const { host, protocol = 'http', username = 'admin', password = 'admin', encoderNumber = 1 } =
    encoder.connectionConfig;
  if (!host) throw new Error('connectionConfig.host is required');

  const auth = Buffer.from(`${username}:${password}`).toString('base64');
  await bridgeManager.sendCommand(encoder.bridgeInstanceId, {
    type:    'http_request',
    method:  'POST',
    url:     `${protocol}://${host}/Monarch/sdk/encoder${encoderNumber}/${action}`,
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    body:    {},
  });
}
