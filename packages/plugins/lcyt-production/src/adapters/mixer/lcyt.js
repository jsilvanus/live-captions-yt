/**
 * LCYT Software Mixer adapter.
 *
 * The actual compositing happens in the browser (LcytMixerPage) via a
 * canvas + WebRTC WHIP pipeline. This adapter:
 *  - Has no backend TCP/WebSocket connection.
 *  - Tracks the last-selected input number in memory so the operator
 *    page can display the active source.
 *  - Returns null from getSwitchCommand() so the switch route skips
 *    bridge dispatch and falls through to registry.switchSource().
 */

export async function connect(_config) {
  return { type: 'lcyt', connected: true, _activeSource: null };
}

export async function disconnect(_handle) {
  // nothing to close
}

export async function switchSource(handle, inputNumber, _mixer) {
  handle._activeSource = inputNumber;
}

export function getActiveSource(handle) {
  return handle?._activeSource ?? null;
}

/**
 * No bridge command needed for the software mixer — switching is
 * handled entirely in the browser. Return null so the switch route
 * skips bridge dispatch.
 */
export function getSwitchCommand(_connectionConfig, _inputNumber) {
  return null;
}
