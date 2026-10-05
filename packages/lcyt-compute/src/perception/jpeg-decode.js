import { spawn } from 'node:child_process';
import { computeLetterbox, jpegSize, letterboxFilter } from './letterbox.js';

/**
 * Decode one JPEG (the preview snapshot) into a letterboxed raw RGB frame for a detector, with a
 * one-shot ffmpeg. Used only for the HTTP snapshot fallback; the stream source decodes continuously.
 *
 * @param {Buffer} jpeg
 * @param {number} size  detector input side
 * @param {{ ffmpegPath?: string, timeoutMs?: number }} [opts]
 * @returns {Promise<{ data: Buffer, width: number, height: number, letterbox: object, capturedAt: number }>}
 */
export function decodeJpegToFrame(jpeg, size, { ffmpegPath = 'ffmpeg', timeoutMs = 10000 } = {}) {
  const dims = jpegSize(jpeg);
  if (!dims) return Promise.reject(new Error('frame is not a JPEG'));
  const letterbox = computeLetterbox(dims.width, dims.height, size);
  const args = ['-hide_banner', '-loglevel', 'error', '-f', 'image2pipe', '-c:v', 'mjpeg', '-i', 'pipe:0',
    '-vf', letterboxFilter(letterbox), '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'];
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const chunks = [];
    let stderr = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('jpeg decode timed out')); }, timeoutMs);
    child.stdout.on('data', (c) => chunks.push(c));
    child.stderr.on('data', (c) => { stderr += c; });
    child.on('error', (err) => { clearTimeout(timer); reject(err); });
    child.on('close', () => {
      clearTimeout(timer);
      const data = Buffer.concat(chunks);
      if (data.length !== size * size * 3) return reject(new Error(`jpeg decode produced ${data.length} bytes${stderr ? `: ${stderr.trim().slice(-200)}` : ''}`));
      resolve({ data, width: size, height: size, letterbox, capturedAt: Date.now() });
    });
    child.stdin.on('error', () => {});
    child.stdin.end(jpeg);
  });
}
