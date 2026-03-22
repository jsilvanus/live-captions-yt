/**
 * Browser camera adapter for webcam and mobile camera types.
 * Streaming is performed entirely browser-side via WebRTC WHIP;
 * there is nothing for the backend to connect to.
 *
 * Satisfies the camera adapter interface (connect / disconnect / callPreset)
 * but performs no network operations.
 */

export async function connect(_config) {
  return { type: 'browser', connected: true };
}

export async function disconnect(_handle) {
  // nothing to close — streaming is browser-side
}

export async function callPreset(_handle, camera, _presetId) {
  throw new Error(`Camera '${camera.name}' is a browser camera — PTZ presets are not supported`);
}
