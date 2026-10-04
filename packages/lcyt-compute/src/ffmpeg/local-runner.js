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

  async start() {
    if (this.proc) return this;
    const stdio = [this._stdinMode, 'pipe', 'pipe'];
    const proc = spawn(this.cmd, this.args, { stdio, env: this.env });
    this.proc = proc;
    this.stdout = proc.stdout;
    this.stderr = proc.stderr;

    proc.on('error', err => this.emit('error', err));
    proc.on('close', (code, signal) => {
      // clear references to avoid leaking streams
      this._stopping = false;
      this.proc = null;
      this.stdout = null;
      this.stderr = null;
      this.emit('close', { code: code ?? null, signal: signal ?? null });
    });

    return this;
  }

  async stop(timeoutMs = 3000) {
    if (!this.proc) return { timedOut: false, code: null, signal: null };
    if (this._stopping) return { timedOut: false, code: null, signal: null };
    this._stopping = true;

    const proc = this.proc;
    return await new Promise(resolve => {
      let settled = false;
      const onClose = (info) => {
        if (settled) return;
        settled = true;
        cleanup();
        const ret = { code: info && info.code !== undefined ? info.code : null, signal: info && info.signal ? info.signal : null, timedOut: false };
        resolve(ret);
      };

      const cleanup = () => {
        try { proc.removeAllListeners('close'); } catch (e) {}
        try { proc.removeAllListeners('error'); } catch (e) {}
      };

      proc.once('close', onClose);

      try {
        if (proc.stdin && !proc.stdin.destroyed) {
          try { proc.stdin.end(); } catch (e) {}
        }
        proc.kill('SIGTERM');
      } catch (e) {}

      const t = setTimeout(() => {
        if (settled) return;
        try { proc.kill('SIGKILL'); } catch (e) {}
        settled = true;
        cleanup();
        resolve({ timedOut: true, code: null, signal: 'SIGKILL' });
      }, timeoutMs);
      if (t.unref) t.unref();
    });
  }

  isRunning() {
    return !!(this.proc && !this.proc.killed);
  }
}
