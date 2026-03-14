/**
 * No-op camera adapter for mixer-only cameras.
 * Satisfies the adapter interface but performs no TCP operations.
 */

export async function connect(_config) {
  return { type: 'none', connected: true };
}

export async function disconnect(_handle) {
  // nothing to close
}

export async function callPreset(_handle, camera, _presetId) {
  throw new Error(`Camera '${camera.name}' has no camera control (controlType: none)`);
}
