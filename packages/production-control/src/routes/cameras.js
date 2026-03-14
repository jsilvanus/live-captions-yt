import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { parseCamera } from '../registry.js';

export function createCamerasRouter(db, registry) {
  const router = Router();

  // GET /production/cameras — list all cameras
  router.get('/', (_req, res) => {
    const rows = db
      .prepare('SELECT * FROM prod_cameras ORDER BY sort_order, created_at')
      .all()
      .map(parseCamera);
    res.json(rows);
  });

  // GET /production/cameras/:id — single camera
  router.get('/:id', (req, res) => {
    const row = db.prepare('SELECT * FROM prod_cameras WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Camera not found' });
    res.json(parseCamera(row));
  });

  // POST /production/cameras — create camera
  router.post('/', (req, res) => {
    const { name, mixerInput, controlType = 'none', controlConfig = {}, sortOrder = 0 } = req.body;
    if (!name || typeof name !== 'string') {
      return res.status(400).json({ error: 'name is required' });
    }
    const id = randomUUID();
    db.prepare(`
      INSERT INTO prod_cameras (id, name, mixer_input, control_type, control_config, sort_order)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, name, mixerInput ?? null, controlType, JSON.stringify(controlConfig), sortOrder);

    const camera = parseCamera(db.prepare('SELECT * FROM prod_cameras WHERE id = ?').get(id));
    // Asynchronously open adapter connection for the new camera
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
      name       = existing.name,
      mixerInput = existing.mixer_input,
      controlType = existing.control_type,
      controlConfig = JSON.parse(existing.control_config),
      sortOrder  = existing.sort_order,
    } = req.body;

    db.prepare(`
      UPDATE prod_cameras
      SET name = ?, mixer_input = ?, control_type = ?, control_config = ?, sort_order = ?
      WHERE id = ?
    `).run(name, mixerInput ?? null, controlType, JSON.stringify(controlConfig), sortOrder, id);

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
    res.status(204).end();
  });

  // POST /production/cameras/:id/preset/:presetId — trigger preset
  router.post('/:id/preset/:presetId', async (req, res) => {
    const { id, presetId } = req.params;
    const existing = db.prepare('SELECT * FROM prod_cameras WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: 'Camera not found' });

    try {
      await registry.callPreset(id, presetId);
      res.json({ ok: true, cameraId: id, presetId });
    } catch (err) {
      const status = err.message.includes('not connected') ? 503 : 400;
      res.status(status).json({ error: err.message });
    }
  });

  return router;
}
