import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeLetterbox, boxToNormalized, letterboxFilter, jpegSize } from '../src/perception/letterbox.js';

test('computeLetterbox fits 16:9 into a square with grey bars above and below', () => {
  const lb = computeLetterbox(1920, 1080, 416);
  assert.equal(lb.newW, 416);
  assert.equal(lb.newH, 234);
  assert.equal(lb.padX, 0);
  assert.equal(lb.padY, 91);
  assert.equal(letterboxFilter(lb), 'scale=416:234:flags=bilinear,pad=416:416:0:91:color=0x727272');
});

test('computeLetterbox fits portrait with bars left and right', () => {
  const lb = computeLetterbox(1080, 1920, 416);
  assert.equal(lb.newH, 416);
  assert.equal(lb.newW, 234);
  assert.equal(lb.padY, 0);
  assert.equal(lb.padX, 91);
});

test('computeLetterbox rejects a nonsense size', () => {
  assert.throws(() => computeLetterbox(0, 1080, 416), /invalid letterbox/);
});

test('boxToNormalized maps a letterboxed box back to 0..1 of the source and clamps', () => {
  const lb = computeLetterbox(1920, 1080, 416);
  // The whole picture area of the letterbox is the whole source.
  assert.deepEqual(boxToNormalized({ x: 0, y: 91, w: 416, h: 234 }, lb), { x: 0, y: 0, w: 1, h: 1 });
  // Left half, top half of the picture.
  const half = boxToNormalized({ x: 0, y: 91, w: 208, h: 117 }, lb);
  assert.deepEqual(half, { x: 0, y: 0, w: 0.5, h: 0.5 });
  // A box reaching into the padding is clamped to the picture.
  const clamped = boxToNormalized({ x: -20, y: 40, w: 100, h: 400 }, lb);
  assert.equal(clamped.x, 0);
  assert.equal(clamped.y, 0);
  assert.equal(clamped.h, 1);
});

test('jpegSize reads the frame header, null for non JPEG', () => {
  // SOI, APP0 (len 16), SOF0 (len 17): precision 8, height 0x0438 = 1080, width 0x0780 = 1920.
  const app0 = Buffer.concat([Buffer.from([0xff, 0xe0, 0x00, 0x10]), Buffer.alloc(14)]);
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, 0x04, 0x38, 0x07, 0x80, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.from([0xff, 0xd9])]);
  assert.deepEqual(jpegSize(jpeg), { width: 1920, height: 1080 });
  assert.equal(jpegSize(Buffer.from('not a jpeg')), null);
  assert.equal(jpegSize(null), null);
});
