import path from 'node:path';
import * as fs from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import logger from 'lcyt/logger';

export class HlsManager {
  constructor({ hlsRoot = '/tmp/hls', localRtmp = null, rtmpApp = 'live', mediamtxClient = null } = {}) {
    this._hlsRoot = hlsRoot;
    this._local = localRtmp;
    this._app = rtmpApp;
    this._mediamtx = mediamtxClient;
    this._procs = new Map();
  }

  hlsDir(hlsKey) {
    return path.join(this._hlsRoot, hlsKey);
  }

  isRunning(hlsKey) {
    return this._procs.has(hlsKey);
  }

  async start(hlsKey) {
    const tag = `[hls:${String(hlsKey).slice(0,8)}]`;

    // If already running, stop first
    if (this._procs.has(hlsKey)) {
      await this.stop(hlsKey);
    }

    // Ensure output directory exists
    const dir = this.hlsDir(hlsKey);
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (err) {
      logger.warn(`${tag} mkdir warning: ${err?.message || err}`);
    }

    // If a MediaMTX client is provided, try to register the path (non-fatal)
    if (this._mediamtx) {
      try {
        await this._mediamtx.addPath(hlsKey, { source: 'publisher' });
        logger.info(`${tag} MediaMTX path registered`);
      } catch (err) {
        logger.warn(`${tag} MediaMTX addPath warning: ${err?.message || err}`);
      }
    }

    // Spawn ffmpeg only when a local RTMP base and app are configured
    if (this._local) {
      const input = `${this._local.replace(/\/$/, '')}/${this._app}/${hlsKey}`;
      const out = path.join(dir, 'index.m3u8');
      const args = ['-y', '-i', input, '-c', 'copy', '-f', 'hls', out];

      let proc;
      try {
        proc = spawn('ffmpeg', args, { stdio: 'pipe' });
      } catch (err) {
        logger.error(`${tag} spawn ffmpeg failed: ${err?.message || err}`);
        throw err;
      }

      // Track process and lifecycle
      this._procs.set(hlsKey, proc);

      proc.once('error', (err) => {
        this._procs.delete(hlsKey);
        logger.warn(`${tag} ffmpeg error: ${err?.message || err}`);
      });

      proc.once('close', (code) => {
        this._procs.delete(hlsKey);
        logger.info(`${tag} ffmpeg exited code=${code}`);
      });

      // Resolve after a tick so tests can simulate nextTick error ordering
      return await new Promise((resolve, reject) => {
        let settled = false;
        proc.once('error', (err) => {
          if (!settled) { settled = true; this._procs.delete(hlsKey); reject(err); }
        });
        proc.once('close', () => {
          if (!settled) { settled = true; this._procs.delete(hlsKey); resolve(); }
        });
        setImmediate(() => { if (!settled) { settled = true; resolve(); } });
      });
    }

    // No ffmpeg spawned — still mark active (directory created)
    logger.info(`${tag} HLS active (no-local-rtmp)`);
    return;
  }

  async stop(hlsKey) {
    if (!this._procs.has(hlsKey)) return;
    const tag = `[hls:${String(hlsKey).slice(0,8)}]`;
    const proc = this._procs.get(hlsKey);
    try {
      proc.kill('SIGTERM');
    } catch (err) {
      logger.warn(`${tag} kill warning: ${err?.message || err}`);
    }
    this._procs.delete(hlsKey);

    const dir = this.hlsDir(hlsKey);
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (err) {
      logger.warn(`${tag} rm warning: ${err?.message || err}`);
    }

    logger.info(`${tag} HLS stopped`);
  }

  async stopAll() {
    await Promise.all([...this._procs.keys()].map(k => this.stop(k)));
  }

  // Backwards-compatible helper used by stream-hls route
  getInternalHlsUrl(hlsKey) {
    const base = (process.env.MEDIAMTX_HLS_BASE_URL || 'http://127.0.0.1:8080').replace(/\/$/, '');
    return `${base}/${encodeURIComponent(hlsKey)}`;
  }
}
