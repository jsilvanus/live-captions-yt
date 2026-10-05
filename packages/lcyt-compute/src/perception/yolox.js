/**
 * YOLOX output decoding, pure functions (no onnxruntime), so they can be tested with synthetic tensors.
 *
 * The official YOLOX ONNX exports (decode_in_inference off) output one row per anchor,
 * `[cx, cy, w, h, objectness, class scores...]`, with centre and size still in grid units: the
 * centre is `(raw + grid) * stride`, the size `exp(raw) * stride`. Anchors run over the strides
 * 8, 16, 32 in that order, row-major per stride. The input is BGR, 0..255, NCHW, no normalisation.
 */

export const STRIDES = [8, 16, 32];
/** COCO class index of "person". */
export const PERSON_CLASS = 0;

/** Number of anchor rows a YOLOX model with this input size outputs. */
export function anchorCount(size, strides = STRIDES) {
  return strides.reduce((n, s) => n + (size / s) * (size / s), 0);
}

/**
 * @param {Float32Array|number[]} data  flat `[anchors, 5 + classes]` output
 * @param {number} anchors
 * @param {number} size   detector input side
 * @param {{ classes?: number, classIndex?: number, minScore?: number, decode?: boolean, strides?: number[] }} [opts]
 * @returns {Array<{ x: number, y: number, w: number, h: number, score: number }>} candidates in input pixels (top-left x, y)
 */
export function decodeCandidates(data, anchors, size, { classes = 80, classIndex = PERSON_CLASS, minScore = 0.3, decode = true, strides = STRIDES } = {}) {
  const stride = 5 + classes;
  const out = [];
  let row = 0;
  const emit = (gx, gy, s) => {
    const o = row * stride;
    row++;
    const score = data[o + 4] * data[o + 5 + classIndex];
    if (score < minScore) return;
    let cx = data[o];
    let cy = data[o + 1];
    let w = data[o + 2];
    let h = data[o + 3];
    if (decode) {
      cx = (cx + gx) * s;
      cy = (cy + gy) * s;
      w = Math.exp(w) * s;
      h = Math.exp(h) * s;
    }
    out.push({ x: cx - w / 2, y: cy - h / 2, w, h, score });
  };
  if (decode) {
    for (const s of strides) {
      const n = size / s;
      for (let gy = 0; gy < n; gy++) for (let gx = 0; gx < n; gx++) if (row < anchors) emit(gx, gy, s);
    }
  } else {
    for (let i = 0; i < anchors; i++) emit(0, 0, 1);
  }
  return out;
}

function iou(a, b) {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}

/** Greedy non-maximum suppression; highest score first. */
export function nms(boxes, iouThreshold = 0.45) {
  const sorted = [...boxes].sort((a, b) => b.score - a.score);
  const kept = [];
  for (const box of sorted) {
    if (kept.every((k) => iou(k, box) < iouThreshold)) kept.push(box);
  }
  return kept;
}

/** RGB bytes (`size*size*3`, interleaved) to a float32 NCHW BGR tensor body, 0..255. */
export function rgbToTensor(rgb, size) {
  const plane = size * size;
  const out = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    const p = i * 3;
    out[i] = rgb[p + 2]; // B
    out[plane + i] = rgb[p + 1]; // G
    out[2 * plane + i] = rgb[p]; // R
  }
  return out;
}
