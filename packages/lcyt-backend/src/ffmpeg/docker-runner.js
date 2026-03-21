import { spawn, spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
const { mkdtempSync, writeFileSync, rmSync } = fs;
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export class DockerFfmpegRunner extends EventEmitter {
  constructor({ image = 'lcyt-ffmpeg:latest', name = null, args = [], env = {}, volumes = [], network, cpus, memory, entrypoint = null } = {}) {
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
  }

  _imageExists() {
    try {
      const r = spawnSync('docker', ['image', 'inspect', this.image], { encoding: 'utf8', timeout: 5000 });
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
      const r = spawnSync('docker', ['build', '-t', this.image, tmp], { stdio: 'inherit', timeout: 0 });
      return r.status === 0;
    } catch (e) {
      return false;
    } finally {
      try { rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
    }
  }

  start() {
    if (this.proc) return this.proc;

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
    // Use '--' to separate docker args from ffmpeg args and preserve args with leading dashes
    runArgs.push('--');
    runArgs.push(...this.args);

    // spawn docker with stdio pipes so we can pass through stdin/stdout/stderr
    const proc = spawn('docker', runArgs, { stdio: ['pipe', 'pipe', 'pipe'] });
    this.proc = proc;
    this.stdout = proc.stdout;
    this.stderr = proc.stderr;

    // Forward host stdin to container stdin when available
    try {
      if (process.stdin && !process.stdin.destroyed) {
        process.stdin.pipe(proc.stdin);
      } else {
        proc.stdin.end();
      }
    } catch (e) {
      // ignore pipe errors
    }

    proc.on('error', err => this.emit('error', err));
    proc.on('close', code => {
      this.proc = null;
      this.stdout = null;
      this.stderr = null;
      this.emit('close', code);
    });

    return proc;
  }

  stop(timeoutMs = 3000) {
    if (!this.proc) return Promise.resolve();

    return new Promise(resolve => {
      const name = this.name;
      const onClose = (code) => resolve(code);
      this.once('close', onClose);

      try {
        const stop = spawn('docker', ['stop', '--time', String(Math.ceil(timeoutMs / 1000)), name]);
        stop.on('error', () => {});
        stop.on('close', () => {});
      } catch (e) {
        // best-effort
      }
    });
  }

  isRunning() {
    // container process tracked by this.proc
    return !!(this.proc && !this.proc.killed);
  }
}
