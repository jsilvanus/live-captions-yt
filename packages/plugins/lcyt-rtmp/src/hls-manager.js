import path from 'node:path';
import * as fs from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import logger from 'lcyt/logger';
import { reportFfmpegRun } from 'lcyt-backend/ffmpeg';

export class HlsManager {
  constructor({ hlsRoot = '/tmp/hls', localRtmp = null, rtmpApp = 'live', mediamtxClient = null, resolveStorage = null } = {}) {
    this._hlsRoot = hlsRoot;
    this._local = localRtmp;
    this._app = rtmpApp;
    this._mediamtx = mediamtxClient;
    this._resolveStorage = resolveStorage;
    this._procs = new Map();
    this._watchers = new Map();
    /** Keys started in MediaMTX / no-local-rtmp mode (no local ffmpeg process). */
    this._active = new Set();
    /** Per-hlsKey debounce timers for index.m3u8 publish. */
    this._publishDebounce = new Map();
  }

  hlsDir(hlsKey) {
    return path.join(this._hlsRoot, hlsKey);
  }

  isRunning(hlsKey) {
    return this._procs.has(hlsKey) || this._active.has(hlsKey);
  }

  async start(hlsKey) {
    const tag = `[hls:${String(hlsKey).slice(0,8)}]`;

    // If already running, stop first
    if (this.isRunning(hlsKey)) {
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

      // Start polling directory for HLS files to publish to storage (if resolveStorage available).
      if (this._resolveStorage) {
        this._startStorageWatcher(hlsKey, dir, tag);
      }

      // ffmpeg compute accounting (plan_metering_audit §4.1) — manual timing,
      // same sink the runner factory feeds.
      {
        const ffmpegStartedAt = Date.now();
        let accounted = false;
        const account = () => {
          if (accounted) return;
          accounted = true;
          reportFfmpegRun({ purpose: 'hls', apiKey: hlsKey, seconds: (Date.now() - ffmpegStartedAt) / 1000 });
        };
        proc.once('close', account);
        proc.once('error', account);
      }

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

    // No ffmpeg spawned — MediaMTX serves the HLS; track for isRunning()
    this._active.add(hlsKey);
    logger.info(`${tag} HLS active (no-local-rtmp)`);
    return;
  }

  async stop(hlsKey) {
    const tag = `[hls:${String(hlsKey).slice(0,8)}]`;

    // Clean up watcher and debounce timer regardless of whether running
    const watcher = this._watchers.get(hlsKey);
    if (watcher) {
      try {
        watcher.close();
      } catch (err) {
        logger.warn(`${tag} watcher close warning: ${err?.message || err}`);
      }
      this._watchers.delete(hlsKey);
    }

    const debounceTimer = this._publishDebounce.get(hlsKey);
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      this._publishDebounce.delete(hlsKey);
    }

    // Only proceed with process/active cleanup if actually running
    if (!this._procs.has(hlsKey) && !this._active.has(hlsKey)) return;

    this._active.delete(hlsKey);
    const proc = this._procs.get(hlsKey);
    if (proc) {
      try {
        proc.kill('SIGTERM');
      } catch (err) {
        logger.warn(`${tag} kill warning: ${err?.message || err}`);
      }
      this._procs.delete(hlsKey);
    }

    const dir = this.hlsDir(hlsKey);
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (err) {
      logger.warn(`${tag} rm warning: ${err?.message || err}`);
    }

    logger.info(`${tag} HLS stopped`);
  }

  async stopAll() {
    const keys = new Set([...this._procs.keys(), ...this._active]);
    await Promise.all([...keys].map(k => this.stop(k)));
  }

  /**
   * Start polling a directory for new/changed HLS files and publish them to storage.
   * Uses a short-interval polling loop (no extra fs.watch deps).
   * @private
   * @param {string} hlsKey
   * @param {string} dir - absolute directory path
   * @param {string} tag - logger tag
   */
  _startStorageWatcher(hlsKey, dir, tag) {
    const seenFiles = new Set();
    const pollInterval = 500; // ms
    let active = true;

    const poll = async () => {
      if (!active) return;
      try {
        const files = fs.readdirSync(dir);
        for (const file of files) {
          if (!seenFiles.has(file)) {
            seenFiles.add(file);
            const filePath = path.join(dir, file);
            const contentType = file.endsWith('.m3u8') ? 'application/x-mpegURL' : 'video/MP2T';
            await this._publishToStorage(hlsKey, file, filePath, contentType);
          } else if (file === 'index.m3u8') {
            // Debounce index.m3u8 re-publishes (it's rewritten frequently)
            this._debouncedPublishPlaylist(hlsKey, filePath, tag);
          }
        }
      } catch (err) {
        if (active) logger.debug(`${tag} watcher poll error: ${err?.message || err}`);
      }
      if (active) setTimeout(poll, pollInterval);
    };

    // Start the polling loop
    setTimeout(poll, pollInterval);

    // Store cleanup callback for stop()
    this._watchers.set(hlsKey, {
      close() {
        active = false;
      },
    });
  }

  /**
   * Debounce publishing of playlist file (rewritten frequently).
   * @private
   * @param {string} hlsKey
   * @param {string} filePath
   * @param {string} tag
   */
  _debouncedPublishPlaylist(hlsKey, filePath, tag) {
    const debounceKey = hlsKey;
    const existing = this._publishDebounce.get(debounceKey);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(async () => {
      this._publishDebounce.delete(debounceKey);
      await this._publishToStorage(hlsKey, 'index.m3u8', filePath, 'application/x-mpegURL');
    }, 1500); // 1.5s debounce

    this._publishDebounce.set(debounceKey, timer);
  }

  /**
   * Publish a local file to storage (non-fatal fallback when resolveStorage unavailable).
   * @private
   * @param {string} hlsKey
   * @param {string} objectKey - relative key (e.g. 'index.m3u8', 'segment001.ts')
   * @param {string} filePath - absolute local path
   * @param {string} [contentType] - MIME type
   */
  async _publishToStorage(hlsKey, objectKey, filePath, contentType) {
    if (!this._resolveStorage) return;
    const tag = `[hls:${String(hlsKey).slice(0,8)}]`;
    try {
      const storage = await this._resolveStorage(hlsKey);
      if (!storage) return;
      const buffer = fs.readFileSync(filePath);
      await storage.putObject(hlsKey, objectKey, buffer, contentType);
    } catch (err) {
      logger.warn(`${tag} storage publish warning (${objectKey}): ${err?.message || err}`);
    }
  }

  /**
   * Get the public URL for an HLS object (or null if not applicable).
   * Returns the object URL when resolveStorage is available and the storage is not local,
   * otherwise null (local adapter policy).
   * @param {string} hlsKey
   * @param {string} objectKey - relative key (e.g. 'index.m3u8', 'segment001.ts')
   * @returns {Promise<string|null>}
   */
  async getPublicUrl(hlsKey, objectKey) {
    if (!this._resolveStorage) return null;
    try {
      const storage = await this._resolveStorage(hlsKey);
      if (!storage) return null;
      const url = storage.publicUrl(hlsKey, objectKey);
      return url || null;
    } catch (err) {
      logger.warn(`[hls] getPublicUrl warning: ${err?.message || err}`);
      return null;
    }
  }

  // Backwards-compatible helper used by stream-hls route
  getInternalHlsUrl(hlsKey) {
    const base = (process.env.MEDIAMTX_HLS_BASE_URL || 'http://127.0.0.1:8080').replace(/\/$/, '');
    return `${base}/${encodeURIComponent(hlsKey)}`;
  }
}
