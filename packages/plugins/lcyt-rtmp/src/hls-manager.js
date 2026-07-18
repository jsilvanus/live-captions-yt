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
    /** Cached probe results: Map<hlsKey, { streamInfo, expiredAt }}. TTL = 60s. */
    this._probeCache = new Map();
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
   * Probe HLS stream for codec and bitrate information.
   * Runs ffprobe against the master playlist and caches results for 60s.
   * Falls back to hard-coded defaults if probing fails.
   * @param {string} hlsKey
   * @returns {Promise<{ bandwidth: number, codecs: string }>}
   */
  async probeStreamInfo(hlsKey) {
    const tag = `[hls:${String(hlsKey).slice(0,8)}]`;
    const cacheEntry = this._probeCache.get(hlsKey);

    // Return cached result if still valid (< 60s old)
    if (cacheEntry && Date.now() < cacheEntry.expiredAt) {
      return cacheEntry.streamInfo;
    }

    try {
      // Determine the source URL to probe
      let sourceUrl;
      if (this._procs.has(hlsKey)) {
        // Local ffmpeg: probe the local playlist
        sourceUrl = path.join(this.hlsDir(hlsKey), 'index.m3u8');
      } else {
        // MediaMTX: use the internal HLS URL
        sourceUrl = this.getInternalHlsUrl(hlsKey);
      }

      // Run ffprobe
      const result = spawnSync('ffprobe', [
        '-v', 'quiet',
        '-print_format', 'json',
        '-show_streams',
        sourceUrl,
      ], { encoding: 'utf-8' });

      if (result.error || result.status !== 0) {
        logger.debug(`${tag} ffprobe failed (status ${result.status}), using defaults`);
        return this._defaultStreamInfo();
      }

      // Parse the JSON output
      let streams;
      try {
        const output = JSON.parse(result.stdout);
        streams = output.streams || [];
      } catch (err) {
        logger.debug(`${tag} ffprobe JSON parse failed, using defaults`);
        return this._defaultStreamInfo();
      }

      // Extract video and audio stream info
      const videoStream = streams.find(s => s.codec_type === 'video');
      const audioStream = streams.find(s => s.codec_type === 'audio');

      const streamInfo = {
        bandwidth: this._computeBandwidth(videoStream, audioStream),
        codecs: this._buildCodecsString(videoStream, audioStream),
      };

      // Cache for 60 seconds
      this._probeCache.set(hlsKey, {
        streamInfo,
        expiredAt: Date.now() + 60000,
      });

      return streamInfo;
    } catch (err) {
      logger.warn(`${tag} probeStreamInfo error: ${err?.message || err}`);
      return this._defaultStreamInfo();
    }
  }

  /**
   * Compute BANDWIDTH from video+audio bitrates.
   * @private
   * @param {any} videoStream - ffprobe video stream info
   * @param {any} audioStream - ffprobe audio stream info
   * @returns {number} bandwidth in bits/sec
   */
  _computeBandwidth(videoStream, audioStream) {
    let bandwidth = 0;

    // Sum video bitrate
    if (videoStream?.bit_rate) {
      bandwidth += parseInt(videoStream.bit_rate, 10);
    }

    // Sum audio bitrate
    if (audioStream?.bit_rate) {
      bandwidth += parseInt(audioStream.bit_rate, 10);
    }

    // If neither stream has bitrate, try format.bit_rate as fallback
    // This happens when probing HLS playlists (container metadata only)
    // — but we can't get format info from ffprobe without -show_format,
    // so return 0 and let the caller fall back to hard-coded defaults

    return Math.max(bandwidth, 0);
  }

  /**
   * Build HLS CODECS string from video and audio stream info.
   * @private
   * @param {any} videoStream - ffprobe video stream info
   * @param {any} audioStream - ffprobe audio stream info
   * @returns {string} e.g. '"avc1.4d401f,mp4a.40.2"'
   */
  _buildCodecsString(videoStream, audioStream) {
    const codecs = [];

    // Video codec
    if (videoStream?.codec_name === 'h264') {
      // H.264 per RFC 6381: avc1.PPCCLL — profile_idc, constraint-flags, level_idc
      // as three separate hex bytes (constraint-flags unknown from ffprobe, use 00).
      // profile: baseline=66, main=77, high=100
      // level: e.g. 30 = 3.0, 40 = 4.0, 51 = 5.1 (multiply by 10)
      const profile = videoStream.profile === 'Main' ? 77 : videoStream.profile === 'High' ? 100 : 66;
      const level = videoStream.level || 40; // default to level 4.0
      const hex = profile.toString(16).padStart(2, '0')
        + '00'
        + level.toString(16).padStart(2, '0');
      codecs.push(`avc1.${hex}`);
    } else if (videoStream?.codec_name === 'hevc' || videoStream?.codec_name === 'h265') {
      // H.265/HEVC: hev1.<profile+level as hex> or hvc1.<profile+level as hex>
      // For simplicity, use hev1.1.6.L93.B0 (Main profile, level 5.1) as a reasonable default
      codecs.push('hev1.1.6.L93.B0');
    } else if (videoStream?.codec_name) {
      // Fallback for other video codecs
      logger.debug(`Unknown video codec: ${videoStream.codec_name}`);
      codecs.push('avc1.4d401f');
    }

    // Audio codec
    if (audioStream?.codec_name === 'aac') {
      // AAC-LC: mp4a.40.2 (profile 2 = LC, which is standard)
      const profile = audioStream.profile === 'HE-AAC' ? '5' : '2'; // HE-AAC = profile 5
      codecs.push(`mp4a.40.${profile}`);
    } else if (audioStream?.codec_name === 'mp3' || audioStream?.codec_name === 'libmp3lame') {
      // MP3: mp4a.6b
      codecs.push('mp4a.69');
    } else if (audioStream?.codec_name) {
      // Fallback for other audio codecs
      logger.debug(`Unknown audio codec: ${audioStream.codec_name}`);
      codecs.push('mp4a.40.2');
    }

    const result = codecs.join(',');
    return result ? `"${result}"` : '"avc1.4d401f,mp4a.40.2"';
  }

  /**
   * Default stream info (hard-coded fallback).
   * @private
   * @returns {{ bandwidth: number, codecs: string }}
   */
  _defaultStreamInfo() {
    return {
      bandwidth: 2800000,
      codecs: '"avc1.4d401f,mp4a.40.2"',
    };
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
