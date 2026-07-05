#!/usr/bin/env node
import express from 'express';

const app = express();
const PORT = Number(process.env.PORT) || 4000;

// Minimal CORS middleware to avoid extra deps
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ ok: true, uptime: Math.floor(process.uptime()) });
});

app.post('/live', (req, res) => {
  console.log('[mock-backend] /live', { body: req.body });
  res.json({ ok: true, received: true });
});

// Simple SSE events endpoint for client to connect to
app.get('/events', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
  res.flushHeaders?.();
  let counter = 0;
  const iv = setInterval(() => {
    counter += 1;
    res.write(`data: ${JSON.stringify({ event: 'tick', n: counter, ts: Date.now() })}\n\n`);
  }, 2000);
  req.on('close', () => { clearInterval(iv); });
});

app.listen(PORT, () => {
  console.log(`[mock-backend] Listening on http://localhost:${PORT}`);
  console.log('[mock-backend] Endpoints: GET /health  POST /live  GET /events');
});
