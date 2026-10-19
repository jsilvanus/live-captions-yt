import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redactList, secretsOfUrl, REDACT_MAX_VALUES } from '../src/ffmpeg/redact.js';
import { FleetFfmpegRunner } from '../src/ffmpeg/fleet-runner.js';

test('redactList keeps distinct strings of 4-512 characters, in order', () => {
  assert.deepEqual(redactList('abcd', 'abcd', 'xyz', null, undefined, 42, 'wxyz'), ['abcd', 'wxyz']);
  assert.deepEqual(redactList('a'.repeat(513), 'b'.repeat(512)), ['b'.repeat(512)]);
  assert.deepEqual(redactList(['key-one', ['key-two']]), ['key-one', 'key-two']);
});

test('redactList is capped at the fleet limit of 10 values', () => {
  const many = Array.from({ length: 12 }, (_, i) => `key-${i}`);
  const out = redactList(many);
  assert.equal(out.length, REDACT_MAX_VALUES);
  assert.equal(out[0], 'key-0');
});

test('secretsOfUrl finds the stream key, a password and query values', () => {
  assert.deepEqual(secretsOfUrl('rtmp://a.rtmp.youtube.com/live2/abcd-efgh-ijkl'), ['abcd-efgh-ijkl']);
  assert.ok(secretsOfUrl('rtmp://user:s3cret@host/app/key1').includes('s3cret'));
  assert.ok(secretsOfUrl('https://h/live?token=tok123').includes('tok123'));
  assert.deepEqual(secretsOfUrl('not a url'), []);
});

test('FleetFfmpegRunner puts redact into the submitted spec only when given', async () => {
  const job = { id: 'j', where: null, done: new Promise(() => {}), on() {}, state: 'running' };
  let spec;
  const r = new FleetFfmpegRunner({ fleet: { submit: async (s) => { spec = s; return job; } }, args: ['-i', 'x'], purpose: 'relay', redact: ['streamkey-1'] });
  await r.start();
  assert.deepEqual(spec.redact, ['streamkey-1']);

  const plain = new FleetFfmpegRunner({ fleet: { submit: async (s) => { spec = s; return job; } }, args: [], purpose: 'test' });
  await plain.start();
  assert.equal('redact' in spec, false);
});
