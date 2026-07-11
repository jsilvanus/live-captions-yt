/**
 * DSK RTMP stream-name convention (plan_dsk_viewport_settings Phase 4).
 *
 * A per-viewport renderer stream publishes to the `dsk` app under a compound
 * name `<apiKey>__<viewport>` (double-underscore delimiter). A bare name
 * (no `__`) is the program DSK stream — an external OBS/vMix push to
 * `rtmp://server/dsk/<key>` — which triggers the server-side program
 * composite in the relay. Viewport streams must NOT trigger that composite;
 * they are standalone (or fanned out via their own push targets).
 *
 * Real api keys are UUIDs / random alnum and never contain `__`; viewport
 * names are validated to exclude `__` (see routes/dsk-viewports.js), so the
 * delimiter is unambiguous.
 */

export const STREAM_NAME_DELIM = '__';

/**
 * Build the RTMP stream name for a viewport's own renderer stream.
 * @param {string} apiKey
 * @param {string} viewport
 * @returns {string}
 */
export function viewportStreamName(apiKey, viewport) {
  return `${apiKey}${STREAM_NAME_DELIM}${viewport}`;
}

/**
 * Parse an incoming stream name into `{ apiKey, viewport }`. For a bare
 * program stream, `viewport` is null. Splits on the FIRST delimiter so a
 * viewport name is recovered intact even if it (were to) contain underscores.
 * @param {string} name
 * @returns {{ apiKey: string, viewport: string|null }}
 */
export function parseStreamName(name) {
  const i = name.indexOf(STREAM_NAME_DELIM);
  if (i === -1) return { apiKey: name, viewport: null };
  return {
    apiKey: name.slice(0, i),
    viewport: name.slice(i + STREAM_NAME_DELIM.length) || null,
  };
}

/**
 * True when the stream name denotes a per-viewport renderer stream (which
 * must not trigger the program composite).
 * @param {string} name
 * @returns {boolean}
 */
export function isViewportStream(name) {
  return typeof name === 'string' && name.includes(STREAM_NAME_DELIM);
}
