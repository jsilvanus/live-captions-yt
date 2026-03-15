/**
 * AMX NetLinx camera control adapter.
 *
 * controlConfig shape:
 * {
 *   host: string,
 *   port: number,          // typically 1319
 *   presets: [
 *     { id: string, name: string, command: string }
 *   ]
 * }
 *
 * The `command` string is sent verbatim over TCP — no parsing or validation.
 * Example: "SEND_COMMAND dvCam,'PRESET-1'"
 */

import { createConnection } from 'node:net';

const RECONNECT_DELAY_MS = 5_000;
const KEEPALIVE_INTERVAL_MS = 30_000;

/**
 * Open a TCP connection to the AMX NetLinx master.
 * Returns a connection handle used by callPreset / disconnect.
 *
 * @param {object} config - camera.controlConfig
 * @returns {Promise<object>} connection handle
 */
export async function connect(config) {
  return new Promise((resolve, reject) => {
    const { host, port } = config;
    if (!host || !port) {
      return reject(new Error('AMX adapter: controlConfig must include host and port'));
    }

    const handle = {
      socket: null,
      host,
      port,
      connected: false,
      destroyed: false,
      _reconnectTimer: null,
      _keepaliveTimer: null,
    };

    function doConnect() {
      const socket = createConnection({ host, port }, () => {
        handle.connected = true;
        socket.setKeepAlive(true, KEEPALIVE_INTERVAL_MS);
        console.info(`[amx] Connected to ${host}:${port}`);
      });

      socket.on('error', (err) => {
        handle.connected = false;
        console.warn(`[amx] ${host}:${port} error: ${err.message}`);
      });

      socket.on('close', () => {
        handle.connected = false;
        if (!handle.destroyed) {
          console.info(`[amx] ${host}:${port} disconnected — reconnecting in ${RECONNECT_DELAY_MS}ms`);
          handle._reconnectTimer = setTimeout(doConnect, RECONNECT_DELAY_MS);
        }
      });

      handle.socket = socket;
    }

    // Attempt first connection; resolve immediately so the backend can start
    // without blocking on unreachable hardware.
    const socket = createConnection({ host, port }, () => {
      handle.connected = true;
      handle.socket = socket;
      socket.setKeepAlive(true, KEEPALIVE_INTERVAL_MS);
      console.info(`[amx] Connected to ${host}:${port}`);
      resolve(handle);
    });

    socket.once('error', (err) => {
      // Initial connection failed — still resolve so the registry can store
      // the handle and retry on next command or reconnect timer.
      handle.connected = false;
      handle.socket = socket;
      console.warn(`[amx] Initial connect to ${host}:${port} failed: ${err.message} — will retry`);
      // Schedule reconnect
      handle._reconnectTimer = setTimeout(() => {
        handle.socket = null;
        doConnect.call({ handle });
      }, RECONNECT_DELAY_MS);
      resolve(handle);
    });

    socket.on('close', () => {
      if (handle.destroyed) return;
      handle.connected = false;
      console.info(`[amx] ${host}:${port} closed — reconnecting in ${RECONNECT_DELAY_MS}ms`);
      handle._reconnectTimer = setTimeout(() => {
        const s = createConnection({ host, port }, () => {
          handle.connected = true;
          handle.socket = s;
          s.setKeepAlive(true, KEEPALIVE_INTERVAL_MS);
          console.info(`[amx] Reconnected to ${host}:${port}`);
        });
        s.on('error', (err) => {
          handle.connected = false;
          console.warn(`[amx] Reconnect error ${host}:${port}: ${err.message}`);
        });
        s.on('close', () => {
          if (!handle.destroyed) {
            handle.connected = false;
            handle._reconnectTimer = setTimeout(arguments.callee, RECONNECT_DELAY_MS);
          }
        });
        handle.socket = s;
      }, RECONNECT_DELAY_MS);
    });

    handle.socket = socket;
  });
}

/**
 * Cleanly close the TCP connection.
 * @param {object} handle
 */
export async function disconnect(handle) {
  handle.destroyed = true;
  if (handle._reconnectTimer) clearTimeout(handle._reconnectTimer);
  if (handle.socket) {
    handle.socket.destroy();
    handle.socket = null;
  }
  handle.connected = false;
}

/**
 * Trigger a named preset on the camera.
 * Looks up presetId in camera.controlConfig.presets and sends the command string verbatim.
 *
 * @param {object} handle - from connect()
 * @param {object} camera - camera row from DB (with controlConfig parsed as object)
 * @param {string} presetId
 * @throws if preset not found or TCP write fails
 */
export async function callPreset(handle, camera, presetId) {
  const presets = camera.controlConfig?.presets ?? [];
  const preset = presets.find(p => p.id === presetId);
  if (!preset) {
    throw new Error(`AMX adapter: unknown preset '${presetId}' for camera '${camera.name}'`);
  }

  if (!handle.connected || !handle.socket) {
    throw new Error(`AMX adapter: device ${handle.host}:${handle.port} is not connected`);
  }

  return new Promise((resolve, reject) => {
    const payload = preset.command + '\r\n';
    handle.socket.write(payload, 'utf8', (err) => {
      if (err) return reject(new Error(`AMX adapter: TCP write failed: ${err.message}`));
      resolve();
    });
  });
}
