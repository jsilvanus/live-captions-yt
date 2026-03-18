/**
 * OBS Studio mixer adapter — scene switching via OBS WebSocket v5.
 *
 * connectionConfig shape:
 * {
 *   host:     string,   // OBS machine IP or hostname
 *   port:     number,   // OBS WebSocket port (default 4455)
 *   password: string,   // OBS WebSocket authentication password
 *   inputs: [
 *     { number: number, sceneName: string }
 *   ]
 * }
 *
 * ─── Protocol notes ──────────────────────────────────────────────────────────
 * OBS WebSocket v5 is exposed by OBS Studio 28+. The `obs-websocket-js`
 * library handles the WebSocket handshake, authentication, and request/
 * response multiplexing.
 *
 * switchSource maps an integer input number to an OBS scene name via the
 * `inputs` array. This lets the operator page use the same numeric model
 * as hardware mixers while OBS uses named scenes internally.
 *
 * Active source is tracked optimistically: it is updated on every successful
 * switchSource() call. OBS does not push program-tally events in v5 without
 * subscribing to event categories; subscriptions are intentionally omitted
 * to keep the adapter stateless on the OBS side.
 *
 * Bridge note: OBS WebSocket is not a raw TCP stream. The getSwitchCommand()
 * stub returns an 'obs_switch' typed object so the architecture is forward-
 * compatible if lcyt-bridge gains WebSocket dispatch support, but bridge
 * routing for OBS is not implemented in the current bridge agent.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import OBSWebSocket from 'obs-websocket-js';

const RECONNECT_DELAY_INITIAL_MS = 5_000;
const RECONNECT_DELAY_MAX_MS     = 60_000;
const CONNECT_TIMEOUT_MS         = 3_000;

// ---------------------------------------------------------------------------
// Adapter exports
// ---------------------------------------------------------------------------

/**
 * Open a persistent WebSocket connection to OBS.
 * Resolves immediately (even if OBS is unreachable) so the registry can
 * store the handle and retry transparently.
 *
 * @param {object} config - mixer.connectionConfig
 * @returns {Promise<object>} connection handle
 */
export async function connect(config) {
  const {
    host     = '',
    port     = 4455,
    password = '',
    inputs   = [],
  } = config ?? {};

  if (!host) {
    console.warn('[obs] connectionConfig.host is required');
    return {
      obs: null, host, port, password, inputs,
      connected: false, destroyed: false,
      _activeSource: null, _reconnectTimer: null,
      _reconnectDelay: RECONNECT_DELAY_INITIAL_MS,
    };
  }

  const handle = {
    obs: null,
    host,
    port,
    password,
    inputs,
    connected: false,
    destroyed: false,
    _activeSource: null,
    _reconnectTimer: null,
    _reconnectDelay: RECONNECT_DELAY_INITIAL_MS,
  };

  return new Promise((resolve) => {
    _openConnection(handle, () => resolve(handle));
    setTimeout(() => resolve(handle), CONNECT_TIMEOUT_MS);
  });
}

/**
 * Close the OBS WebSocket connection.
 * @param {object} handle
 */
export async function disconnect(handle) {
  handle.destroyed = true;
  if (handle._reconnectTimer) {
    clearTimeout(handle._reconnectTimer);
    handle._reconnectTimer = null;
  }
  if (handle.obs) {
    try { handle.obs.disconnect(); } catch { /* ignore */ }
    handle.obs = null;
  }
  handle.connected = false;
}

/**
 * Switch the OBS program scene to the one mapped to inputNumber.
 *
 * @param {object} handle
 * @param {number} inputNumber - 1-based mixer input number
 * @param {object} _mixer      - unused (inputs come from handle config)
 */
export async function switchSource(handle, inputNumber, _mixer) {
  if (!handle.connected || !handle.obs) {
    throw new Error(`OBS adapter: ${handle.host}:${handle.port} is not connected`);
  }

  const entry = handle.inputs.find(i => Number(i.number) === Number(inputNumber));
  if (!entry) {
    throw new Error(`OBS adapter: no scene mapped to input ${inputNumber}`);
  }

  await handle.obs.call('SetCurrentProgramScene', { sceneName: entry.sceneName });
  handle._activeSource = inputNumber;
}

/**
 * Return the currently active program input number, or null if unknown.
 * State is maintained optimistically on each switchSource() call.
 *
 * @param {object} handle
 * @returns {number|null}
 */
export function getActiveSource(handle) {
  return handle._activeSource;
}

/**
 * Build the bridge command object for switching to inputNumber.
 * Forward-compatible stub — lcyt-bridge does not yet dispatch 'obs_switch'
 * commands. The password field is included so a future bridge implementation
 * has all the information it needs.
 *
 * @param {object} connectionConfig
 * @param {number} inputNumber
 * @returns {{ type: 'obs_switch', host: string, port: number, password: string, sceneName: string }}
 */
export function getSwitchCommand(connectionConfig, inputNumber) {
  const inputs  = connectionConfig.inputs ?? [];
  const entry   = inputs.find(i => Number(i.number) === Number(inputNumber));
  const sceneName = entry?.sceneName ?? '';
  return {
    type: 'obs_switch',
    host: connectionConfig.host,
    port: connectionConfig.port ?? 4455,
    password: connectionConfig.password ?? '',
    sceneName,
  };
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

function _openConnection(handle, onFirstConnect) {
  if (handle.destroyed) return;

  const obs = new OBSWebSocket();
  handle.obs = obs;

  const url = `ws://${handle.host}:${handle.port}`;

  obs.connect(url, handle.password || undefined)
    .then(() => {
      handle.connected = true;
      handle._reconnectDelay = RECONNECT_DELAY_INITIAL_MS;
      console.info(`[obs] Connected to ${url}`);
      if (onFirstConnect) {
        const cb = onFirstConnect;
        onFirstConnect = null;
        cb();
      }
    })
    .catch((err) => {
      handle.connected = false;
      console.warn(`[obs] ${url} connect error: ${err.message ?? err}`);
      _scheduleReconnect(handle);
    });

  obs.on('ConnectionClosed', () => {
    handle.connected = false;
    if (!handle.destroyed) {
      console.info(`[obs] ${url} disconnected — reconnecting in ${handle._reconnectDelay}ms`);
      _scheduleReconnect(handle);
    }
  });

  obs.on('ConnectionError', (err) => {
    console.warn(`[obs] ${url} connection error: ${err}`);
  });
}

function _scheduleReconnect(handle) {
  if (handle.destroyed || handle._reconnectTimer) return;
  handle._reconnectTimer = setTimeout(() => {
    handle._reconnectTimer = null;
    handle._reconnectDelay = Math.min(handle._reconnectDelay * 2, RECONNECT_DELAY_MAX_MS);
    _openConnection(handle, null);
  }, handle._reconnectDelay);
}
