import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { makeFifo } from '../../src/ffmpeg/pipe-utils.js';

test('FIFO host<->container communication (gated)', { skip: process.env.TEST_DOCKER !== '1' }, async () => {
  const { DockerFfmpegRunner } = await import('../src/ffmpeg/docker-runner.js');

  const tmp = fs.mkdtempSync(join(tmpdir(), 'fifo-int-'));
  const fifo = join(tmp, 'thefifo');
  await makeFifo(fifo);

  // Start reader on host — createReadStream will block until writer opens on POSIX FIFOs.
  const readPromise = new Promise((resolve, reject) => {
    const rs = fs.createReadStream(fifo, { encoding: 'utf8' });
    let buf = '';
    rs.on('data', (c) => { buf += c; });
    rs.on('end', () => resolve(buf.trim()));
    rs.on('error', reject);
  });

  // Start a container that writes into the fifo (mounted)
  const runner = new DockerFfmpegRunner({
    image: 'alpine:3.18',
    entrypoint: 'sh',
    args: ['-c', `sleep 0.2; printf "hello-from-container\n" > /mnt/thefifo; sleep 0.2`],
    volumes: [`${tmp}:/mnt`],
  });

  const proc = runner.start();

  await Promise.all([
    new Promise((res, rej) => proc.on('close', res)).catch(() => {}),
    readPromise,
  ]).then(([, content]) => {
    assert(content.includes('hello-from-container'));
  });

  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
});
