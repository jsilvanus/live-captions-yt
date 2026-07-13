import { createFfmpegRunner } from 'lcyt-backend/ffmpeg';
import logger from 'lcyt/logger';
import { getCropConfig, setCropConfig, setCropPosition, activateCropPreset } from './db/crop.js';

const DEFAULT_MEDIAMTX_RTSP = (process.env.MEDIAMTX_RTSP_BASE_URL || 'rtsp://127.0.0.1:8554').replace(/\/$/, '');
const DEFAULT_MEDIAMTX_RTMP = (process.env.MEDIAMTX_RTMP_BASE_URL || 'rtmp://127.0.0.1:1935').replace(/\/$/, '');
const DEFAULT_OUTPUT_SIZE = process.env.CROP_OUTPUT_DEFAULT || '1080x1920';

function clamp01(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0.5;
  return Math.max(0, Math.min(1, n));
}

function roundEven(value) {
  return Math.round(value / 2) * 2;
}

function deriveGeometry({ aspectW = 9, aspectH = 16, inW = 1920, inH = 1080, outW = null, outH = null, xNorm = 0.5, yNorm = 0.0 } = {}) {
  const cropW = Math.max(1, Math.min(inW, roundEven(inH * aspectW / aspectH)));
  const cropH = inH;
  const xPx = Math.max(0, Math.min(inW - cropW, roundEven((inW - cropW) * clamp01(xNorm))));
  const yPx = Math.max(0, Math.min(inH - cropH, roundEven((inH - cropH) * clamp01(yNorm))));
  const resolvedOutW = outW ?? Number.parseInt(DEFAULT_OUTPUT_SIZE.split('x')[0], 10) || 1080;
  const resolvedOutH = outH ?? Number.parseInt(DEFAULT_OUTPUT_SIZE.split('x')[1], 10) || 1920;
  return { inW, inH, cropW, cropH, xPx, yPx, outW: resolvedOutW, outH: resolvedOutH };
}

export class CropManager {
  constructor({ db, ffmpegCaps, ffmpegRunner = process.env.FFMPEG_RUNNER || 'spawn' } = {}) {
    this.db = db;
    this._ffmpegCaps = ffmpegCaps ?? { available: true, hasZmq: false };
    this._ffmpegRunner = ffmpegRunner;
    this._procs = new Map();
    this._states = new Map();
  }

  getState(apiKey) {
    const config = getCropConfig(this.db, apiKey);
    const state = this._states.get(apiKey) ?? {};
    return {
      running: Boolean(state.running),
      repositionMode: state.repositionMode || 'restart',
      inW: state.inW ?? null,
      inH: state.inH ?? null,
      cropW: state.cropW ?? null,
      cropH: state.cropH ?? null,
      xNorm: state.xNorm ?? config.xNorm,
      yNorm: state.yNorm ?? config.yNorm,
      activePresetId: state.activePresetId ?? config.activePresetId ?? null,
      activeSetId: state.activeSetId ?? config.activeSetId ?? null,
      enabled: Boolean(config.enabled),
      aspectW: config.aspectW,
      aspectH: config.aspectH,
      outW: config.outW,
      outH: config.outH,
      videoBitrate: config.videoBitrate,
      followProgram: Boolean(config.followProgram),
      transitionMs: config.transitionMs,
    };
  }

  async applyConfig(apiKey, patch = {}) {
    const next = setCropConfig(this.db, apiKey, patch);
    if (next.enabled) {
      await this.start(apiKey, next);
    } else {
      await this.stop(apiKey);
    }
    return this.getState(apiKey);
  }

  async applyPosition(apiKey, { xNorm, yNorm, transitionMs = 0 } = {}) {
    const current = getCropConfig(this.db, apiKey);
    const patch = {
      xNorm: xNorm ?? current.xNorm,
      yNorm: yNorm ?? current.yNorm,
      transitionMs,
    };
    setCropPosition(this.db, apiKey, patch);
    if (current.enabled) {
      await this.start(apiKey, { ...current, ...patch });
    }
    return this.getState(apiKey);
  }

  async activatePreset(apiKey, preset, transitionMs = 0) {
    if (!preset) return this.getState(apiKey);
    activateCropPreset(this.db, apiKey, preset.id);
    const current = getCropConfig(this.db, apiKey);
    if (current.enabled) {
      await this.start(apiKey, { ...current, xNorm: preset.xNorm, yNorm: preset.yNorm, transitionMs });
    }
    return this.getState(apiKey);
  }

  async start(apiKey, opts = {}) {
    const config = getCropConfig(this.db, apiKey);
    const merged = { ...config, ...opts };
    if (!merged.enabled) {
      await this.stop(apiKey);
      return this.getState(apiKey);
    }

    await this.stop(apiKey);

    const geometry = deriveGeometry({
      aspectW: merged.aspectW,
      aspectH: merged.aspectH,
      inW: merged.inW ?? 1920,
      inH: merged.inH ?? 1080,
      outW: merged.outW,
      outH: merged.outH,
      xNorm: merged.xNorm,
      yNorm: merged.yNorm,
    });

    const args = [
      '-rtsp_transport', 'tcp',
      '-i', `${DEFAULT_MEDIAMTX_RTSP}/${apiKey}`,
      '-filter_complex', `[0:v]crop=${geometry.cropW}:${geometry.cropH}:${geometry.xPx}:${geometry.yPx},scale=${geometry.outW}:${geometry.outH}[v]`,
      '-map', '[v]',
      '-map', '0:a',
      '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency',
      '-c:a', 'copy',
      '-f', 'flv', `${DEFAULT_MEDIAMTX_RTMP}/${apiKey}-crop`,
    ];

    try {
      const runner = createFfmpegRunner({ runner: this._ffmpegRunner, cmd: 'ffmpeg', args, name: `crop:${apiKey}` });
      const handle = await runner.start();
      handle.on('error', err => logger.warn(`[crop] ffmpeg error for ${apiKey}: ${err.message}`));
      handle.on('close', () => {
        if (this._procs.get(apiKey) === handle) {
          this._procs.delete(apiKey);
        }
      });
      this._procs.set(apiKey, handle);
      this._states.set(apiKey, {
        running: true,
        repositionMode: this._ffmpegCaps?.hasZmq ? 'live' : 'restart',
        inW: geometry.inW,
        inH: geometry.inH,
        cropW: geometry.cropW,
        cropH: geometry.cropH,
        xNorm: clamp01(merged.xNorm),
        yNorm: clamp01(merged.yNorm),
        activePresetId: merged.activePresetId ?? null,
        activeSetId: merged.activeSetId ?? null,
      });
      return this.getState(apiKey);
    } catch (err) {
      logger.warn(`[crop] Failed to start crop renderer for ${apiKey}: ${err.message}`);
      return this.getState(apiKey);
    }
  }

  async stop(apiKey) {
    const proc = this._procs.get(apiKey);
    if (proc) {
      try {
        await proc.stop?.(2000);
      } catch (err) {
        logger.warn(`[crop] Failed to stop crop renderer for ${apiKey}: ${err.message}`);
      }
      this._procs.delete(apiKey);
    }
    const state = this._states.get(apiKey);
    if (state) {
      this._states.set(apiKey, { ...state, running: false });
    }
    return this.getState(apiKey);
  }

  async stopAll() {
    const keys = Array.from(this._procs.keys());
    await Promise.allSettled(keys.map(key => this.stop(key)));
  }
}
