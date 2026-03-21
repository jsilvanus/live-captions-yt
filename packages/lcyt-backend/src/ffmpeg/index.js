import { LocalFfmpegRunner } from './local-runner.js';
import { DockerFfmpegRunner } from './docker-runner.js';

// Environment-driven defaults
const ENV_RUNNER = process.env.FFMPEG_RUNNER || 'spawn';
const ENV_IMAGE = process.env.FFMPEG_IMAGE || 'lcyt-ffmpeg:latest';
const ENV_WRAPPER = process.env.FFMPEG_WRAPPER || '';

export function createFfmpegRunner({ runner = ENV_RUNNER, ...opts } = {}) {
  // Backwards-compatible: if a wrapper command is provided via env, prefer it
  if (!opts.cmd && ENV_WRAPPER) {
    return new LocalFfmpegRunner(Object.assign({}, opts, { cmd: ENV_WRAPPER }));
  }

  switch (runner) {
    case 'spawn':
    case 'local':
      return new LocalFfmpegRunner(opts);
    case 'docker':
      // ensure image default is taken from env when not provided
      return new DockerFfmpegRunner(Object.assign({ image: ENV_IMAGE }, opts));
    default:
      throw new Error(`Unknown ffmpeg runner: ${runner}`);
  }
}

export { LocalFfmpegRunner, DockerFfmpegRunner };
