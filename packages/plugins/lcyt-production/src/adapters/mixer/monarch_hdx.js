/**
 * Matrox Monarch HDx mixer adapter — HTTP control via lcyt-bridge.
 *
 * Because the Monarch HDx exposes an HTTP API and is typically on an isolated
 * AV network, this adapter ALWAYS routes commands through the bridge agent
 * using the 'http_request' command type. It does NOT open a direct connection
 * from the backend server.
 *
 * connectionConfig shape:
 * {
 *   host:       string,           // Monarch HDx IP address
 *   username?:  string,           // Default: 'admin'
 *   password?:  string,           // Default: 'admin'
 *   protocol?:  'http' | 'https', // Default: 'http'
 *   encoderNumber?: 1 | 2,        // Which encoder to control. Default: 1
 * }
 *
 * switchSource semantics for this adapter:
 *   inputNumber === 0 → stop encoder
 *   inputNumber >= 1  → start encoder (input number is ignored; Monarch uses
 *                        SDI/HDMI video input selection separately)
 *
 * RTMP configuration is done separately via the encoder connectionConfig fields:
 *   rtmpUrl?:        string  (e.g. 'rtmp://a.rtmp.youtube.com/live2')
 *   rtmpStreamName?: string  (e.g. 'xxxx-xxxx-xxxx-xxxx')
 *
 * getSwitchCommand() returns an http_request command object, which
 * BridgeManager sends to the bridge agent as-is.
 */

// ---------------------------------------------------------------------------
// Adapter exports
// ---------------------------------------------------------------------------

/**
 * "Connect" to a Monarch HDx.
 * HTTP is stateless, so this is a no-op that always returns a connected handle.
 *
 * @param {object} config - mixer.connectionConfig
 * @returns {Promise<object>} connection handle
 */
export async function connect(config) {
  const {
    host,
    username = 'admin',
    password = 'admin',
    protocol = 'http',
    encoderNumber = 1,
  } = config ?? {};

  return {
    host:          host ?? '',
    username,
    password,
    protocol,
    encoderNumber,
    connected:     !!host,
    destroyed:     false,
    /** Updated optimistically on switchSource(); actual state is not polled. */
    _activeSource: null,
  };
}

/**
 * Disconnect — no-op for HTTP.
 * @param {object} handle
 */
export async function disconnect(handle) {
  handle.destroyed = true;
  handle.connected = false;
}

/**
 * Switch the Monarch encoder state.
 *
 * NOTE: In normal production use this path is never taken because the mixer
 * is always assigned to a bridge instance. BridgeManager calls getSwitchCommand()
 * to get the http_request command, dispatches it to the bridge, and the bridge
 * makes the HTTP call directly to the Monarch.
 *
 * This direct implementation is provided as a fallback when no bridge is
 * assigned — it makes the HTTP call from the backend server. This only works
 * if the backend server can reach the Monarch directly.
 *
 * @param {object} handle
 * @param {number} inputNumber  0 = stop encoder, ≥1 = start encoder
 */
export async function switchSource(handle, inputNumber, _mixer) {
  if (!handle.host) {
    throw new Error('Monarch HDx: connectionConfig.host is required');
  }

  const { url, method, headers, body } = buildRequest(handle, inputNumber);
  const init = { method, headers: { ...headers } };
  if (body) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  const response = await fetch(url, init);
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Monarch HDx HTTP ${response.status}: ${text}`);
  }
  handle._activeSource = inputNumber > 0 ? inputNumber : 0;
}

/**
 * Return the current active source (1 = encoding, 0 = stopped, null = unknown).
 * Updated optimistically by switchSource().
 *
 * @param {object} handle
 * @returns {number|null}
 */
export function getActiveSource(handle) {
  return handle._activeSource;
}

/**
 * Build the bridge command object for starting or stopping the encoder.
 * Called by mixers.js bridge routing — BridgeManager sends this to the bridge
 * as an 'http_request' command.
 *
 * @param {object} connectionConfig
 * @param {number} inputNumber  0 = stop, ≥1 = start
 * @returns {{ type: 'http_request', method: string, url: string, headers: object, body?: object }}
 */
export function getSwitchCommand(connectionConfig, inputNumber) {
  const handle = {
    host:          connectionConfig.host,
    username:      connectionConfig.username ?? 'admin',
    password:      connectionConfig.password ?? 'admin',
    protocol:      connectionConfig.protocol ?? 'http',
    encoderNumber: connectionConfig.encoderNumber ?? 1,
  };
  return { type: 'http_request', ...buildRequest(handle, inputNumber) };
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

/**
 * Build the HTTP request parameters for a start or stop command.
 * Returns an object suitable both for direct fetch() calls and for the
 * bridge 'http_request' command payload.
 *
 * @param {object} handle
 * @param {number} inputNumber  0 = stop, ≥1 = start
 * @returns {{ method: string, url: string, headers: object, body?: object }}
 */
function buildRequest(handle, inputNumber) {
  const { host, username, password, protocol, encoderNumber } = handle;
  const auth = Buffer.from(`${username}:${password}`).toString('base64');
  const baseUrl = `${protocol}://${host}`;
  const action = inputNumber > 0 ? 'start' : 'stop';

  return {
    method:  'POST',
    url:     `${baseUrl}/Monarch/sdk/encoder${encoderNumber}/${action}`,
    headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/json' },
    // Monarch API requires a POST body; an empty object satisfies the requirement.
    body:    {},
  };
}
