import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { spawnFfmpeg } from '../src/ffmpeg/spawn.js';
import { closeFleet } from '../src/ffmpeg/fleet-runner.js';

const skip = spawnSync('ffmpeg', ['-version']).status === 0 ? false : 'ffmpeg is not installed';

async function readAll(stream) {
  const chunks = [];
  for await (const c of stream) chunks.push(c);
  return Buffer.concat(chunks);
}

for (const runner of ['spawn', 'fleet']) {
  test(`${runner}: stdout carries raw PCM and close follows the last byte`, { skip }, async () => {
    const proc = spawnFfmpeg(['-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=16000:cl=mono', '-t', '0.5', '-f', 's16le', 'pipe:1'], { runner, stdio: ['ignore', 'pipe', 'pipe'] });
    const closed = new Promise((resolve) => proc.once('close', (code) => resolve(code)));
    const out = await readAll(proc.stdout);
    assert.equal(out.length, 16000);
    assert.equal(await closed, 0);
  });

  test(`${runner}: stdin.end() gives ffmpeg EOF`, { skip }, async () => {
    const proc = spawnFfmpeg(['-v', 'error', '-f', 's16le', '-ar', '8000', '-ac', '1', '-i', 'pipe:0', '-f', 's16le', 'pipe:1'], { runner, stdio: ['pipe', 'pipe', 'pipe'] });
    const reading = readAll(proc.stdout);
    proc.stdin.end(Buffer.alloc(3 * 512 * 1024 / 4)); // more than one fleet stdin chunk
    assert.equal((await reading).length, 3 * 512 * 1024 / 4);
  });

  test(`${runner}: kill() ends a running process with a close event`, { skip }, async () => {
    const proc = spawnFfmpeg(['-v', 'error', '-re', '-f', 'lavfi', '-i', 'anullsrc', '-f', 'null', '-'], { runner, stdio: ['ignore', 'ignore', 'pipe'] });
    const closed = new Promise((resolve) => proc.once('close', resolve));
    await new Promise((r) => setTimeout(r, 500));
    proc.kill('SIGTERM');
    await closed;
  });
}

test('fleet: a failing job writes the reason to stderr and exposes it as failure', { skip }, async () => {
  const proc = spawnFfmpeg(['-v', 'error', '-i', '/no/such/file', '-f', 'null', '-'], { runner: 'fleet', stdio: ['ignore', 'ignore', 'pipe'] });
  const closed = new Promise((resolve) => proc.once('close', (code) => resolve(code)));
  const err = (await readAll(proc.stderr)).toString();
  assert.notEqual(await closed, 0);
  assert.equal(proc.failure?.code, 'FFMPEG_EXIT');
  assert.match(err, /FFMPEG_EXIT/);
  assert.match(err, /No such file/);
});

test('closeFleet', async () => { await closeFleet(); });
