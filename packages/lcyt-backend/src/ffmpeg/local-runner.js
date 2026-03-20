import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';

export class LocalFfmpegRunner extends EventEmitter {
  constructor({ cmd = 'ffmpeg', args = [], env = process.env, name = 'ffmpeg' } = {}) {
    super();
    this.cmd = cmd;
    this.args = args;
    this.env = env;
    this.name = name;
    this.proc = null;
    this.stdout = null;
    this.stderr = null;
  }

  start() {
    if (this.proc) return;
    const proc = spawn(this.cmd, this.args, { stdio: ['ignore', 'pipe', 'pipe'], env: this.env });
    this.proc = proc;
    this.stdout = proc.stdout;
    this.stderr = proc.stderr;

    proc.on('error', err => this.emit('error', err));
    proc.on('close', code => this.emit('close', code));
    return proc;
  }

  stop() {
    if (!this.proc) return;
    try {
      this.proc.kill('SIGTERM');
      const t = setTimeout(() => {
        try { this.proc.kill('SIGKILL'); } catch (e) {}
      }, 3000);
      if (t.unref) t.unref();
    } catch (e) {}
  }

  isRunning() {
    return !!(this.proc && !this.proc.killed);
  }
}
