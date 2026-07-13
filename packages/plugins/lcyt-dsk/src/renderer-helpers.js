/**
 * Pure decision helpers for per-viewport renderer streams
 * (plan_dsk_viewport_settings Phase 4, renderer increment).
 *
 * These are the testable seams of the multi-renderer refactor; the actual
 * Chromium page-capture and ffmpeg spawn live in renderer.js and need a live
 * browser + ffmpeg + RTMP to validate.
 */

import { viewportStreamName } from './stream-names.js';

const DEFAULT_PAGE_BASE =
  (process.env.DSK_PAGE_BASE_URL || process.env.DSK_LOCAL_SERVER || 'http://localhost:3000').replace(/\/$/, '');

/**
 * The SPA URL the renderer captures for a viewport. Prefers the project's
 * public slug; falls back to the raw api key (both resolve server-side).
 * @param {{ slug?: string|null, apiKey: string, viewport: string, baseUrl?: string }} opts
 * @returns {string}
 */
export function viewportPageUrl({ slug, apiKey, viewport, baseUrl = DEFAULT_PAGE_BASE }) {
  const base = baseUrl.replace(/\/$/, '');
  const seg = encodeURIComponent(slug || apiKey);
  return `${base}/dsk/${seg}/${encodeURIComponent(viewport)}`;
}

/**
 * Capture dimensions for a viewport, falling back to 1920x1080. When an
 * explicit output-dimension override is provided, it wins for the streamed
 * output; otherwise the viewport's own dimensions are used.
 * @param {{ width?: number, height?: number }|null} viewport
 * @param {{ width?: number, height?: number }|null} outputViewport
 * @returns {{ width: number, height: number }}
 */
export function resolveCaptureDimensions(viewport, outputViewport = null) {
  const fallback = parseDimensionPair(viewport);
  const output = parseDimensionPair(outputViewport);
  const width = output?.width ?? fallback?.width ?? 1920;
  const height = output?.height ?? fallback?.height ?? 1080;
  return { width, height };
}

function parseDimensionPair(viewport) {
  if (!viewport || typeof viewport !== 'object') return {};
  const parsed = {};
  const width = Number(viewport.width);
  const height = Number(viewport.height);
  if (Number.isFinite(width) && width > 0) parsed.width = Math.round(width);
  if (Number.isFinite(height) && height > 0) parsed.height = Math.round(height);
  return parsed;
}

/**
 * Background the renderer should paint behind the page. Alpha does not survive
 * h264, so `transparent` cannot be streamed as-is: when chroma-keying is
 * enabled for this viewport, render against the key color (which the relay
 * then keys out); otherwise `transparent` degrades to black.
 * @param {{ background?: string, stream?: { chromaKey?: { enabled?: boolean, color?: string } } }|null} displaySettings
 * @returns {{ background: string, warnTransparent: boolean }}
 */
export function resolveCaptureBackground(displaySettings) {
  const bg = displaySettings?.background || '#00B140';
  const ck = displaySettings?.stream?.chromaKey;
  if (bg === 'transparent') {
    if (ck?.enabled) return { background: ck.color || '#00B140', warnTransparent: false };
    return { background: '#000000', warnTransparent: true };
  }
  return { background: bg, warnTransparent: false };
}

/**
 * ffmpeg output leg(s) for a viewport stream: the local `dsk` app path (its
 * own `<key>__<viewport>` name so it never triggers the program composite)
 * plus each enabled push target. Returned as an ffmpeg `tee` muxer target
 * string when there is more than one leg, else a single `-f flv <url>`.
 *
 * @param {{ apiKey: string, viewport: string, rtmpBase: string, rtmpApp?: string, pushUrls?: Array<{url:string, enabled?:boolean}> }} opts
 * @returns {{ localUrl: string, targets: string[], teeString: string|null }}
 */
export function buildViewportOutputs({ apiKey, viewport, rtmpBase, rtmpApp = 'dsk', pushUrls = [] }) {
  const base = rtmpBase.replace(/\/$/, '');
  const localUrl = `${base}/${rtmpApp}/${viewportStreamName(apiKey, viewport)}`;
  const pushes = (Array.isArray(pushUrls) ? pushUrls : [])
    .filter(p => p && p.enabled !== false && typeof p.url === 'string' && /^rtmps?:\/\//i.test(p.url.trim()))
    .map(p => p.url.trim());
  const targets = [localUrl, ...pushes];
  // ffmpeg tee wants each output as [f=flv]url, pipe-joined.
  const teeString = targets.length > 1 ? targets.map(u => `[f=flv]${u}`).join('|') : null;
  return { localUrl, targets, teeString };
}
