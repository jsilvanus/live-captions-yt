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
  res.json({ ok: true, features: ['rtmp', 'graphics', 'production', 'ai', 'admin', 'login'] });
});

// ── User auth (login-mode) + Team/Org + Admin — in-memory stand-ins for
// screenshotting the reconciled Profile/Team/Admin pages against the Claude
// Design mockup (see BACKEND_PROJECT.md; none of this exists on the real
// backend yet except the already-shipped /orgs CRUD, which this mirrors). ──
const DEMO_USER = { userId: 1, email: 'juha@lcyt.fi', name: 'Juha Korhonen', isAdmin: true };
let demoUser = { ...DEMO_USER };

app.post('/auth/login', (_req, res) => res.json({ token: 'dev-user-token', ...demoUser }));
app.post('/auth/register', (_req, res) => res.json({ token: 'dev-user-token', ...demoUser }));
app.get('/auth/me', (_req, res) => res.json(demoUser));
app.post('/auth/change-password', (_req, res) => res.json({ ok: true }));
app.patch('/auth/me', (req, res) => {
  demoUser = { ...demoUser, name: (req.body || {}).name ?? demoUser.name };
  res.json(demoUser);
});
app.get('/auth/me/export', (_req, res) => res.json({ user: demoUser, projects: [], orgs: [...orgs.values()] }));
app.delete('/auth/me/data', (_req, res) => res.json({ deletedProjectCount: 0 }));
app.delete('/auth/me', (_req, res) => res.json({ deleted: true }));

const orgs = new Map(); // id -> { id, name, slug, role, memberCount, projectCount }
const orgMembers = new Map(); // orgId -> [{ userId, email, name, role, joinedAt, projectCount }]
const orgProjects = new Map(); // orgId -> [{ key, owner, createdAt, active, orgId }]
const orgFeatures = new Map(); // orgId -> string[]
let nextOrgId = 1;
{
  const id = nextOrgId++;
  orgs.set(id, { id, name: 'Acme Media', slug: 'acme-media', role: 'owner', memberCount: 2, projectCount: 1 });
  orgMembers.set(id, [
    { userId: 1, email: demoUser.email, name: demoUser.name, role: 'owner', joinedAt: '2026-01-01T00:00:00.000Z', projectCount: 1 },
    { userId: 2, email: 'viewer@example.com', name: 'Sam Viewer', role: 'viewer', joinedAt: '2026-02-01T00:00:00.000Z', projectCount: 0 },
  ]);
  orgProjects.set(id, [{ key: 'demo-key-1', owner: 'Sunday Service', createdAt: '2026-01-01T00:00:00.000Z', active: true, orgId: id }]);
  orgFeatures.set(id, ['captions', 'viewer-target', 'stats']);
}

app.get('/orgs', (_req, res) => res.json({ organizations: [...orgs.values()] }));
app.post('/orgs', (req, res) => {
  const id = nextOrgId++;
  const name = (req.body || {}).name || 'New team';
  const org = { id, name, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), role: 'owner', memberCount: 1, projectCount: 0 };
  orgs.set(id, org);
  orgMembers.set(id, [{ userId: 1, email: demoUser.email, name: demoUser.name, role: 'owner', joinedAt: new Date().toISOString(), projectCount: 0 }]);
  orgProjects.set(id, []);
  orgFeatures.set(id, []);
  res.status(201).json({ organization: org });
});
app.get('/orgs/:id', (req, res) => {
  const org = orgs.get(Number(req.params.id));
  if (!org) return res.status(404).json({ error: 'Organization not found' });
  res.json({ organization: org, role: org.role });
});
app.get('/orgs/:id/members', (req, res) => res.json({ members: orgMembers.get(Number(req.params.id)) || [] }));
app.post('/orgs/:id/members', (req, res) => {
  const orgId = Number(req.params.id);
  const { email, role } = req.body || {};
  const member = { userId: Date.now(), email, name: email.split('@')[0], role: role || 'viewer', joinedAt: new Date().toISOString(), projectCount: 0 };
  orgMembers.set(orgId, [...(orgMembers.get(orgId) || []), member]);
  const org = orgs.get(orgId);
  if (org) org.memberCount = (orgMembers.get(orgId) || []).length;
  res.status(201).json({ member });
});
app.patch('/orgs/:id/members/:userId', (req, res) => {
  const orgId = Number(req.params.id);
  const userId = Number(req.params.userId);
  const members = orgMembers.get(orgId) || [];
  const member = members.find(m => m.userId === userId);
  if (!member) return res.status(404).json({ error: 'Member not found' });
  member.role = (req.body || {}).role || member.role;
  res.json({ member: { userId, role: member.role } });
});
app.delete('/orgs/:id/members/:userId', (req, res) => {
  const orgId = Number(req.params.id);
  const userId = Number(req.params.userId);
  orgMembers.set(orgId, (orgMembers.get(orgId) || []).filter(m => m.userId !== userId));
  const org = orgs.get(orgId);
  if (org) org.memberCount = (orgMembers.get(orgId) || []).length;
  res.json({ removed: true });
});
app.get('/orgs/:id/projects', (req, res) => res.json({ projects: orgProjects.get(Number(req.params.id)) || [] }));
app.get('/orgs/:id/features', (req, res) => res.json({ features: orgFeatures.get(Number(req.params.id)) || [] }));
app.put('/orgs/:id/features', (req, res) => {
  const orgId = Number(req.params.id);
  const features = Array.isArray((req.body || {}).features) ? req.body.features : [];
  orgFeatures.set(orgId, features);
  res.json({ features });
});

// ── Admin — Site Features / Teams / Users / Projects ────────────────────────
const BINARY_ONLY = new Set(['ingest', 'radio', 'hls-stream', 'preview', 'stt-server', 'device-control', 'graphics-server', 'cea-captions']);
const sitePolicies = new Map([
  ['captions', 'available'], ['viewer-target', 'available'], ['stats', 'available'],
  ['file-saving', 'self_service'], ['translations', 'self_service'],
  ['ingest', 'denied'], ['stt-server', 'denied'], ['device-control', 'denied'],
]);
app.get('/admin/feature-policies', (_req, res) => {
  res.json({ policies: [...sitePolicies.entries()].map(([code, mode]) => ({ code, mode, binaryOnly: BINARY_ONLY.has(code) })) });
});
app.put('/admin/feature-policies/:code', (req, res) => {
  sitePolicies.set(req.params.code, (req.body || {}).mode);
  res.json({ code: req.params.code, mode: (req.body || {}).mode });
});

const orgOverrides = new Map(); // orgId -> Map(code -> mode)
app.get('/admin/orgs/:id/feature-overrides', (req, res) => {
  const overrides = orgOverrides.get(Number(req.params.id)) || new Map();
  res.json({ overrides: [...overrides.entries()].map(([code, mode]) => ({ code, mode, binaryOnly: BINARY_ONLY.has(code) })) });
});
app.put('/admin/orgs/:id/feature-overrides/:code', (req, res) => {
  const orgId = Number(req.params.id);
  const mode = (req.body || {}).mode;
  const overrides = orgOverrides.get(orgId) || new Map();
  if (mode === null || mode === undefined) overrides.delete(req.params.code);
  else overrides.set(req.params.code, mode);
  orgOverrides.set(orgId, overrides);
  res.json({ code: req.params.code, mode: mode ?? null });
});

app.get('/admin/orgs', (req, res) => {
  const q = (req.query.q || '').toString().toLowerCase();
  const list = [...orgs.values()].filter(o => !q || o.name.toLowerCase().includes(q));
  res.json({ orgs: list, total: list.length, limit: 50, offset: 0 });
});
app.get('/admin/users', (_req, res) => {
  const users = [...orgMembers.values()].flat().map(m => ({
    id: m.userId, email: m.email, name: m.name, active: true, created_at: m.joinedAt,
    role: m.role, orgName: [...orgs.values()][0]?.name || null,
  }));
  res.json({ users, total: users.length, limit: 50, offset: 0 });
});
app.get('/admin/projects', (_req, res) => {
  const projects = [...orgProjects.values()].flat().map(p => ({ ...p, userEmail: demoUser.email, userId: 1, orgName: orgs.get(p.orgId)?.name || null, expires: null }));
  res.json({ projects, total: projects.length, limit: 50, offset: 0 });
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
