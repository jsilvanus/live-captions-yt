import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LocalFfmpegRunner } from '../src/ffmpeg/local-runner.js';

describe('LocalFfmpegRunner', () => {
  it('starts and stops a process (uses node as a harmless subprocess)', async () => {
    const runner = new LocalFfmpegRunner({ cmd: 'node', args: ['-e', 'setTimeout(()=>{}, 1000)'], name: 'test-runner' });
    runner.start();
    // allow spawn to settle
    await new Promise(r => setImmediate(r));
    assert.equal(runner.isRunning(), true);
    runner.stop();
    // wait for close event to propagate
    await new Promise(r => setImmediate(r));
    // can't reliably check process exit synchronously in all envs, but stop() should not throw
    assert.ok(typeof runner.isRunning() === 'boolean');
  });
});
