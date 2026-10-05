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
 * 404 is the one expected non-ok status (camera not currently publishing —
 * `previewManager.fetchThumbnail`'s documented behavior for an offline
 * path) and resolves to `null`, same as before. Anything else — another
 * HTTP status (5xx from a backend outage, 401/403 from a misconfigured
 * `frameUrl`) or a network-level failure (DNS, timeout, connection reset) —
 * now throws instead of silently collapsing to `null`, so
 * `runner.js`'s tick() (which already wraps `getFrame()` in a try/catch
 * that calls `onError()`) surfaces it instead of reporting an indefinite
 * stream of `visible:false` detections indistinguishable from "camera
 * legitimately offline" (code-review fix).
 *
 * @param {string} frameUrl — full URL to poll (e.g. `${previewBaseUrl}/preview/${cameraKey}/incoming`)
 * @param {{ fetchImpl?: typeof fetch }} [opts]
 * @returns {{ getFrame: () => Promise<Buffer|null> }}
 */
export function createHttpFrameSource(frameUrl, { fetchImpl = fetch } = {}) {
  return {
    async getFrame() {
      if (!frameUrl) return null;
      let res;
      try {
        res = await fetchImpl(frameUrl);
      } catch (err) {
        throw new Error(`frame fetch failed: ${err && err.message}`);
      }
      if (!res.ok) {
        if (res.status === 404) return null;
        throw new Error(`frame fetch returned ${res.status}`);
      }
      const buf = Buffer.from(await res.arrayBuffer());
      return buf.length ? buf : null;
    },
  };
}
