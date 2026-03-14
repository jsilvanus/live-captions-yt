import { Router } from 'express';
import { createConnection } from 'node:net';
import { randomUUID } from 'node:crypto';
import { parseMixer } from '../registry.js';

const MIXER_TYPES = ['roland'];

export function createMixersRouter(db, registry) {
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
    const { name, type, connectionConfig = {} } = req.body;
    if (!name || typeof name !== 'string') {
      return res.status(400).json({ error: 'name is required' });
    }
    if (!type || !MIXER_TYPES.includes(type)) {
      return res.status(400).json({ error: `type must be one of: ${MIXER_TYPES.join(', ')}` });
    }
    const id = randomUUID();
    db.prepare(`
      INSERT INTO prod_mixers (id, name, type, connection_config)
      VALUES (?, ?, ?, ?)
    `).run(id, name, type, JSON.stringify(connectionConfig));

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
    } = req.body;

    if (type && !MIXER_TYPES.includes(type)) {
      return res.status(400).json({ error: `type must be one of: ${MIXER_TYPES.join(', ')}` });
    }

    db.prepare(`
      UPDATE prod_mixers SET name = ?, type = ?, connection_config = ? WHERE id = ?
    `).run(name, type, JSON.stringify(connectionConfig), id);

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
    if (!Number.isInteger(input) || input < 1) {
      return res.status(400).json({ error: 'inputNumber must be a positive integer' });
    }
    const existing = db.prepare('SELECT * FROM prod_mixers WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: 'Mixer not found' });

    try {
      await registry.switchSource(id, input);
      res.json({ ok: true, mixerId: id, activeSource: input });
    } catch (err) {
      const status = err.message.includes('not connected') ? 503 : 400;
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

  // POST /production/mixers/:id/test — test TCP reachability (no persistent connection)
  router.post('/:id/test', async (req, res) => {
    const row = db.prepare('SELECT * FROM prod_mixers WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Mixer not found' });

    const { host, port = 8023 } = JSON.parse(row.connection_config || '{}');
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
