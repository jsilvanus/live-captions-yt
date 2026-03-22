import { test } from 'node:test';
import assert from 'node:assert';
test('DockerFfmpegRunner spawn args include image and provided args', async () => {
  let captured = null;
  const mockChild = {
    spawnSync: () => ({ status: 0 }),
    spawn: (cmd, args, opts) => {
      captured = { cmd, args, opts };
      const handlers = {};
      const proc = {
        stdout: null,
        stderr: null,
        stdin: null,
        killed: false,
        kill: () => { proc.killed = true; },
        on: (ev, cb) => { handlers[ev] = handlers[ev] || []; handlers[ev].push(cb); },
        emit: (ev, ...a) => { (handlers[ev]||[]).forEach(cb => cb(...a)); }
      };
      setTimeout(() => { proc.emit('close', 0, null); }, 0);
      return proc;
    }
  };

  const { DockerFfmpegRunner } = await import('../src/ffmpeg/docker-runner.js');
  const runner = new DockerFfmpegRunner({ image: 'my-image:latest', args: ['-i', 'input', '-f', 'mp4'], childProc: mockChild });
  const res = await runner.start();
  // ensure spawn was called and args include the image and our ffmpeg args
  assert.ok(captured, 'spawn not called');
  assert.strictEqual(captured.cmd, 'docker');
  // last element of run args should be our ffmpeg args' first element or include them
  assert.ok(captured.args.includes('my-image:latest'));
  // ensure one of our ffmpeg args present
  assert.ok(captured.args.includes('-i'));

  // nothing to restore when injecting via constructor
});
