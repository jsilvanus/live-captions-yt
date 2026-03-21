import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';

export class LocalFfmpegRunner extends EventEmitter {
  constructor({ cmd = 'ffmpeg', args = [], env = process.env, name = 'ffmpeg', stdin = 'pipe' } = {}) {
    super();
    this.cmd = cmd;
    this.args = args;
    this.env = env;
    this.name = name;
    this.proc = null;
    this.stdout = null;
    this.stderr = null;
    this._stopping = false;
    this._stdinMode = stdin;
  }

  start() {
    if (this.proc) return this.proc;
    const stdio = [this._stdinMode, 'pipe', 'pipe'];
    const proc = spawn(this.cmd, this.args, { stdio, env: this.env });
    this.proc = proc;
    this.stdout = proc.stdout;
    this.stderr = proc.stderr;

    proc.on('error', err => this.emit('error', err));
    proc.on('close', code => {
      // clear references to avoid leaking streams
      this._stopping = false;
      this.proc = null;
      this.stdout = null;
      this.stderr = null;
      this.emit('close', code);
    });

    return proc;
  }

  stop(timeoutMs = 3000) {
    if (!this.proc) return Promise.resolve();
    if (this._stopping) return Promise.resolve();
    this._stopping = true;

    return new Promise(resolve => {
      const proc = this.proc;
      const onClose = (code) => {
        cleanup();
        resolve(code);
      };

      const cleanup = () => {
        try { proc.removeListener('close', onClose); } catch (e) {}
        try { proc.removeAllListeners('error'); } catch (e) {}
      };

      proc.once('close', onClose);

      try {
        // attempt graceful shutdown
        if (proc.stdin && !proc.stdin.destroyed) {
          try { proc.stdin.end(); } catch (e) {}
        }
        proc.kill('SIGTERM');
      } catch (e) {}

      const t = setTimeout(() => {
        try { proc.kill('SIGKILL'); } catch (e) {}
      }, timeoutMs);
      if (t.unref) t.unref();
    });
  }

  isRunning() {
    return !!(this.proc && !this.proc.killed);
  }
}
