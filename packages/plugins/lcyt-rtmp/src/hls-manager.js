import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createFfmpegRunner } from '../../../lcyt-backend/src/ffmpeg/index.js';

const DEFAULT_HLS_ROOT   = process.env.HLS_ROOT      || '/tmp/hls-video';
const DEFAULT_LOCAL_RTMP = process.env.HLS_LOCAL_RTMP || process.env.RADIO_LOCAL_RTMP || 'rtmp://127.0.0.1:1935';
const DEFAULT_RTMP_APP   = process.env.HLS_RTMP_APP   || process.env.RTMP_APPLICATION || 'live';

export class HlsManager {
  constructor({ hlsRoot, localRtmp, rtmpApp, runner } = {}) {
    this._procs = new Map();

    this._hlsRoot = hlsRoot   ?? DEFAULT_HLS_ROOT;
    this._local   = localRtmp ?? DEFAULT_LOCAL_RTMP;
    this._app     = rtmpApp   ?? DEFAULT_RTMP_APP;
    this._runner  = runner ?? process.env.FFMPEG_RUNNER ?? 'spawn';
  }

  hlsDir(hlsKey) { return join(this._hlsRoot, hlsKey); }

  async start(hlsKey) {
    return new Promise(async (resolve, reject) => {
      this._stopProc(hlsKey);

      const dir    = this.hlsDir(hlsKey);
      mkdirSync(dir, { recursive: true });

      const src      = `${this._local.replace(/\/$/, '')}/${this._app}/${hlsKey}`;
      const playlist = join(dir, 'index.m3u8');
      const segPat   = join(dir, 'seg%05d.ts');

      const args = [
        '-re', '-i', src,
        '-c', 'copy',
        '-f', 'hls',
        '-hls_time', '4',
        '-hls_list_size', '6',
        '-hls_flags', 'delete_segments+append_list',
        '-hls_segment_filename', segPat,
        playlist,
      ];

      const tag = `[hls:${hlsKey.slice(0,8)}]`;
      console.log(`${tag} Starting HLS: ${src} → ${playlist}`);

      const runner = createFfmpegRunner({ runner: this._runner, cmd: 'ffmpeg', args, name: tag, stdin: 'ignore' });
      try {
        const handle = await runner.start();
        this._procs.set(hlsKey, handle);

        if (handle.stdout) handle.stdout.on('data', d => process.stdout.write(`${tag} ${d}`));
        if (handle.stderr) handle.stderr.on('data', d => process.stderr.write(`${tag} ${d}`));

        runner.on('error', err => {
          this._procs.delete(hlsKey);
          console.error(`${tag} ffmpeg error: ${err.message}`);
          reject(err);
        });

        runner.on('close', info => {
          this._procs.delete(hlsKey);
          if (info && info.code !== undefined && info.code !== null) console.warn(`${tag} ffmpeg exited with code ${info.code}`);
          else console.log(`${tag} HLS stream ended`);
          this._cleanup(hlsKey);
        });

        setImmediate(resolve);
      } catch (err) {
        reject(err);
      }
    });
  }

  async stop(hlsKey) {
    const runner = this._procs.get(hlsKey);
    if (!runner) return;
    try {
      const res = await (typeof runner.stop === 'function' ? runner.stop(3000) : Promise.resolve({ timedOut: false }));
      return res;
    } finally {
      this._stopProc(hlsKey);
    }
  }

  async stopAll() { await Promise.all([...this._procs.keys()].map(k => this.stop(k))); }
  isRunning(hlsKey) { return this._procs.has(hlsKey); }

  _cleanup(hlsKey) { try { rmSync(this.hlsDir(hlsKey), { recursive: true, force: true }); } catch (err) { console.warn(`[hls] cleanup failed for ${hlsKey.slice(0,8)}: ${err.message}`); } }

  _stopProc(hlsKey) {
    const runner = this._procs.get(hlsKey);
    if (!runner) return;
    this._procs.delete(hlsKey);
    try {
      if (typeof runner.stop === 'function') {
        // best-effort stop
        try { runner.stop(3000); } catch (e) {}
      } else if (runner.proc && typeof runner.proc.kill === 'function') {
        runner.proc.kill('SIGTERM');
        const t = setTimeout(() => { try { if (runner.proc && typeof runner.proc.kill === 'function') runner.proc.kill('SIGKILL'); } catch {} }, 3000);
        if (t.unref) t.unref();
      }
    } catch {}
  }
}
