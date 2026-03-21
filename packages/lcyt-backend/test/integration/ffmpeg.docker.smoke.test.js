import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';

// This smoke test checks that Docker is available and that an ffmpeg image can be run.
// It is skipped by default unless DOCKER_AVAILABLE=1 is set in the environment (CI safe).

const dockerEnabled = !!process.env.DOCKER_AVAILABLE;

test('ffmpeg docker smoke (skip unless DOCKER_AVAILABLE=1)', { skip: !dockerEnabled }, () => {
  // Try `docker version` first
  const ver = spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], { encoding: 'utf8' });
  assert.equal(ver.error, undefined, `docker not available: ${ver.error}`);
  assert.equal(ver.status, 0, `docker version exit ${ver.status}`);

  // Build the image if it doesn't exist (use small tag lcyt-ffmpeg:test)
  const inspect = spawnSync('docker', ['image', 'inspect', 'lcyt-ffmpeg:test'], { encoding: 'utf8' });
  if (inspect.status !== 0) {
    const build = spawnSync('docker', ['build', '-t', 'lcyt-ffmpeg:test', '-f', 'docker/ffmpeg/Dockerfile', 'docker/ffmpeg'], { stdio: 'inherit' });
    assert.equal(build.status, 0, 'docker build failed');
  }

  // Run ffmpeg -version inside the image
  const run = spawnSync('docker', ['run', '--rm', '--entrypoint', 'ffmpeg', 'lcyt-ffmpeg:test', '-version'], { encoding: 'utf8' });
  assert.equal(run.status, 0, `ffmpeg in container returned ${run.status}`);
  assert.match(run.stdout || run.stderr || '', /ffmpeg version/i);
});
