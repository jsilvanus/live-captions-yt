/**
 * Letterbox geometry shared by the frame sources and the detector backends.
 *
 * A detector takes a square `size` x `size` input. The source picture is scaled to fit and padded
 * (grey), which keeps the aspect ratio; boxes found in the padded square are mapped back to the
 * source picture and normalised to 0..1, which is the unit the perception contract uses.
 */

/** Grey used for the padding (YOLOX convention). */
export const PAD_VALUE = 114;

/**
 * @param {number} srcW
 * @param {number} srcH
 * @param {number} size  side of the square detector input
 * @returns {{ size: number, srcW: number, srcH: number, scale: number, newW: number, newH: number, padX: number, padY: number }}
 */
export function computeLetterbox(srcW, srcH, size) {
  if (!(srcW > 0) || !(srcH > 0) || !(size > 0)) throw new Error(`invalid letterbox ${srcW}x${srcH} -> ${size}`);
  const scale = Math.min(size / srcW, size / srcH);
  // Even sizes keep ffmpeg's yuv scaling happy.
  const newW = Math.max(2, Math.round((srcW * scale) / 2) * 2);
  const newH = Math.max(2, Math.round((srcH * scale) / 2) * 2);
  const padX = Math.floor((size - newW) / 2);
  const padY = Math.floor((size - newH) / 2);
  return { size, srcW, srcH, scale, newW, newH, padX, padY };
}

/**
 * Map a box in letterboxed pixels (x, y, w, h) to the normalised source picture, clamped to 0..1.
 * @param {{ x: number, y: number, w: number, h: number }} box
 * @param {ReturnType<typeof computeLetterbox>} lb
 */
export function boxToNormalized(box, lb) {
  const x1 = Math.min(Math.max((box.x - lb.padX) / lb.newW, 0), 1);
  const y1 = Math.min(Math.max((box.y - lb.padY) / lb.newH, 0), 1);
  const x2 = Math.min(Math.max((box.x + box.w - lb.padX) / lb.newW, 0), 1);
  const y2 = Math.min(Math.max((box.y + box.h - lb.padY) / lb.newH, 0), 1);
  const round = (v) => Math.round(v * 1000) / 1000;
  return { x: round(x1), y: round(y1), w: round(x2 - x1), h: round(y2 - y1) };
}

/** ffmpeg `-vf` chain that scales a picture to the letterbox and pads it to the square. */
export function letterboxFilter(lb) {
  const grey = PAD_VALUE.toString(16).padStart(2, '0').repeat(3);
  return `scale=${lb.newW}:${lb.newH}:flags=bilinear,pad=${lb.size}:${lb.size}:${lb.padX}:${lb.padY}:color=0x${grey}`;
}

/**
 * Width and height of a JPEG from its header (start-of-frame marker), or null when it is not one.
 * @param {Buffer} buf
 */
export function jpegSize(buf) {
  if (!buf || buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const marker = buf[i + 1];
    if (marker === 0xff) { i++; continue; }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    const len = buf.readUInt16BE(i + 2);
    // SOF0..SOF15 except DHT (c4), JPG (c8) and DAC (cc)
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
    }
    i += 2 + len;
  }
  return null;
}
