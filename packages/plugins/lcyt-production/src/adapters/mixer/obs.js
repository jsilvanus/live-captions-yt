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
 * OBS WebSocket v5 is exposed by OBS Studio 28+. Uses the shared OBSClient
 * (obs-client.js) which handles WebSocket connection, authentication, and
 * request/response multiplexing.
 *
 * switchSource maps an integer input number to an OBS scene name via the
 * `inputs` array. This lets the operator page use the same numeric model
 * as hardware mixers while OBS uses named scenes internally.
 *
 * Active source is tracked optimistically: it is updated on every successful
 * switchSource() call. OBS does not push program-tally events in v5 without
 * subscribing to event categories; subscriptions are intentionally omitted
 * to keep the adapter stateless on the OBS side.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { OBSClient } from '../../obs-client.js';

const CONNECT_TIMEOUT_MS = 3_000;

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
      client: null,
      host,
      port,
      password,
      inputs,
      connected: false,
      destroyed: false,
      _activeSource: null,
    };
  }

  const client = new OBSClient({ host, port, password });
  const handle = {
    client,
    host,
    port,
    password,
    inputs,
    connected: false,
    destroyed: false,
    _activeSource: null,
  };

  // Wire up client events to handle
  client.on('connected', () => {
    handle.connected = true;
  });

  client.on('disconnected', () => {
    handle.connected = false;
  });

  // Initiate connection (non-blocking)
  return new Promise((resolve) => {
    client.connect().catch(() => {
      // Connection errors are handled via events
    });
    setTimeout(() => resolve(handle), CONNECT_TIMEOUT_MS);
  });
}

/**
 * Close the OBS WebSocket connection.
 * @param {object} handle
 */
export async function disconnect(handle) {
  handle.destroyed = true;
  if (handle.client) {
    await handle.client.disconnect();
    handle.client = null;
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
  if (!handle.connected || !handle.client) {
    throw new Error(`OBS adapter: ${handle.host}:${handle.port} is not connected`);
  }

  const entry = handle.inputs.find(i => Number(i.number) === Number(inputNumber));
  if (!entry) {
    throw new Error(`OBS adapter: no scene mapped to input ${inputNumber}`);
  }

  await handle.client.call('SetCurrentProgramScene', { sceneName: entry.sceneName });
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
