import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('DockerFfmpegRunner integration (gated) — writes file into mounted volume', { skip: process.env.TEST_DOCKER !== '1' }, async () => {
  const { DockerFfmpegRunner } = await import('../src/ffmpeg/docker-runner.js');

  const tmp = mkdtempSync(join(tmpdir(), 'docker-runner-test-'));
  const outPath = join(tmp, 'hello.txt');

  // Use a small base image and run a sh command that writes a file then exits.
  const runner = new DockerFfmpegRunner({
    image: 'alpine:3.18',
    entrypoint: 'sh',
    args: ['-c', `echo container-write > /out/hello.txt; sleep 1`],
    volumes: [`${tmp}:/out`],
  });

  const proc = runner.start();
  assert(proc, 'docker runner should have spawned a process');

  // Wait for container to exit
  await new Promise((resolve, reject) => {
    let done = false;
    const t = setTimeout(() => {
      if (!done) {
        done = true;
        reject(new Error('timeout waiting for container'));
      }
    }, 20000);

    proc.on('close', (code) => {
      if (done) return;
      done = true;
      clearTimeout(t);
      resolve(code);
    });

    proc.on('error', (err) => {
      if (done) return;
      done = true;
      clearTimeout(t);
      reject(err);
    });
  });

  // Verify file was written by container
  const content = readFileSync(outPath, 'utf8').trim();
  assert.equal(content, 'container-write');

  try { rmSync(tmp, { recursive: true, force: true }); } catch {}
});
