/**
 * HTTP JPEG frame source for the perception runner (plan_video_perception.md
 * Phase 2 Stream A). Deliberately not a new mechanism: it polls the same
 * already-public preview-JPEG route (`GET /preview/:key/incoming`) that
 * Tracker/Describer already poll from `lcyt-agent`'s
 * `vision-frame-fetcher.js` — a dedicated-feed camera's `prod_cameras.camera_key`
 * IS that route's `:key` (verified against `lcyt-rtmp`'s `rtmp-manager.js`:
 * camera-sourced relays register the camera_key itself as the MediaMTX path
 * name), so no new frame-acquisition endpoint was needed for Phase 2.
 */

/**
 * @param {string} frameUrl — full URL to poll (e.g. `${previewBaseUrl}/preview/${cameraKey}/incoming`)
 * @param {{ fetchImpl?: typeof fetch }} [opts]
 * @returns {{ getFrame: () => Promise<Buffer|null> }}
 */
export function createHttpFrameSource(frameUrl, { fetchImpl = fetch } = {}) {
  return {
    async getFrame() {
      if (!frameUrl) return null;
      try {
        const res = await fetchImpl(frameUrl);
        if (!res.ok) return null; // 404 = camera not currently publishing, not an error
        const buf = Buffer.from(await res.arrayBuffer());
        return buf.length ? buf : null;
      } catch {
        return null;
      }
    },
  };
}
