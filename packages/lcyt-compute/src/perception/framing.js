/**
 * Rule-based framing score from person boxes (no model): is the main subject well placed in shot?
 *
 * The subject is the biggest tracked person. Four parts, each 0..1, combined with weights:
 *  - size: tall enough to read (height >= 0.35 of the frame is full marks) but not crushed (above 0.9 loses points);
 *  - headroom: a little space above the head (top edge between 3% and 20% is full marks; touching or cut off by the top scores low);
 *  - centring: centre within 20% of the frame middle is full marks, 0 at the frame edge;
 *  - edges: not cut off at the left or right edge.
 * Returns `null` when nobody is in shot. `notes` lists what is wrong, empty for a good shot.
 */

export const DEFAULT_WEIGHTS = { size: 0.35, headroom: 0.25, centring: 0.25, edges: 0.15 };

const clamp01 = (v) => Math.min(Math.max(v, 0), 1);
const ramp = (v, zero, one) => clamp01((v - zero) / (one - zero));

/**
 * @param {Array<{ label: string, bbox: { x: number, y: number, w: number, h: number } }>} objects
 * @param {{ weights?: typeof DEFAULT_WEIGHTS }} [opts]
 * @returns {{ score: number, notes: string[], subject: object } | null}
 */
export function scoreFraming(objects, { weights = DEFAULT_WEIGHTS } = {}) {
  const people = (objects || []).filter((o) => o.label === 'person' && o.bbox);
  if (!people.length) return null;
  const subject = people.reduce((best, o) => (o.bbox.w * o.bbox.h > best.bbox.w * best.bbox.h ? o : best));
  const { x, y, w, h } = subject.bbox;
  const notes = [];

  let size = ramp(h, 0.15, 0.35);
  if (h > 0.9) size = Math.min(size, 1 - (h - 0.9) * 5);
  if (h < 0.35) notes.push('subject small in frame');
  if (h > 0.9) notes.push('subject too tight');

  let headroom;
  if (y < 0.01) { headroom = 0.3; notes.push('head cut off at the top'); }
  else if (y <= 0.2) headroom = y < 0.03 ? 0.6 + (y - 0.01) * 20 : 1;
  else { headroom = 1 - ramp(y, 0.2, 0.45); notes.push('too much space above'); }

  const off = Math.abs(x + w / 2 - 0.5);
  const centring = 1 - ramp(off, 0.2, 0.5);
  if (off > 0.2) notes.push(x + w / 2 < 0.5 ? 'subject left of centre' : 'subject right of centre');

  const cutEdge = x < 0.01 || x + w > 0.99;
  const edges = cutEdge ? 0.4 : 1;
  if (cutEdge) notes.push('subject cut off at the side');

  const total = weights.size + weights.headroom + weights.centring + weights.edges;
  const score = (weights.size * size + weights.headroom * clamp01(headroom) + weights.centring * centring + weights.edges * edges) / total;
  return { score: Math.round(clamp01(score) * 1000) / 1000, notes, subject: subject.bbox };
}
