#!/usr/bin/env node
// Mock backend for screenshotting the Production operator page only.
// Serves richer production/cameras + production/mixers + DSK template + cue
// data than the general screenshot mock, plus coloured thumbnail images so the
// mixer/monitor/program panes render real pictures. Not for any other use.
import express from 'express';

const app = express();
const PORT = Number(process.env.PORT) || 4010;

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use(express.json());

app.get('/health', (_req, res) => res.json({ ok: true, features: ['rtmp', 'graphics', 'production', 'ai', 'admin', 'login'] }));
app.post('/live', (_req, res) => res.json({ token: 'dev-token', sequence: 112, syncOffset: 0, startedAt: Date.now(), graphicsEnabled: true }));

// ── Coloured thumbnail images ───────────────────────────────────────────────
function svg(color, label) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="${color}"/><text x="16" y="160" font-family="monospace" font-size="20" fill="rgba(255,255,255,.85)">${label}</text></svg>`;
}
const THUMBS = { 'cam-1': ['#264d33', 'WIDE'], 'cam-2': ['#26364d', 'CENTRE'] };
app.get('/production/cameras/:id/thumbnail', (req, res) => {
  const t = THUMBS[req.params.id];
  if (!t) return res.status(404).end();
  res.setHeader('Content-Type', 'image/svg+xml');
  res.send(svg(t[0], t[1]));
});

// ── Cameras ─────────────────────────────────────────────────────────────────
const origin = () => `http://localhost:${PORT}`;
const cameras = [
  { id: 'cam-1', name: 'Wide',    mixerInput: 1, controlType: 'amx',      controlConfig: { presets: [{ id: 'p1', name: '1' }, { id: 'p2', name: '2' }, { id: 'p3', name: '3' }] }, thumbnailUrl: `${''}` },
  { id: 'cam-2', name: 'Centre',  mixerInput: 2, controlType: 'visca-ip', controlConfig: { presets: [{ id: 'p1', name: '1' }, { id: 'p2', name: '2' }] } },
  { id: 'cam-3', name: 'Pulpit',  mixerInput: 3, controlType: 'amx',      controlConfig: { presets: [{ id: 'p1', name: '1' }, { id: 'p2', name: '2' }] } },
  { id: 'cam-4', name: 'Balcony', mixerInput: 4, controlType: 'none',     controlConfig: {} },
];
app.get('/production/cameras', (_req, res) => res.json(cameras.map((c) => ({
  ...c, thumbnailUrl: THUMBS[c.id] ? `${origin()}/production/cameras/${c.id}/thumbnail` : null,
}))));
app.post('/production/cameras/:id/preset/:presetId', (req, res) => res.json({ ok: true, cameraId: req.params.id, presetId: req.params.presetId }));
app.post('/production/cameras/:id/thumbnail/capture', (req, res) => { THUMBS[req.params.id] = ['#4d3a26', req.params.id.toUpperCase()]; res.json({ ok: true, thumbnailCapturedAt: new Date().toISOString() }); });

// ── Mixer ───────────────────────────────────────────────────────────────────
let activeSource = 1;
app.get('/production/mixers', (_req, res) => res.json([{ id: 'mix-1', name: 'Main', type: 'lcyt', connected: true, activeSource }]));
app.post('/production/mixers/:id/switch/:input', (req, res) => { activeSource = Number(req.params.input); res.json({ ok: true, mixerId: req.params.id, activeSource }); });

// ── DSK templates ───────────────────────────────────────────────────────────
const templates = {
  '1': { id: 1, name: 'Speaker', templateJson: { layers: [
    { id: 'name', type: 'text', name: 'Name', text: 'Rev. Dr. Amara Osei' },
    { id: 'org', type: 'text', name: 'Organization', text: 'Grace Chapel' },
  ] } },
  '2': { id: 2, name: 'Soon Live', templateJson: { layers: [] } },
};
app.get('/dsk/:apikey/templates', (_req, res) => res.json({ templates: Object.values(templates).map(({ id, name }) => ({ id, name })) }));
app.get('/dsk/:apikey/templates/:id', (req, res) => { const t = templates[req.params.id]; if (!t) return res.status(404).json({ error: 'Not found' }); res.json({ template: t }); });
app.post('/dsk/:apikey/broadcast', (_req, res) => res.json({ ok: true }));
app.post('/dsk/:apikey/graphics', (_req, res) => res.json({ ok: true }));

// ── Cue rules ───────────────────────────────────────────────────────────────
const cueRules = [
  { id: 'c1', name: 'Welcome', match_type: 'phrase', pattern: 'welcome', enabled: 1, action: {} },
  { id: 'c2', name: 'Worship stanza', match_type: 'fuzzy', pattern: 'great are you lord', enabled: 1, action: {} },
  { id: 'c3', name: 'Offering', match_type: 'phrase', pattern: 'giving', enabled: 0, action: {} },
];
app.get('/cues/rules', (_req, res) => res.json({ rules: cueRules }));
app.post('/cues/rules', (req, res) => { cueRules.push({ id: 'c' + (cueRules.length + 1), enabled: 1, action: {}, ...(req.body || {}) }); res.status(201).json({ id: 'new', ok: true }); });

// ── Relay + STT + assistant ─────────────────────────────────────────────────
let relayActive = false;
app.get('/stream', (_req, res) => res.json({ active: relayActive, slots: [{ slot: 1, videoBitrate: 6000, scale: '1080p60' }] }));
app.put('/stream/active', (req, res) => { relayActive = !!(req.body || {}).active; res.json({ ok: true, active: relayActive }); });
app.get('/stt/status', (_req, res) => res.json({ running: false }));
app.post('/stt/start', (_req, res) => res.json({ ok: true }));
app.post('/stt/stop', (_req, res) => res.json({ ok: true }));
app.get('/youtube/config', (_req, res) => res.json({ clientId: null }));
app.post('/roles/assistant/prompt', (_req, res) => res.json({ ok: true, reply: 'Noted — I’ll line that up in the rundown and flag it before the segment.' }));

app.get('/events', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
  res.flushHeaders?.();
  const iv = setInterval(() => res.write(`data: ${JSON.stringify({ event: 'ping' })}\n\n`), 5000);
  req.on('close', () => clearInterval(iv));
});
app.get('/events/stream', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
  res.flushHeaders?.();
  const iv = setInterval(() => res.write(`: ping\n\n`), 5000);
  req.on('close', () => clearInterval(iv));
});

app.listen(PORT, () => console.log(`[production-mock] listening on http://localhost:${PORT}`));
