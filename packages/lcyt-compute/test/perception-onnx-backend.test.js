import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOnnxDetector } from '../src/perception/onnx-backend.js';
import { createDetector } from '../src/perception/backends.js';
import { anchorCount } from '../src/perception/yolox.js';
import { computeLetterbox } from '../src/perception/letterbox.js';

const SIZE = 416;

/** A fake onnxruntime: the session answers every run with one person at a known place. */
function fakeOrt(rows) {
  const anchors = anchorCount(SIZE);
  const calls = [];
  return {
    calls,
    Tensor: class { constructor(type, data, dims) { this.type = type; this.data = data; this.dims = dims; } },
    InferenceSession: {
      create: async () => ({
        inputNames: ['images'],
        outputNames: ['output'],
        async run(feeds) {
          calls.push(feeds);
          const data = new Float32Array(anchors * 85);
          for (const [index, r] of Object.entries(rows)) {
            const o = Number(index) * 85;
            data.set([r.cx, r.cy, r.w, r.h, r.obj], o);
            data[o + 5] = r.person;
          }
          return { output: { data, dims: [1, anchors, 85] } };
        },
        async release() {},
      }),
    },
  };
}

async function withModelFile(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'perc-'));
  const modelPath = join(dir, 'model.onnx');
  await writeFile(modelPath, 'not a real model');
  try { return await fn(modelPath); } finally { await rm(dir, { recursive: true, force: true }); }
}

test('detect maps a letterboxed detection back to the normalised source picture', async () => {
  await withModelFile(async (modelPath) => {
    // 16:9 source, so the picture occupies y 91..325 of the square. Person centre at input
    // (208, 208), 104 wide and 117 tall: the middle of the picture, a quarter wide, half tall.
    // Stride 8 cell (gx 25, gy 25) + offset 0.5: ((25 + 0.5) * 8, ...) = (204, 204); use exact values instead:
    // cell (gx 26, gy 26) with offset 0 -> centre (208, 208).
    const row = 26 * 52 + 26;
    const ort = fakeOrt({ [row]: { cx: 0, cy: 0, w: Math.log(13), h: Math.log(14.625), obj: 1, person: 0.9 } });
    const det = await createOnnxDetector({ modelPath, inputSize: SIZE, ort });
    const letterbox = computeLetterbox(1920, 1080, SIZE);
    const frame = { data: Buffer.alloc(SIZE * SIZE * 3, 114), width: SIZE, height: SIZE, letterbox, capturedAt: Date.now() };
    const { objects, framing } = await det.detect(frame);
    assert.equal(framing, null);
    assert.equal(objects.length, 1);
    assert.equal(objects[0].label, 'person');
    assert.ok(Math.abs(objects[0].confidence - 0.9) < 1e-3);
    const b = objects[0].bbox;
    assert.ok(Math.abs(b.x - 0.375) < 0.01, `x ${b.x}`); // (208 - 52) / 416
    assert.ok(Math.abs(b.w - 0.25) < 0.01, `w ${b.w}`);
    assert.ok(Math.abs(b.y - 0.25) < 0.01, `y ${b.y}`); // (208 - 58.5 - 91) / 234
    assert.ok(Math.abs(b.h - 0.5) < 0.01, `h ${b.h}`);
    // The input tensor is NCHW float32.
    assert.deepEqual(ort.calls[0].images.dims, [1, 3, SIZE, SIZE]);
    assert.equal(ort.calls[0].images.type, 'float32');
  });
});

test('detect with no frame (camera off) reports nothing', async () => {
  await withModelFile(async (modelPath) => {
    const det = await createOnnxDetector({ modelPath, inputSize: SIZE, ort: fakeOrt({}) });
    assert.deepEqual(await det.detect(null), { objects: [], framing: null });
  });
});

test('detect rejects a frame of the wrong size instead of guessing', async () => {
  await withModelFile(async (modelPath) => {
    const det = await createOnnxDetector({ modelPath, inputSize: SIZE, ort: fakeOrt({}) });
    await assert.rejects(det.detect({ data: Buffer.alloc(12), width: 2, height: 2, letterbox: computeLetterbox(2, 2, 2) }), /detector input is 416/);
  });
});

test('a missing model file fails with a readable error', async () => {
  await assert.rejects(createOnnxDetector({ modelPath: '/nonexistent/model.onnx', ort: fakeOrt({}) }), /perception model not found/);
  await assert.rejects(createOnnxDetector({ ort: fakeOrt({}) }), /PERCEPTION_MODEL_PATH/);
});

test('createDetector: onnx is the default and never falls back to the stub', async () => {
  await assert.rejects(createDetector({}, {}), /PERCEPTION_MODEL_PATH/);
  await assert.rejects(createDetector({}, { PERCEPTION_MODEL_PATH: '/nonexistent/m.onnx' }), /not found/);
  await assert.rejects(createDetector({ backend: 'nope' }, {}), /unknown perception backend/);
});

test('createDetector: stub only when asked for, by plan or environment', async () => {
  assert.equal(typeof (await createDetector({ backend: 'stub' }, {})).detect, 'function');
  assert.equal(typeof (await createDetector({}, { PERCEPTION_BACKEND: 'stub' })).detect, 'function');
});

test('createDetector reads model path, input size and threshold from the environment', async () => {
  await withModelFile(async (modelPath) => {
    const det = await createDetector({}, { PERCEPTION_MODEL_PATH: modelPath, PERCEPTION_INPUT_SIZE: '416' }, { ort: fakeOrt({}) });
    assert.equal(det.inputSize, 416);
  });
});
