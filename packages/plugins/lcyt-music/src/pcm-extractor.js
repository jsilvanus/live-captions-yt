/**
 * Decode an HLS fMP4 audio segment buffer into raw mono PCM via ffmpeg.
 *
 * ffmpeg reads the segment from stdin and writes signed 16-bit little-endian
 * PCM to stdout; no temp files, no native Node dependencies.
 */

import { spawn } from 'node:child_process';
import { reportFfmpegRun } from './ffmpeg-accounting.js';

/**
 * @param {Buffer} segmentBuffer - raw fMP4 segment bytes
 * @param {object} [opts]
 * @param {number} [opts.sampleRate=22050]
 * @param {string} [opts.apiKey=''] - project attribution for ffmpeg accounting
 * @returns {Promise<Float32Array>} mono PCM, normalised to [-1, 1]
 */
export function extractPcm(segmentBuffer, { sampleRate = 22050, apiKey = '' } = {}) {
  return new Promise((resolve, reject) => {
    let proc;
    try {
      proc = spawn('ffmpeg', [
        '-hide_banner', '-loglevel', 'error',
        '-i', 'pipe:0',
        '-f', 's16le',
        '-ac', '1',
        '-ar', String(sampleRate),
        'pipe:1',
      ], { stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (err) {
      reject(new Error(`extractPcm: failed to spawn ffmpeg: ${err.message}`));
      return;
    }

    // ffmpeg compute accounting (plan_metering_audit §4.1) — short per-segment
    // runs, reported through the sink set by initMusicControl.
    {
      const ffmpegStartedAt = Date.now();
      let accounted = false;
      const account = () => {
        if (accounted) return;
        accounted = true;
        reportFfmpegRun({ purpose: 'pcm', apiKey, seconds: (Date.now() - ffmpegStartedAt) / 1000 });
      };
      proc.once('close', account);
      proc.once('error', account);
    }

    const chunks = [];
    let stderr = '';

    proc.stdout.on('data', (chunk) => chunks.push(chunk));
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    proc.on('error', (err) => {
      reject(new Error(`extractPcm: ffmpeg error: ${err.message}`));
    });

    proc.on('close', (code) => {
      if (code !== 0 && chunks.length === 0) {
        reject(new Error(`extractPcm: ffmpeg exited with code ${code}: ${stderr.slice(0, 500)}`));
        return;
      }
      const int16Buf = Buffer.concat(chunks);
      const sampleCount = Math.floor(int16Buf.length / 2);
      const pcm = new Float32Array(sampleCount);
      for (let i = 0; i < sampleCount; i++) {
        pcm[i] = int16Buf.readInt16LE(i * 2) / 32768;
      }
      resolve(pcm);
    });

    proc.stdin.on('error', () => {
      // EPIPE if ffmpeg exits before consuming all input — surfaced via 'close' instead.
    });
    proc.stdin.write(segmentBuffer);
    proc.stdin.end();
  });
}

/**
 * Probe the installed ffmpeg version (same convention as
 * lcyt-rtmp's probeFfmpegVersion, duplicated here to keep this plugin
 * independently installable without a hard dependency on lcyt-rtmp).
 *
 * @returns {Promise<{ major: number, minor: number }|null>}
 */
export function probeFfmpegVersion() {
  return new Promise((resolve) => {
    let proc;
    try {
      proc = spawn('ffmpeg', ['-version'], { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch {
      resolve(null);
      return;
    }
    let output = '';
    proc.stdout?.on('data', (d) => { output += d.toString(); });
    proc.on('error', () => resolve(null));
    proc.on('close', () => {
      const m = output.match(/ffmpeg version (\d+)\.(\d+)/);
      if (!m) { resolve(null); return; }
      resolve({ major: Number(m[1]), minor: Number(m[2]) });
    });
  });
}
