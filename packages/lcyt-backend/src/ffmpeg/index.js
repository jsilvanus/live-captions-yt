import { LocalFfmpegRunner } from './local-runner.js';

export function createFfmpegRunner({ runner = 'spawn', ...opts } = {}) {
  switch (runner) {
    case 'spawn':
    case 'local':
      return new LocalFfmpegRunner(opts);
    default:
      throw new Error(`Unknown ffmpeg runner: ${runner}`);
  }
}

export { LocalFfmpegRunner };
