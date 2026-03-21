import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createFfmpegRunner } from '../../../lcyt-backend/src/ffmpeg/index.js';

const DEFAULT_HLS_ROOT   = process.env.RADIO_HLS_ROOT   || '/tmp/hls';
const DEFAULT_LOCAL_RTMP = process.env.RADIO_LOCAL_RTMP  || 'rtmp://127.0.0.1:1935';
const DEFAULT_RTMP_APP   = process.env.RADIO_RTMP_APP    || process.env.RTMP_APPLICATION || 'live';

export class RadioManager {
  constructor({ hlsRoot, localRtmp, rtmpApp, runner } = {}) {
    this._procs = new Map();
    this._hlsRoot = hlsRoot  ?? DEFAULT_HLS_ROOT;
    this._local   = localRtmp ?? DEFAULT_LOCAL_RTMP;
    this._app     = rtmpApp  ?? DEFAULT_RTMP_APP;
    this._runner  = runner ?? process.env.FFMPEG_RUNNER ?? 'spawn';
  }

  hlsDir(radioKey) { return join(this._hlsRoot, radioKey); }

  start(radioKey) {
    return new Promise((resolve, reject) => {
      this._stopProc(radioKey);

      const dir    = this.hlsDir(radioKey);
      mkdirSync(dir, { recursive: true });

      const src      = `${this._local.replace(/\/$/, '')}/${this._app}/${radioKey}`;
      const playlist = join(dir, 'index.m3u8');
      const segPat   = join(dir, 'seg%05d.ts');

      const args = [
        '-re', '-i', src,
        '-vn',
        '-c:a', 'aac', '-b:a', '128k', '-ar', '44100',
        '-f', 'hls',
        '-hls_time', '4',
        '-hls_list_size', '6',
        '-hls_flags', 'delete_segments+append_list',
        '-hls_segment_filename', segPat,
        playlist,
      ];

      const tag = `[radio:${radioKey.slice(0,8)}]`;
      console.log(`${tag} Starting HLS: ${src} → ${playlist}`);

      const runner = createFfmpegRunner({ runner: this._runner, cmd: 'ffmpeg', args, name: tag, stdin: 'ignore' });
      runner.start();
      this._procs.set(radioKey, runner);

      if (runner.stdout) runner.stdout.on('data', d => process.stdout.write(`${tag} ${d}`));
      if (runner.stderr) runner.stderr.on('data', d => process.stderr.write(`${tag} ${d}`));

      runner.on('error', err => {
        this._procs.delete(radioKey);
        console.error(`${tag} ffmpeg error: ${err.message}`);
        reject(err);
      });

      runner.on('close', code => {
        this._procs.delete(radioKey);
        if (code !== 0 && code !== null) console.warn(`${tag} ffmpeg exited with code ${code}`);
        else console.log(`${tag} HLS stream ended`);
        this._cleanup(radioKey);
      });

      setImmediate(resolve);
    });
  }

  stop(radioKey) {
    return new Promise(resolve => {
      const runner = this._procs.get(radioKey);
      if (!runner) return resolve();
      runner.once('close', resolve);
      this._stopProc(radioKey);
    });
  }

  async stopAll() { await Promise.all([...this._procs.keys()].map(k => this.stop(k))); }
  isRunning(radioKey) { return this._procs.has(radioKey); }

  _cleanup(radioKey) { try { rmSync(this.hlsDir(radioKey), { recursive: true, force: true }); } catch (err) { console.warn(`[radio] cleanup failed for ${radioKey.slice(0,8)}: ${err.message}`); } }

  _stopProc(radioKey) {
    const runner = this._procs.get(radioKey);
    if (!runner) return;
    this._procs.delete(radioKey);
    try {
      if (typeof runner.stop === 'function') runner.stop();
      else if (runner.proc && typeof runner.proc.kill === 'function') runner.proc.kill('SIGTERM');
      const t = setTimeout(() => { try { if (runner.proc && typeof runner.proc.kill === 'function') runner.proc.kill('SIGKILL'); } catch {} }, 3000);
      if (t.unref) t.unref();
    } catch {}
  }
}
