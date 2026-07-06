#!/usr/bin/env node
// Minimal mock backend for local screenshot/demo purposes only — just enough
// surface for the frontend's connect() flow and DSK Editor's data fetches to
// succeed without erroring. Not for any other use.
import express from 'express';

const app = express();
const PORT = Number(process.env.PORT) || 4000;

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
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

app.get('/events', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
  res.flushHeaders?.();
  const iv = setInterval(() => res.write(`data: ${JSON.stringify({ event: 'ping' })}\n\n`), 5000);
  req.on('close', () => clearInterval(iv));
});

app.get('/dsk/:apikey/templates', (_req, res) => res.json([]));
app.get('/dsk/:apikey/images', (_req, res) => res.json([]));
app.get('/dsk/:apikey/viewports/public', (_req, res) => res.json([]));

app.listen(PORT, () => console.log(`[screenshot-mock-backend] listening on http://localhost:${PORT}`));
