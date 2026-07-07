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
// One browser camera so IngestionSection's camera-phantom row has something
// to show (mirrors the mockup's `ingestionCamPhantoms`).
app.get('/production/cameras', (_req, res) => res.json([
  { id: 'cam-1', name: 'Lobby phone cam', controlType: 'mobile', cameraKey: 'demo-lobby' },
]));
app.get('/production/mixers', (_req, res) => res.json([]));
app.get('/production/encoders', (_req, res) => res.json([]));
app.get('/production/bridge/instances', (_req, res) => res.json([]));
app.get('/connectors', (_req, res) => res.json({ connectors: [] }));
app.get('/variables', (_req, res) => res.json({ variables: {} }));
app.get('/ai/config', (_req, res) => res.json({ config: { embeddingProvider: 'none' } }));
let sttConfig = { provider: 'google', language: 'en-US', audioSource: 'hls' };
app.get('/stt/config', (_req, res) => res.json({ config: sttConfig }));
const sttSourceLanguages = [
  { id: 1, lang: 'en-US', label: 'English (US)', sortOrder: 0 },
  { id: 2, lang: 'fi-FI', label: 'Finnish',       sortOrder: 1 },
];
app.get('/stt/source-languages', (_req, res) => res.json({ languages: sttSourceLanguages }));
app.post('/stt/config/source-language', (req, res) => {
  sttConfig = { ...sttConfig, language: (req.body || {}).lang || sttConfig.language };
  res.json({ ok: true, config: sttConfig });
});
app.put('/stt/config', (req, res) => {
  sttConfig = { ...sttConfig, ...(req.body || {}) };
  res.json({ ok: true, config: sttConfig });
});
app.get('/file/storage-config', (_req, res) => res.json({ storageMode: 'default', config: null }));

// ── Ingestion + Web Radio — in-memory stand-ins for
// docs/plans/plan_selfservice_config_backend.md §2/§2a and §3/§3a, not
// implemented on the real backend yet. ──────────────────────────────────────
let ingestionConfig = {
  video: { enabled: true, active: true, streamKey: 'lc_demo_key', ingestUrl: 'rtmp://ingest.example.com/live/lc_demo_key', rotatable: true, live: true },
  dsk:   { enabled: true, ingestUrl: 'rtmp://ingest.example.com/dsk/lc_demo_key', live: null },
};
app.get('/ingestion/config', (_req, res) => res.json(ingestionConfig));
app.patch('/ingestion/config', (req, res) => {
  const { video, dsk } = req.body || {};
  if (video) ingestionConfig.video = { ...ingestionConfig.video, ...video };
  if (dsk) ingestionConfig.dsk = { ...ingestionConfig.dsk, ...dsk };
  res.json(ingestionConfig);
});

let radioConfig = { title: '', description: '', coverImageUrl: '', autoplay: false, enabled: true, live: false };
app.get('/radio/config', (_req, res) => res.json(radioConfig));
app.put('/radio/config', (req, res) => {
  radioConfig = { ...radioConfig, ...(req.body || {}) };
  res.json(radioConfig);
});

// ── Caption targets — in-memory stand-in for
// docs/plans/plan_selfservice_config_backend.md §1 (PR #239). ──────────────
app.get('/icons', (_req, res) => res.json({ icons: [] }));

const targets = new Map(); // id -> target
app.get('/targets', (_req, res) => res.json({ targets: [...targets.values()] }));
app.post('/targets', (req, res) => {
  const id = crypto.randomUUID();
  const { type, streamKey, url, viewerKey, noBatch } = req.body || {};
  const target = { id, type, enabled: true, sortOrder: targets.size, streamKey: streamKey || null, url: url || null, headers: null, viewerKey: viewerKey || null, noBatch: !!noBatch };
  targets.set(id, target);
  res.status(201).json({ ok: true, target });
});
app.put('/targets/:id', (req, res) => {
  const row = targets.get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Target not found' });
  Object.assign(row, req.body || {});
  res.json({ ok: true, target: row });
});
app.delete('/targets/:id', (req, res) => {
  const existed = targets.delete(req.params.id);
  if (!existed) return res.status(404).json({ error: 'Target not found' });
  res.json({ ok: true });
});

// ── Translation config — in-memory stand-in for
// docs/plans/plan_selfservice_config_backend.md §1 (real routes already
// implemented server-side; this mock exists for local frontend dev). ───────
let translationVendor = { vendor: 'mymemory', vendorApiKey: null, libreUrl: null, libreKey: null, showOriginal: false };
const translationTargets = new Map(); // id -> target
app.get('/translation/config', (_req, res) => res.json({ vendor: translationVendor, targets: [...translationTargets.values()] }));
app.put('/translation/config/vendor', (req, res) => {
  translationVendor = { ...translationVendor, ...(req.body || {}) };
  res.json({ ok: true, vendor: translationVendor });
});
app.post('/translation/config/targets', (req, res) => {
  const id = crypto.randomUUID();
  const { enabled = true, lang, target, format = null } = req.body || {};
  const row = { id, enabled, lang, target, format, sortOrder: translationTargets.size };
  translationTargets.set(id, row);
  res.status(201).json({ ok: true, target: row });
});
app.put('/translation/config/targets/:id', (req, res) => {
  const row = translationTargets.get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Translation target not found' });
  Object.assign(row, req.body || {});
  res.json({ ok: true, target: row });
});
app.delete('/translation/config/targets/:id', (req, res) => {
  const existed = translationTargets.delete(req.params.id);
  if (!existed) return res.status(404).json({ error: 'Translation target not found' });
  res.json({ ok: true });
});

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

// ── DSK viewports (project-scoped CRUD) — real in-memory store, same shape
// the Setup Hub's Viewports card and DskViewportsPage both use. ────────────
const viewports = new Map(); // name -> { name, label, viewportType, width, height, textLayers }

app.get('/dsk/:apikey/viewports', (_req, res) => {
  res.json({ viewports: [...viewports.values()] });
});

app.post('/dsk/:apikey/viewports', (req, res) => {
  const { name, label, viewportType, width, height } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name is required' });
  if (viewports.has(name)) return res.status(409).json({ error: 'A viewport with that name already exists' });
  viewports.set(name, { name, label: label || '', viewportType: viewportType || 'vertical', width: width || 1080, height: height || 1920, textLayers: [] });
  res.json({ ok: true });
});

app.put('/dsk/:apikey/viewports/:name', (req, res) => {
  const row = viewports.get(req.params.name);
  if (!row) return res.status(404).json({ error: 'Not found' });
  Object.assign(row, req.body || {});
  res.json({ ok: true });
});

app.delete('/dsk/:apikey/viewports/:name', (req, res) => {
  viewports.delete(req.params.name);
  res.json({ ok: true });
});

// ── RTMP relay status (Egress card's "Relay status" toggle) ────────────────
let relayActive = false;
app.get('/stream', (_req, res) => {
  res.json({ active: relayActive, relays: [], runningSlots: [] });
});
app.put('/stream/active', (req, res) => {
  relayActive = !!(req.body || {}).active;
  res.json({ ok: true, active: relayActive });
});

app.listen(PORT, () => console.log(`[screenshot-mock-backend] listening on http://localhost:${PORT}`));
