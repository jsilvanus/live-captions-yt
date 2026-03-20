import { LocalFfmpegRunner } from './local-runner.js';
import { DockerFfmpegRunner } from './docker-runner.js';

export function createFfmpegRunner({ runner = process.env.FFMPEG_RUNNER || 'spawn', ...opts } = {}) {
  switch (runner) {
    case 'spawn':
    case 'local':
      return new LocalFfmpegRunner(opts);
    case 'docker':
      return new DockerFfmpegRunner(opts);
    default:
      throw new Error(`Unknown ffmpeg runner: ${runner}`);
  }
}

export { LocalFfmpegRunner, DockerFfmpegRunner };
