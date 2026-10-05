import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { randomUUID } from 'node:crypto';

/**
 * Runner backed by an fffleet fleet (https://github.com/jsilvanus/fffleet): a worker, an
 * orchestrator, or, without a URL or when the fleet cannot be reached, a job on this machine.
 *
 * fffleet is imported on first use, so importing this package stays cheap and
 * tests that mock `node:child_process` are not affected.
 *
 * It keeps the runner interface of the local and docker runners:
 * `start()` resolves to the runner itself, `stop(timeoutMs)`, `'error'` and `'close'` events.
 * Unlike the old worker runner it reports the end of a job that finishes by itself:
 * `'close'` fires with the job's exit code whatever the reason (exit, cancel, lost worker).
 *
 * ffmpeg's stdin, when requested with `stdin: 'pipe'`, is exposed as a Writable (`runner.stdin`)
 * whose writes go to the job through the fleet API, so callers that write SRT cues to
 * `proc.stdin` work the same on a remote worker.
 */

const STDIN_CHUNK = 512 * 1024;

let sharedFleet = null;
let sharedKey = null;

function fleetOptionsFromEnv(env = process.env) {
  return {
    url: env.FFFLEET_URL || env.COMPUTE_URL || undefined,
    token: env.FFFLEET_TOKEN || env.COMPUTE_TOKEN || undefined,
    clientId: env.FFFLEET_CLIENT_ID || undefined,
    clientSecret: env.FFFLEET_CLIENT_SECRET || undefined,
    fallback: (env.FFFLEET_FALLBACK || env.ORCHESTRATOR_FALLBACK || 'local') === 'none' ? 'none' : 'local',
  };
}

/** One fleet client per process and configuration. */
export async function getFleet(env = process.env) {
  const { createFleet } = await import('fffleet');
  const opts = fleetOptionsFromEnv(env);
  const key = JSON.stringify(opts);
  if (!sharedFleet || sharedKey !== key) {
    sharedFleet?.close().catch(() => {});
    // Without a URL jobs run on this machine; perception jobs are the one non-ffmpeg type they need.
    const { runPerception } = await import('../perception/fffleet-executor.js');
    sharedFleet = createFleet({ ...opts, local: { executors: { perception: runPerception } } });
    sharedKey = key;
  }
  return sharedFleet;
}

export async function closeFleet() {
  const fleet = sharedFleet;
  sharedFleet = null;
  sharedKey = null;
  if (fleet) await fleet.close();
}

export class FleetFfmpegRunner extends EventEmitter {
  constructor({ fleet = null, args = [], name = 'ffmpeg', stdin = 'ignore', stdout = 'ignore', apiKey = '', purpose = 'unknown', timeoutMs = null, requires = [], ...rest } = {}) {
    super();
    this._fleet = fleet;
    this.args = args;
    this.name = name;
    this._stdinMode = stdin;
    this._stdoutMode = stdout;
    this.owner = apiKey || purpose;
    this.purpose = purpose;
    this.timeoutMs = timeoutMs;
    this.requires = requires;
    this.extra = rest;
    this.jobId = null;
    this.job = null;
    this.where = null;
    this.stdin = null;
    this.stdout = null;
    this.stderr = null;
    /** Why the job failed (fleet error code and message, ffmpeg's stderr tail, worker), or null. Set when it closes. */
    this.failure = null;
    this._closed = false;
  }

  async start() {
    if (this.job) return this;
    const fleet = this._fleet || await getFleet();
    const wantsStdin = this._stdinMode === 'pipe';
    const spec = {
      id: `${this.purpose}-${randomUUID()}`.slice(0, 63),
      kind: 'stream',
      owner: this.owner || undefined,
      labels: { purpose: this.purpose, name: this.name },
      requires: this.requires,
      timeoutMs: this.timeoutMs,
      stdin: wantsStdin,
      ...(this._stdoutMode === 'pipe' ? { stdout: true } : {}),
      ffmpeg: { args: this.args },
    };
    let job;
    try {
      job = await fleet.submit(spec);
    } catch (err) {
      try { this.emit('error', err); } catch {}
      throw err;
    }
    this.job = job;
    this.jobId = job.id;
    this.where = job.where;

    if (this._stdoutMode === 'pipe') {
      // Raw ffmpeg stdout (PCM, ...) from the fleet, as a plain Readable like a child process's.
      this.stdout = new PassThrough();
      job.stdout().then(
        (stream) => { stream.on('error', (err) => this.stdout?.destroy(err)); stream.pipe(this.stdout); },
        (err) => this.stdout?.destroy(err),
      );
    }

    if (wantsStdin) {
      this.stdin = new Writable({
        write: (chunk, _enc, cb) => {
          this._write(chunk).then(() => cb(), cb);
        },
        final: (cb) => cb(),
      });
      this.stdin.on('error', () => {});
    }

    job.done.then((snap) => this._finish(snap), (err) => {
      try { this.emit('error', err); } catch {}
      this._finish(null);
    });
    return this;
  }

  _finish(snap) {
    if (this._closed) return;
    this._closed = true;
    this.stdin?.destroy();
    this.stdin = null;
    const state = snap?.state ?? this.job?.state;
    const code = snap?.exitCode ?? (state === 'succeeded' ? 0 : state === 'cancelled' ? null : 1);
    this.finalSnapshot = snap;
    this.failure = failureOf(snap ?? this.job?.snapshot?.(), code);
    this.emit('close', { code, signal: state === 'cancelled' ? 'SIGTERM' : null, ...(this.failure && { failure: this.failure }) });
  }

  async stop(timeoutMs = 3000) {
    if (!this.job || this._closed) return { timedOut: false, code: null, signal: null };
    const closed = new Promise((resolve) => this.once('close', resolve));
    this.job.cancel().catch(() => {});
    let timer;
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => resolve(null), timeoutMs);
      timer.unref?.();
    });
    const info = await Promise.race([closed, timeout]);
    clearTimeout(timer);
    if (!info) return { timedOut: true, code: null, signal: 'SIGKILL' };
    return { timedOut: false, code: info.code ?? null, signal: info.signal ?? null };
  }

  /** SRT cue or `{ text, startMs, durationMs, cue }` written to ffmpeg's stdin (the worker runner's caption call). */
  async writeCaption(caption = {}) {
    if (!this.job || this._closed) throw new Error('no active job');
    const cue = typeof caption.cue === 'string' ? caption.cue : this._cue(caption);
    await this._write(cue);
    return { ok: true };
  }

  /** Writes to ffmpeg's stdin, waiting for a queued or staging job to start first. */
  async _write(data) {
    const job = this.job;
    if (!job) throw new Error('no active job');
    await this._running();
    // The fleet API takes bodies of at most 1 MB.
    const buf = typeof data === 'string' ? Buffer.from(data) : data;
    let bytes = 0;
    for (let i = 0; i < Math.max(buf.length, 1); i += STDIN_CHUNK) {
      await job.write(buf.subarray(i, i + STDIN_CHUNK));
      bytes += Math.min(STDIN_CHUNK, buf.length - i);
    }
    return { bytes };
  }

  _running(timeoutMs = 30_000) {
    const job = this.job;
    const ready = () => ['running', 'uploading'].includes(job.state);
    if (ready()) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { cleanup(); reject(new Error(`job ${job.id} did not start within ${timeoutMs} ms`)); }, timeoutMs);
      timer.unref?.();
      const onState = () => {
        if (ready()) { cleanup(); resolve(); }
        else if (this._closed) { cleanup(); reject(new Error('job ended')); }
      };
      const cleanup = () => { clearTimeout(timer); job.off('state', onState); this.off('close', onState); };
      job.on('state', onState);
      this.on('close', onState);
    });
  }

  _cue(caption) {
    const seq = (this._seq = (this._seq || 0) + 1);
    const startMs = typeof caption.startMs === 'number' ? caption.startMs : 0;
    const durationMs = typeof caption.durationMs === 'number' ? caption.durationMs : 4000;
    return `${seq}\n${srtTime(startMs)} --> ${srtTime(startMs + durationMs)}\n${String(caption.text || '')}\n\n`;
  }

  isRunning() {
    return !!this.job && !this._closed;
  }
}

/**
 * The reason a fleet job did not succeed, from its final snapshot: the fleet's error code and
 * message (e.g. WORKER_LOST, FFMPEG_EXIT, a requirement no worker met), the tail of ffmpeg's
 * stderr when the worker returned one, and the worker that ran it. Null for a clean exit or a
 * cancelled job.
 * @param {object|null|undefined} snap
 * @param {number|null} code
 * @returns {{ state: string, code: string|null, message: string, stderrTail: string|null, workerId: string|null }|null}
 */
export function failureOf(snap, code) {
  const state = snap?.state;
  if (!snap || state === 'cancelled' || (state === 'succeeded' && !snap.error)) return null;
  if (!snap.error && !(code > 0) && state !== 'failed') return null;
  const err = snap.error || {};
  return {
    state: state ?? 'failed',
    code: err.code ?? null,
    message: err.message || (code > 0 ? `ffmpeg exited with code ${code}` : 'job failed'),
    stderrTail: snap.stderrTail ?? null,
    workerId: snap.workerId ?? null,
  };
}

function srtTime(ms) {
  if (!Number.isFinite(ms)) return '00:00:00,000';
  const t = Math.max(0, Math.round(ms));
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(Math.floor(t / 3_600_000))}:${p(Math.floor((t % 3_600_000) / 60_000))}:${p(Math.floor((t % 60_000) / 1000))},${p(t % 1000, 3)}`;
}
