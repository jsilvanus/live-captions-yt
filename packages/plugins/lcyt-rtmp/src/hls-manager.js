import logger from 'lcyt/logger';
import { spawnSync } from 'node:child_process';

/**
 * Tracks which streams have HLS enabled and serves their playlist info.
 *
 * The HLS itself is produced by MediaMTX: start() registers the path there and the public
 * /stream-hls routes proxy MediaMTX's HLS output (mediamtx.hls_base_url). This manager does not
 * run ffmpeg and does not write segment files.
 */
export class HlsManager {
  constructor({ mediamtxClient = null, settings = null } = {}) {
    this._mediamtx = mediamtxClient;
    this._settings = settings;
    /** Keys with HLS active (registered in MediaMTX). */
    this._active = new Set();
    /** Cached probe results: Map<hlsKey, { streamInfo, expiredAt }}. TTL = 60s. */
    this._probeCache = new Map();
  }

  isRunning(hlsKey) {
    return this._active.has(hlsKey);
  }

  async start(hlsKey) {
    const tag = `[hls:${String(hlsKey).slice(0,8)}]`;

    // If already running, stop first
    if (this.isRunning(hlsKey)) {
      await this.stop(hlsKey);
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

    this._active.add(hlsKey);
    logger.info(`${tag} HLS active`);
  }

  async stop(hlsKey) {
    const tag = `[hls:${String(hlsKey).slice(0,8)}]`;
    if (!this._active.has(hlsKey)) return;
    this._active.delete(hlsKey);
    logger.info(`${tag} HLS stopped`);
  }

  async stopAll() {
    await Promise.all([...this._active].map(k => this.stop(k)));
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
      // Probe MediaMTX's internal HLS URL
      const sourceUrl = this.getInternalHlsUrl(hlsKey);

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

  // Backwards-compatible helper used by stream-hls route
  getInternalHlsUrl(hlsKey) {
    const base = (this._settings ? this._settings.get('mediamtx.hls_base_url') : (process.env.MEDIAMTX_HLS_BASE_URL || 'http://127.0.0.1:8080')).replace(/\/$/, '');
    return `${base}/${encodeURIComponent(hlsKey)}`;
  }
}
