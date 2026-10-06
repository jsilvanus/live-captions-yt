/**
 * AuditorLiveAdapter and the SttManager `auditor` audio source, against a fake
 * auditor service (POST /v1/live, GET /v1/live/:id/events as SSE, DELETE).
 */
import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { AuditorLiveAdapter } from '../src/stt-adapters/auditor-live.js';
import { SttManager } from '../src/stt-manager.js';

function sse(id, event, data) {
  return `id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** A fake service. `script(sessionNumber)` returns the frames to send; the stream then ends unless `hold`. */
async function fakeService({ script, apiKey = '', status = 201, hold = false } = {}) {
  const state = { created: [], deleted: [], eventRequests: [], sessions: 0, auth: [] };
  const open = new Set();
  const server = http.createServer((req, res) => {
    state.auth.push(req.headers.authorization ?? null);
    if (apiKey && req.headers.authorization !== `Bearer ${apiKey}`) {
      res.writeHead(401, { 'content-type': 'application/json' }).end(JSON.stringify({ detail: 'Unauthorized' }));
      return;
    }
    if (req.method === 'POST' && req.url === '/v1/live') {
      let body = '';
      req.on('data', d => { body += d; });
      req.on('end', () => {
        const parsed = JSON.parse(body);
        state.created.push(parsed);
        if (status !== 201) {
          res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify({ detail: 'source host is not allowed' }));
          return;
        }
        state.sessions += 1;
        res.writeHead(202, { 'content-type': 'application/json' }).end(JSON.stringify({ id: `s${state.sessions}` }));
      });
      return;
    }
    const events = req.url.match(/^\/v1\/live\/(s\d+)\/events$/);
    if (req.method === 'GET' && events) {
      state.eventRequests.push({ id: events[1], lastEventId: req.headers['last-event-id'] ?? null });
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      for (const frame of script(Number(events[1].slice(1)))) res.write(frame);
      if (hold) { open.add(res); res.on('close', () => open.delete(res)); } else res.end();
      return;
    }
    const del = req.url.match(/^\/v1\/live\/(s\d+)$/);
    if (req.method === 'DELETE' && del) {
      state.deleted.push(del[1]);
      for (const r of open) r.end();
      res.writeHead(200, { 'content-type': 'application/json' }).end('{}');
      return;
    }
    res.writeHead(404).end();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { url: `http://127.0.0.1:${server.address().port}`, state, close: () => { for (const r of open) r.end(); server.closeAllConnections?.(); return new Promise(r => server.close(r)); } };
}

const transcript = (sequence, text, wall_start = '2026-10-05T09:30:00.250Z') =>
  ({ sequence, text, language: 'fi', start: 1, end: 3, wall_start, wall_end: '2026-10-05T09:30:02.000Z' });

async function waitFor(fn, ms = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return;
    await new Promise(r => setTimeout(r, 10));
  }
  assert.fail('timed out');
}

describe('AuditorLiveAdapter', () => {
  const closers = [];
  afterEach(async () => { while (closers.length) await closers.pop()(); });

  test('starts a session on the templated source and emits transcripts with the wall time', async () => {
    const svc = await fakeService({
      hold: true,
      script: () => [
        sse(1, 'status', { state: 'starting' }),
        sse(2, 'transcript', transcript(1, ' Rauha olkoon ')),
        sse(3, 'transcript', transcript(2, '')),
        sse(4, 'transcript', transcript(3, 'Aamen', '2026-10-05T09:30:05.000Z')),
      ],
    });
    closers.push(svc.close);
    const adapter = new AuditorLiveAdapter({
      baseUrl: svc.url, streamKey: 'my key', sourceUrl: 'rtsp://mediamtx:8554/{streamKey}', language: 'fi-FI', clientRef: 'lcyt:abcd1234',
    });
    const got = [];
    adapter.on('transcript', t => got.push(t));
    await adapter.start();
    await waitFor(() => got.length === 2);
    assert.deepEqual(svc.state.created, [{ source: 'rtsp://mediamtx:8554/my%20key', language: 'fi', client_ref: 'lcyt:abcd1234' }]);
    assert.equal(got[0].text, 'Rauha olkoon');
    assert.equal(got[0].confidence, null);
    assert.equal(got[0].timestamp.toISOString(), '2026-10-05T09:30:00.250Z');
    assert.equal(got[1].sequence, 3);
    await adapter.stop();
    assert.deepEqual(svc.state.deleted, ['s1']);
  });

  test('sends the bearer key; a refusal fails start with the service text', async () => {
    const svc = await fakeService({ apiKey: 'k', hold: true, script: () => [] });
    closers.push(svc.close);
    const ok = new AuditorLiveAdapter({ baseUrl: svc.url, apiKey: 'k', streamKey: 'a' });
    await ok.start();
    assert.ok(svc.state.auth.every(a => a === 'Bearer k'));
    await ok.stop();

    const bad = new AuditorLiveAdapter({ baseUrl: svc.url, apiKey: 'wrong', streamKey: 'a' });
    await assert.rejects(bad.start(), /401/);

    const denied = await fakeService({ status: 403, script: () => [] });
    closers.push(denied.close);
    await assert.rejects(new AuditorLiveAdapter({ baseUrl: denied.url, streamKey: 'a' }).start(), /403.*not allowed/);
    await assert.rejects(new AuditorLiveAdapter({ baseUrl: '', streamKey: 'a' }).start(), /AUDITOR_STT_URL/);
  });

  test('opens a new session when the old one ended and keeps delivering', async () => {
    const svc = await fakeService({
      script: n => n === 1
        ? [sse(1, 'transcript', transcript(1, 'ensimmäinen')), sse(2, 'status', { state: 'ended', reason: 'source_lost' })]
        : [sse(1, 'transcript', transcript(1, 'toinen'))],
      hold: false,
    });
    closers.push(svc.close);
    const adapter = new AuditorLiveAdapter({ baseUrl: svc.url, streamKey: 'a', retryMs: 20, maxRetryMs: 40 });
    const texts = [];
    const errors = [];
    adapter.on('transcript', t => texts.push(t.text));
    adapter.on('error', e => errors.push(e.error.message));
    await adapter.start();
    await waitFor(() => texts.length >= 2);
    assert.deepEqual(texts.slice(0, 2), ['ensimmäinen', 'toinen']);
    assert.equal(svc.state.created.length >= 2, true);
    assert.ok(errors.some(m => /source_lost/.test(m)));
    await adapter.stop();
  });

  test('resumes a dropped connection with Last-Event-ID instead of a new session', async () => {
    let drops = 0;
    const svc = await fakeService({
      script: () => (drops++ === 0 ? [sse(7, 'transcript', transcript(1, 'a'))] : [sse(8, 'transcript', transcript(2, 'b'))]),
    });
    closers.push(svc.close);
    const adapter = new AuditorLiveAdapter({ baseUrl: svc.url, streamKey: 'a', retryMs: 20, maxRetryMs: 40 });
    const texts = [];
    adapter.on('transcript', t => texts.push(t.text));
    await adapter.start();
    await waitFor(() => texts.length >= 2);
    assert.equal(svc.state.created.length, 1);
    assert.equal(svc.state.eventRequests[1].lastEventId, '7');
    await adapter.stop();
  });

  test('stop() returns promptly even while waiting to retry', async () => {
    const svc = await fakeService({ script: () => [], hold: false });
    closers.push(svc.close);
    const adapter = new AuditorLiveAdapter({ baseUrl: svc.url, streamKey: 'a', retryMs: 10_000, maxRetryMs: 10_000 });
    await adapter.start();
    await new Promise(r => setTimeout(r, 100));
    const started = Date.now();
    await adapter.stop();
    assert.ok(Date.now() - started < 1000);
  });
});

describe('SttManager provider=auditor', () => {
  const closers = [];
  afterEach(async () => { while (closers.length) await closers.pop()(); });

  test('delivers pulled transcripts to the caption session, with no ffmpeg or HLS fetcher', async () => {
    const svc = await fakeService({ hold: true, script: () => [sse(1, 'transcript', transcript(1, 'Herra armahda'))] });
    closers.push(svc.close);
    const sent = [];
    const session = { apiKey: 'mykeyabcd', sequence: 0, _sendQueue: Promise.resolve(), sender: { sequence: 0, send: async (text, ts) => { sent.push({ text, ts }); } } };
    const settings = { get: key => ({ 'stt.auditor_url': svc.url, 'stt.auditor_source_url': 'rtsp://mediamtx:8554/{streamKey}' })[key] };
    const mgr = new SttManager({ values: () => [session][Symbol.iterator]() }, null, settings);
    closers.push(() => mgr.stopAll());
    const transcripts = [];
    mgr.on('transcript', t => transcripts.push(t));

    await mgr.start('mykeyabcd', { provider: 'auditor', language: 'fi-FI', streamKey: 'sermon' });
    await waitFor(() => sent.length === 1);
    assert.equal(sent[0].text, 'Herra armahda');
    assert.equal(sent[0].ts.toISOString(), '2026-10-05T09:30:00.250Z');
    assert.equal(transcripts[0].provider, 'auditor');
    assert.equal(svc.state.created[0].source, 'rtsp://mediamtx:8554/sermon');
    const status = mgr.getStatus('mykeyabcd');
    assert.equal(status.provider, 'auditor');
    assert.equal(status.audioSource, 'none'); // no audio passes through LCYT
    assert.equal(status.mode, 'auditor-live');

    await mgr.stop('mykeyabcd');
    assert.deepEqual(svc.state.deleted, ['s1']);
    assert.equal(mgr.isRunning('mykeyabcd'), false);
  });

  test('start() fails and leaves no session when the service refuses', async () => {
    const svc = await fakeService({ status: 403, script: () => [] });
    closers.push(svc.close);
    const mgr = new SttManager({ values: () => [][Symbol.iterator]() }, null, { get: key => (key === 'stt.auditor_url' ? svc.url : undefined) });
    await assert.rejects(mgr.start('k', { provider: 'auditor', streamKey: 'x' }), /403/);
    assert.equal(mgr.isRunning('k'), false);
  });
});
