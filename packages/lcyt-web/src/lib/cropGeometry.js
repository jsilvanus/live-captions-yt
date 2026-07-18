/**
 * Pure client-side mirror of `computeCropGeometry()`/`normToPixels()` in
 * `packages/plugins/lcyt-rtmp/src/crop-manager.js` (plan_vertical_crop.md),
 * used to draw the draggable crop rectangle over the incoming preview image
 * before/without asking the server for pixel geometry. Kept in fraction
 * (0..1 of the container) space rather than pixels since the preview image
 * is rendered at an arbitrary CSS size.
 */

const roundEven = (n) => Math.max(2, Math.round(n / 2) * 2);

/**
 * @param {{ inW: number, inH: number, aspectW?: number, aspectH?: number }} args
 * @returns {{ cropW: number, cropH: number, maxX: number, maxY: number } | null}
 */
export function computeCropBox({ inW, inH, aspectW = 9, aspectH = 16 }) {
  if (!inW || !inH) return null;
  let cropH = inH;
  let cropW = roundEven(inH * aspectW / aspectH);
  if (cropW > inW) {
    cropW = roundEven(inW);
    cropH = roundEven(inW * aspectH / aspectW);
    if (cropH > inH) cropH = roundEven(inH);
  }
  return { cropW, cropH, maxX: Math.max(0, inW - cropW), maxY: Math.max(0, inH - cropH) };
}

const clamp01 = (v) => Math.max(0, Math.min(1, Number(v) || 0));

/**
 * Convert a normalised position + box geometry into container-fraction
 * (0..1) left/top/width/height for absolute-positioned CSS.
 * @param {{ xNorm: number, yNorm: number }} pos
 * @param {{ inW: number, inH: number, cropW: number, cropH: number, maxX: number, maxY: number }} geo
 */
export function boxFrac({ xNorm, yNorm }, geo) {
  const { inW, inH, cropW, cropH, maxX, maxY } = geo;
  const x = clamp01(xNorm) * maxX;
  const y = clamp01(yNorm) * maxY;
  return {
    leftFrac:   inW ? x / inW : 0,
    topFrac:    inH ? y / inH : 0,
    widthFrac:  inW ? cropW / inW : 1,
    heightFrac: inH ? cropH / inH : 1,
  };
}

/**
 * Inverse of `boxFrac()` — given where the box's top-left corner landed as a
 * container fraction (0..1), recover the normalised x/y. `widthFrac`/
 * `heightFrac` come from `boxFrac()`'s geometry so the max-travel fraction
 * (1 - widthFrac) matches what was drawn.
 */
export function fracToNorm(leftFrac, topFrac, { widthFrac, heightFrac }) {
  const maxXFrac = 1 - widthFrac;
  const maxYFrac = 1 - heightFrac;
  return {
    xNorm: maxXFrac > 0 ? clamp01(leftFrac / maxXFrac) : 0,
    yNorm: maxYFrac > 0 ? clamp01(topFrac / maxYFrac) : 0,
  };
}
