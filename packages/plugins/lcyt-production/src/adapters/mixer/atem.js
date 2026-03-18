/**
 * Blackmagic ATEM mixer adapter — UDP remote control via atem-connection.
 *
 * connectionConfig shape:
 * {
 *   host:     string,   // ATEM IP address
 *   meIndex?: number    // 0-based M/E index (0 = M/E 1). Defaults to 0.
 * }
 *
 * ─── Protocol notes ──────────────────────────────────────────────────────────
 * ATEM uses a proprietary UDP protocol on port 9910. The atem-connection library
 * handles the handshake, state sync, and command sending internally. Unlike the
 * Roland/AMX TCP adapters, there is no raw command string to construct — the
 * library abstracts the protocol entirely.
 *
 * IMPORTANT: ATEM is a UDP-based device. It cannot be tested with a simple TCP
 * connection probe. The test route in mixers.js guards against this.
 *
 * Deployment note: because ATEM devices are almost always on an isolated AV
 * network, the normal deployment is via lcyt-bridge (which runs on-site).
 * When a mixer is assigned to a bridge instance, mixers.js routes the switch
 * command through the bridge as an 'atem_switch' SSE command rather than
 * calling switchSource() directly. The connect/disconnect/switchSource
 * functions here are used only in the direct-connection case (no bridge).
 *
 * changeProgramInput signature: changeProgramInput(input, me = 0)
 *   — input is 1-based; me is 0-based M/E index
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { Atem } from 'atem-connection';

// ---------------------------------------------------------------------------
// Reconnect config
// ---------------------------------------------------------------------------

const RECONNECT_DELAY_INITIAL_MS = 5_000;
const RECONNECT_DELAY_MAX_MS = 60_000;
const CONNECT_TIMEOUT_MS = 3_000; // resolve early-return timeout (same as Roland)

// ---------------------------------------------------------------------------
// Adapter exports
// ---------------------------------------------------------------------------

/**
 * Open a persistent UDP connection to the ATEM.
 * Resolves immediately (even if device is unreachable) so the registry can
 * store the handle and retry transparently.
 *
 * @param {object} config - mixer.connectionConfig
 * @param {string} config.host
 * @param {number} [config.meIndex=0]  0-based M/E index
 * @returns {Promise<object>} connection handle
 */
export async function connect(config) {
  const { host, meIndex = 0 } = config ?? {};

  if (!host) {
    console.warn('[atem] connectionConfig.host is required');
    return { atem: null, host: '', meIndex, connected: false, destroyed: false, _reconnectTimer: null, _reconnectDelay: RECONNECT_DELAY_INITIAL_MS };
  }

  const handle = {
    atem: null,
    host,
    meIndex,
    connected: false,
    destroyed: false,
    _reconnectTimer: null,
    _reconnectDelay: RECONNECT_DELAY_INITIAL_MS,
  };

  let earlyResolve;
  const promise = new Promise((resolve) => {
    earlyResolve = resolve;
    _openConnection(handle, () => resolve(handle));
    // If first connect hasn't fired within timeout, resolve anyway
    setTimeout(() => resolve(handle), CONNECT_TIMEOUT_MS);
  });

  return promise;
}

/**
 * Cleanly close the ATEM connection.
 * @param {object} handle
 */
export async function disconnect(handle) {
  handle.destroyed = true;
  if (handle._reconnectTimer) {
    clearTimeout(handle._reconnectTimer);
    handle._reconnectTimer = null;
  }
  if (handle.atem) {
    try { handle.atem.disconnect(); } catch { /* ignore */ }
    handle.atem = null;
  }
  handle.connected = false;
}

/**
 * Switch the program bus to the given input number (1-based).
 *
 * @param {object} handle
 * @param {number} inputNumber - 1-based mixer input number
 * @param {object} _mixer      - unused (meIndex comes from handle config)
 */
export async function switchSource(handle, inputNumber, _mixer) {
  if (!handle.connected || !handle.atem) {
    throw new Error(`ATEM ${handle.host} is not connected`);
  }
  // changeProgramInput(input, me) — input first, me second
  await handle.atem.changeProgramInput(inputNumber, handle.meIndex);
}

/**
 * Return the currently active program input number, or null if unknown.
 * State is maintained live by the atem-connection library.
 *
 * @param {object} handle
 * @returns {number|null}
 */
export function getActiveSource(handle) {
  return handle.atem?.state?.video?.mixEffects?.[handle.meIndex]?.programInput ?? null;
}

/**
 * Build the bridge command object for switching to inputNumber.
 * Used by mixers.js bridge routing — returns a typed command object (not a
 * raw TCP string like Roland/AMX).
 *
 * @param {object} connectionConfig
 * @param {number} inputNumber
 * @returns {{ type: 'atem_switch', host: string, meIndex: number, inputNumber: number }}
 */
export function getSwitchCommand(connectionConfig, inputNumber) {
  return {
    type: 'atem_switch',
    host: connectionConfig.host,
    meIndex: connectionConfig.meIndex ?? 0,
    inputNumber,
  };
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

function _openConnection(handle, onFirstConnect) {
  if (handle.destroyed) return;

  const atem = new Atem();
  handle.atem = atem;

  atem.on('connected', () => {
    handle.connected = true;
    handle._reconnectDelay = RECONNECT_DELAY_INITIAL_MS; // reset backoff on success
    console.info(`[atem] Connected to ${handle.host}`);
    if (onFirstConnect) {
      const cb = onFirstConnect;
      onFirstConnect = null;
      cb();
    }
  });

  atem.on('disconnected', () => {
    handle.connected = false;
    if (!handle.destroyed) {
      console.info(`[atem] ${handle.host} disconnected — reconnecting in ${handle._reconnectDelay}ms`);
      handle._reconnectTimer = setTimeout(() => {
        handle._reconnectTimer = null;
        handle._reconnectDelay = Math.min(handle._reconnectDelay * 2, RECONNECT_DELAY_MAX_MS);
        _openConnection(handle, null);
      }, handle._reconnectDelay);
    }
  });

  atem.on('error', (err) => {
    console.warn(`[atem] ${handle.host} error: ${err}`);
  });

  atem.connect(handle.host);
}
