#!/usr/bin/env node
// Minimal mock backend for local screenshot/demo/testing purposes only — just
// enough surface for the frontend's connect() flow and DSK Editor's data
// fetches (including real in-memory template CRUD) to work end-to-end
// without a real lcyt-backend. Not for any other use.
import express from 'express';

const app = express();
const PORT = Number(process.env.PORT) || 4000;

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ ok: true, features: ['rtmp', 'graphics', 'production', 'ai', 'admin'] });
});

app.post('/live', (_req, res) => {
  res.json({ token: 'dev-token', sequence: 0, syncOffset: 0, startedAt: Date.now(), graphicsEnabled: true });
});

// ── Setup Hub card faces — empty-list/default stubs so the hub renders
// clean empty states instead of 404s during screenshot/demo sessions. ──────
app.get('/production/cameras', (_req, res) => res.json([]));
app.get('/production/mixers', (_req, res) => res.json([]));
app.get('/production/encoders', (_req, res) => res.json([]));
app.get('/production/bridge/instances', (_req, res) => res.json([]));
app.get('/connectors', (_req, res) => res.json({ connectors: [] }));
app.get('/variables', (_req, res) => res.json({ variables: {} }));
app.get('/ai/config', (_req, res) => res.json({ config: { embeddingProvider: 'none' } }));
app.get('/stt/config', (_req, res) => res.json({ config: {} }));
app.get('/file/storage-config', (_req, res) => res.json({ storageMode: 'default', config: null }));

app.get('/events', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
  res.flushHeaders?.();
  const iv = setInterval(() => res.write(`data: ${JSON.stringify({ event: 'ping' })}\n\n`), 5000);
  req.on('close', () => clearInterval(iv));
});

// ── DSK templates — real in-memory CRUD so save/reload round-trips actually
// persist, e.g. for testing per-viewport layer position overrides. ──────────
const templates = new Map(); // id -> { id, name, templateJson }
let nextTemplateId = 1;

app.get('/dsk/:apikey/templates', (_req, res) => {
  res.json({ templates: [...templates.values()].map(({ id, name }) => ({ id, name })) });
});

app.get('/dsk/:apikey/templates/:id', (req, res) => {
  const row = templates.get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json({ template: row });
});

app.post('/dsk/:apikey/templates', (req, res) => {
  const id = String(nextTemplateId++);
  const { name, template } = req.body || {};
  templates.set(id, { id, name: name || 'Untitled', templateJson: template });
  res.json({ id });
});

app.put('/dsk/:apikey/templates/:id', (req, res) => {
  const row = templates.get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  const { name, template } = req.body || {};
  if (name !== undefined) row.name = name;
  if (template !== undefined) row.templateJson = template;
  res.json({ id: row.id });
});

app.delete('/dsk/:apikey/templates/:id', (req, res) => {
  templates.delete(req.params.id);
  res.json({ ok: true });
});

app.get('/dsk/:apikey/images', (_req, res) => res.json({ images: [] }));

// Vertical viewport alongside the built-in Landscape (1920x1080), so the
// per-viewport layer position override feature (layer.viewports.<name>) has
// a second viewport to actually test against.
app.get('/dsk/:apikey/viewports/public', (_req, res) => {
  res.json({ viewports: [{ name: 'vertical', label: 'Vertical', width: 1080, height: 1920 }] });
});

app.listen(PORT, () => console.log(`[screenshot-mock-backend] listening on http://localhost:${PORT}`));
