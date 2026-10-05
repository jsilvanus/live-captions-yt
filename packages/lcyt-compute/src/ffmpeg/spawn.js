import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { FleetFfmpegRunner } from './fleet-runner.js';

/**
 * `spawn('ffmpeg', args, { stdio })` that can run on an fffleet fleet instead of this machine.
 *
 * For callers that read ffmpeg's stdout or write its stdin themselves (STT and music analysis
 * read raw PCM, the DSK renderer writes PNG frames). With the fleet runner the returned object
 * is a ChildProcess look-alike: `stdin`, `stdout`, `stderr` streams that exist at once (stdout and
 * stdin are connected to the job when it starts), `kill()`, and `error`, `exit` and `close` events
 * with the child-process signatures. Anything else comes back from `spawn` untouched.
 *
 * Remote workers cannot see this machine: inputs and outputs in `args` (RTMP urls, ...) must be
 * reachable from them. stderr is not streamed over the fleet; when a job fails, the tail the fleet
 * returned is written to it just before it ends, and the reason is on `failure` (see `failureOf`).
 *
 * @param {string[]} args
 * @param {{ purpose?: string, apiKey?: string, stdio?: any[], runner?: string, cmd?: string, env?: object }} [opts]
 */
export function spawnFfmpeg(args, { purpose = 'unknown', apiKey = '', stdio = ['pipe', 'pipe', 'pipe'], runner, cmd = 'ffmpeg', env } = {}) {
  runner = runner || process.env.FFMPEG_RUNNER || 'spawn';
  if (runner !== 'fleet') return spawn(cmd, args, env ? { stdio, env } : { stdio });
  return new FleetProcess(args, { purpose, apiKey, stdio });
}

class FleetProcess extends EventEmitter {
  constructor(args, { purpose, apiKey, stdio }) {
    super();
    this.pid = undefined;
    this.killed = false;
    this.exitCode = null;
    this.signalCode = null;
    this.failure = null;
    this.stderrTail = null; // live: newest stderr lines of the running job, see 'stderrTail'
    const wantsStdin = stdio[0] === 'pipe';
    const wantsStdout = stdio[1] === 'pipe';
    this.stdout = wantsStdout ? new PassThrough() : null;
    this.stderr = stdio[2] === 'pipe' ? new PassThrough() : null;
    this.stdin = null;
    let markStarted;
    const started = new Promise((resolve) => { markStarted = resolve; });

    const runner = new FleetFfmpegRunner({ args, purpose, apiKey, stdin: wantsStdin ? 'pipe' : 'ignore', stdout: wantsStdout ? 'pipe' : 'ignore' });
    this._runner = runner;
    if (wantsStdin) {
      this.stdin = new Writable({
        write: (chunk, _enc, cb) => started.then(() => runner._write(chunk)).then(() => cb(), cb),
        // stdin.end(): ffmpeg gets EOF once everything written has arrived.
        final: (cb) => {
          started.then(() => runner._running()).then(() => runner.job.endStdin()).then(() => cb(), () => cb());
        },
      });
      this.stdin.on('error', () => {});
    }

    let ended = false;
    const finish = (code, signal) => {
      if (ended) return;
      ended = true;
      this.exitCode = code ?? null;
      this.signalCode = signal ?? null;
      this.failure = runner.failure;
      if (this.failure) this.stderr?.write(`${this.failure.code ? `[${this.failure.code}] ` : ''}${this.failure.message}${this.failure.stderrTail ? `\n${this.failure.stderrTail}` : ''}\n`);
      this.stderr?.end();
      this.emit('exit', this.exitCode, this.signalCode);
      // Close once the last output bytes have been handed over.
      const out = runner.stdout;
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        this.stdout?.end();
        this.emit('close', this.exitCode, this.signalCode);
      };
      if (!out || out.readableEnded || out.destroyed) return close();
      const t = setTimeout(close, 2000);
      t.unref?.();
      out.once('end', () => { clearTimeout(t); close(); });
    };
    runner.on('stderrTail', (tail) => { this.stderrTail = tail; this.emit('stderrTail', tail); });
    runner.on('close', (info) => finish(info?.code ?? null, info?.signal ?? null));
    runner.on('error', (err) => {
      // Like spawn: an unstarted job reports 'error'; an unlistened one must not throw.
      if (this.listenerCount('error')) this.emit('error', err);
      finish(1, null);
    });

    runner.start().then(() => {
      markStarted();
      if (runner.stdout && this.stdout) {
        runner.stdout.on('error', (err) => this.stdout.destroy(err));
        runner.stdout.pipe(this.stdout);
      }
    }, () => { /* reported through the runner's 'error' event */ markStarted(); });
  }

  kill() {
    this.killed = true;
    this._runner.stop(3000).catch(() => {});
    return true;
  }
}
