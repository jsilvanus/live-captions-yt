import * as child from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
const { mkdtempSync, writeFileSync, rmSync } = fs;
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export class DockerFfmpegRunner extends EventEmitter {
  constructor({ image = 'lcyt-ffmpeg:latest', name = null, args = [], env = {}, volumes = [], network, cpus, memory, entrypoint = null, pipeStdin = false, childProc = child } = {}) {
    super();
    this.image = image;
    this.name = name ?? `lcyt-ffmpeg-${Date.now().toString(36)}`;
    this.args = args;
    this.env = env;
    this.volumes = volumes; // array of strings like '/host/path:/container/path'
    this.network = network;
    this.cpus = cpus;
    this.memory = memory;
    this.entrypoint = entrypoint; // optional override for docker --entrypoint
    this.proc = null;
    this.stdout = null;
    this.stderr = null;
    this._pipeStdin = !!pipeStdin;
    this._child = childProc;
  }

  _imageExists() {
    try {
      const r = this._child.spawnSync('docker', ['image', 'inspect', this.image], { encoding: 'utf8', timeout: 5000 });
      return r.status === 0;
    } catch (e) {
      return false;
    }
  }

  _buildImage() {
    // Build a tiny image that exposes ffmpeg by using a prebuilt ffmpeg base image.
    const tmp = mkdtempSync(join(tmpdir(), 'lcyt-ffmpeg-'));
    const dockerfile = `FROM jrottenberg/ffmpeg:4.4-alpine
ENTRYPOINT ["ffmpeg"]\n`;
    writeFileSync(join(tmp, 'Dockerfile'), dockerfile, 'utf8');
    try {
      const buildTimeout = Number(process.env.DOCKER_BUILD_TIMEOUT_MS) || 120000;
      const r = this._child.spawnSync('docker', ['build', '-t', this.image, tmp], { encoding: 'utf8', timeout: buildTimeout });
      if (r.status !== 0) {
        console.error('[docker-runner] docker build failed:', r.stderr || r.stdout || r.status);
      }
      return r.status === 0;
    } catch (e) {
      console.error('[docker-runner] docker build error:', e.message);
      return false;
    } finally {
      try { rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
    }
  }

  async start() {
    if (this.proc) return this;

    // If image is missing, optionally build it when TEST_DOCKER=1
    if (!this._imageExists() && process.env.TEST_DOCKER === '1') {
      try {
        console.log(`[docker-runner] Image ${this.image} not found — building for TEST_DOCKER=1`);
        this._buildImage();
      } catch (e) {
        // continue and allow docker run to fail with a clear error
      }
    }

    const runArgs = ['run', '--rm', '-i', '--name', this.name];
    if (this.network) { runArgs.push('--network', this.network); }
    if (this.cpus) { runArgs.push('--cpus', String(this.cpus)); }
    if (this.memory) { runArgs.push('--memory', String(this.memory)); }
    for (const v of this.volumes || []) { runArgs.push('-v', v); }
    for (const [k, v] of Object.entries(this.env || {})) { runArgs.push('-e', `${k}=${v}`); }

    if (this.entrypoint) {
      runArgs.push('--entrypoint', this.entrypoint);
    }

    runArgs.push(this.image);
    // append ffmpeg args directly (do not insert a literal '--' which becomes an argv passed to ffmpeg)
    runArgs.push(...this.args);

    // spawn docker with stdio pipes so we can pass through stdin/stdout/stderr
    const stdio = this._pipeStdin ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'];
    const proc = this._child.spawn('docker', runArgs, { stdio });
    this.proc = proc;
    this.stdout = proc.stdout;
    this.stderr = proc.stderr;

    // Forward host stdin only if explicitly requested
    if (this._pipeStdin) {
      try {
        if (process.stdin && !process.stdin.destroyed) {
          process.stdin.pipe(proc.stdin);
        } else {
          proc.stdin.end();
        }
      } catch (e) {
        // ignore pipe errors
      }
    } else {
      // ensure container stdin is closed to avoid accidental readers
      try { if (proc.stdin) proc.stdin.end(); } catch (e) {}
    }

    proc.on('error', err => this.emit('error', err));
    proc.on('close', (code, signal) => {
      this.proc = null;
      this.stdout = null;
      this.stderr = null;
      this.emit('close', { code: code ?? null, signal: signal ?? null });
    });

    return this;
  }

  async stop(timeoutMs = 3000) {
    if (!this.proc) return { timedOut: false, code: null, signal: null };
    const proc = this.proc;
    return await new Promise(resolve => {
      let settled = false;
      const onClose = (info) => {
        if (settled) return;
        settled = true;
        resolve({ timedOut: false, code: info && info.code !== undefined ? info.code : null, signal: info && info.signal ? info.signal : null });
      };
      this.once('close', onClose);

      try {
          const stop = this._child.spawn('docker', ['stop', '--time', String(Math.ceil(timeoutMs / 1000)), this.name]);
        stop.on('error', () => {});
        stop.on('close', () => {});
      } catch (e) {
        // best-effort
      }

      const t = setTimeout(() => {
        if (settled) return;
        try { proc.kill('SIGKILL'); } catch (e) {}
        settled = true;
        resolve({ timedOut: true, code: null, signal: 'SIGKILL' });
      }, timeoutMs + 500);
      if (t.unref) t.unref();
    });
  }

  isRunning() {
    // container process tracked by this.proc
    return !!(this.proc && !this.proc.killed);
  }
}
