/**
 * VISCA-IP camera control adapter.
 *
 * controlConfig shape:
 * {
 *   host:           string,           // camera IP address
 *   port:           number,           // UDP default: 52381 (Sony); TCP varies by model
 *   protocol:       'udp' | 'tcp',    // default 'udp'
 *   cameraAddress:  number,           // VISCA camera address 1–7, default 1
 *   presets: [
 *     { id: string, name: string, presetNumber: number }
 *   ]
 * }
 *
 * ─── Protocol notes ──────────────────────────────────────────────────────────
 * VISCA is a binary serial protocol. When tunnelled over IP:
 *   • UDP (Sony, PTZOptics default): port 52381, stateless — one packet per command.
 *   • TCP (some Panasonic / PTZOptics TCP mode): persistent connection.
 *
 * Preset recall packet (7 bytes):
 *   8x 01 04 3F 02 pp FF
 *   x  = camera address (1–7); for direct-IP cameras this is always 1.
 *   pp = preset slot number (0x00–0x7F, i.e. 0–127).
 *
 * ACK/completion responses are not awaited — cameras on a local LAN are
 * reliable enough that fire-and-forget is appropriate for preset recall.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { createSocket } from 'node:dgram';
import { createConnection } from 'node:net';

const RECONNECT_DELAY_INITIAL_MS = 5_000;
const RECONNECT_DELAY_MAX_MS     = 60_000;

// ---------------------------------------------------------------------------
// Adapter exports
// ---------------------------------------------------------------------------

/**
 * Open a connection to the VISCA-IP camera (UDP socket or persistent TCP).
 * Resolves immediately so the registry can store the handle without blocking
 * on unreachable hardware.
 *
 * @param {object} config - camera.controlConfig
 * @returns {Promise<object>} connection handle
 */
export async function connect(config) {
  const {
    host,
    port           = 52381,
    protocol       = 'udp',
    cameraAddress  = 1,
  } = config ?? {};

  if (!host) {
    console.warn('[visca-ip] controlConfig.host is required');
    return { host: '', port, protocol, cameraAddress, connected: false, destroyed: false };
  }

  if (protocol === 'tcp') {
    return _connectTcp({ host, port, cameraAddress });
  }

  // UDP — connectionless, socket is created once and kept open.
  return _connectUdp({ host, port, cameraAddress });
}

/**
 * Close the connection.
 * @param {object} handle
 */
export async function disconnect(handle) {
  handle.destroyed = true;

  if (handle._reconnectTimer) {
    clearTimeout(handle._reconnectTimer);
    handle._reconnectTimer = null;
  }

  if (handle.protocol === 'tcp') {
    if (handle.socket) {
      handle.socket.destroy();
      handle.socket = null;
    }
  } else {
    if (handle.socket) {
      try { handle.socket.close(); } catch { /* ignore */ }
      handle.socket = null;
    }
  }

  handle.connected = false;
}

/**
 * Recall a preset on the camera.
 * Looks up presetId in camera.controlConfig.presets and sends the VISCA
 * preset-recall packet.
 *
 * @param {object} handle  - from connect()
 * @param {object} camera  - camera row (controlConfig parsed)
 * @param {string} presetId
 */
export async function callPreset(handle, camera, presetId) {
  const presets = camera.controlConfig?.presets ?? [];
  const preset  = presets.find(p => p.id === presetId);
  if (!preset) {
    throw new Error(`VISCA-IP adapter: unknown preset '${presetId}' for camera '${camera.name}'`);
  }

  const presetNumber = Number(preset.presetNumber);
  if (!Number.isInteger(presetNumber) || presetNumber < 0 || presetNumber > 127) {
    throw new Error(`VISCA-IP adapter: invalid presetNumber '${preset.presetNumber}' — must be 0–127`);
  }

  const cameraAddress = handle.cameraAddress ?? 1;
  const packet = Buffer.from([
    0x80 | cameraAddress,  // header byte: 8x
    0x01, 0x04, 0x3F,      // command group: preset memory
    0x02,                  // recall
    presetNumber,
    0xFF,                  // terminator
  ]);

  if (handle.protocol === 'tcp') {
    if (!handle.connected || !handle.socket) {
      throw new Error(`VISCA-IP adapter: ${handle.host}:${handle.port} is not connected`);
    }
    return new Promise((resolve, reject) => {
      handle.socket.write(packet, (err) => {
        if (err) return reject(new Error(`VISCA-IP adapter: TCP write failed: ${err.message}`));
        resolve();
      });
    });
  }

  // UDP — fire and forget; resolve immediately.
  return new Promise((resolve, reject) => {
    handle.socket.send(packet, handle.port, handle.host, (err) => {
      if (err) return reject(new Error(`VISCA-IP adapter: UDP send failed: ${err.message}`));
      resolve();
    });
  });
}

// ---------------------------------------------------------------------------
// Internal — UDP
// ---------------------------------------------------------------------------

function _connectUdp({ host, port, cameraAddress }) {
  const socket = createSocket('udp4');

  socket.on('error', (err) => {
    console.warn(`[visca-ip] UDP socket error (${host}:${port}): ${err.message}`);
  });

  // Bind to an ephemeral local port so the OS assigns one.
  socket.bind(() => {
    console.info(`[visca-ip] UDP socket ready for ${host}:${port}`);
  });

  return Promise.resolve({
    protocol: 'udp',
    socket,
    host,
    port,
    cameraAddress,
    connected: true,   // UDP is connectionless; we report connected once socket is bound
    destroyed: false,
    _reconnectTimer: null,
  });
}

// ---------------------------------------------------------------------------
// Internal — TCP
// ---------------------------------------------------------------------------

function _connectTcp({ host, port, cameraAddress }) {
  const handle = {
    protocol: 'tcp',
    socket: null,
    host,
    port,
    cameraAddress,
    connected: false,
    destroyed: false,
    _reconnectTimer: null,
    _reconnectDelay: RECONNECT_DELAY_INITIAL_MS,
  };

  return new Promise((resolve) => {
    _openTcpConnection(handle, () => resolve(handle));
    // Resolve early if first connect hangs (e.g. camera offline).
    setTimeout(() => resolve(handle), 3_000);
  });
}

function _openTcpConnection(handle, onFirstConnect) {
  if (handle.destroyed) return;

  const socket = createConnection({ host: handle.host, port: handle.port }, () => {
    handle.connected = true;
    handle._reconnectDelay = RECONNECT_DELAY_INITIAL_MS;
    console.info(`[visca-ip] TCP connected to ${handle.host}:${handle.port}`);
    if (onFirstConnect) {
      const cb = onFirstConnect;
      onFirstConnect = null;
      cb();
    }
  });

  socket.on('error', (err) => {
    handle.connected = false;
    console.warn(`[visca-ip] TCP ${handle.host}:${handle.port} error: ${err.message}`);
  });

  socket.on('close', () => {
    handle.connected = false;
    if (!handle.destroyed) {
      console.info(`[visca-ip] TCP ${handle.host}:${handle.port} closed — reconnecting in ${handle._reconnectDelay}ms`);
      handle._reconnectTimer = setTimeout(() => {
        handle._reconnectTimer = null;
        handle._reconnectDelay = Math.min(handle._reconnectDelay * 2, RECONNECT_DELAY_MAX_MS);
        _openTcpConnection(handle, null);
      }, handle._reconnectDelay);
    }
  });

  handle.socket = socket;
}
