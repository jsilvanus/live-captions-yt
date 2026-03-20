import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';

export class DockerFfmpegRunner extends EventEmitter {
  constructor({ image = 'lcyt-ffmpeg:latest', name = 'lcyt-ffmpeg', args = [], env = {}, volumes = [], network, cpus, memory } = {}) {
    super();
    this.image = image;
    this.name = name;
    this.args = args;
    this.env = env;
    this.volumes = volumes; // array of strings like '/host/path:/container/path'
    this.network = network;
    this.cpus = cpus;
    this.memory = memory;
    this.proc = null;
    this.stdout = null;
    this.stderr = null;
  }

  start() {
    if (this.proc) return;
    const runArgs = ['run', '--rm', '--name', this.name];
    if (this.network) { runArgs.push('--network', this.network); }
    if (this.cpus) { runArgs.push('--cpus', String(this.cpus)); }
    if (this.memory) { runArgs.push('--memory', String(this.memory)); }
    for (const v of this.volumes || []) { runArgs.push('-v', v); }
    for (const [k, v] of Object.entries(this.env || {})) { runArgs.push('-e', `${k}=${v}`); }
    runArgs.push(this.image);
    runArgs.push(...this.args);

    const proc = spawn('docker', runArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
    this.proc = proc;
    this.stdout = proc.stdout;
    this.stderr = proc.stderr;

    proc.on('error', err => this.emit('error', err));
    proc.on('close', code => this.emit('close', code));
    return proc;
  }

  async stop() {
    if (!this.proc) return;
    try {
      // Attempt docker stop by container name
      const stop = spawn('docker', ['stop', '--time', '3', this.name]);
      stop.on('error', () => {});
      stop.on('close', () => {});
    } catch (e) {}
  }

  isRunning() {
    return !!(this.proc && !this.proc.killed);
  }
}
