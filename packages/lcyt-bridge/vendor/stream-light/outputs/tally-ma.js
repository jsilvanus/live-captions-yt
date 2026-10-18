/**
 * Tally-MA wireless tally lamp over UDP.
 *
 * Protocol as implemented by the open Companion module for this lamp
 * (bitfocus/companion-module-tallyma-wirelesstally): UDP port 21324, a colour is
 * a 29 byte packet `2, 5` followed by nine `R, G, B` triplets. Not yet tried
 * against a real lamp; see the README for the checks to make when one arrives.
 *
 * The output keeps sending: every `tickMs` it re-sends the current colour, and
 * blinking looks toggle on each tick. When no reading has arrived within the
 * reading's `ttlMs` it shows the UNKNOWN look by itself (the deadman).
 */
import dgram from 'node:dgram';
import { effectiveState } from '../core/reading.js';
import { TALLY_MA_DEFAULT_PORT } from '../core/config.js';

export const INIT_PACKET = Buffer.from([2, 255, ...new Array(27).fill(0)]);
export const STREAMING_PACKET = Buffer.from([5, 5, 4]);
export const RECORDING_PACKET = Buffer.from([5, 5, 3]);

export function colorPacket([r, g, b]) {
  const buf = Buffer.alloc(29);
  buf[0] = 2;
  buf[1] = 5;
  for (let i = 0; i < 9; i++) {
    buf[2 + i * 3] = r;
    buf[3 + i * 3] = g;
    buf[4 + i * 3] = b;
  }
  return buf;
}

/**
 * @param {object} opts
 * @param {string} opts.host
 * @param {number} [opts.port]
 * @param {number} [opts.tickMs]      resend and blink period
 * @param {boolean} [opts.sendInit]   send the init packet before the first colour
 * @param {boolean} [opts.streamingPacket]  also send the STREAMING indicator packet while the state is LIVE (firmware 2.1.0+, untested)
 * @param {'unknown'|'dark'|'hold'} [opts.onClose]  what the lamp shows after close(): the UNKNOWN look held solid (default), dark, or the last colour
 * @param {() => {send: Function, close: Function}} [opts.socketFactory]
 */
export function createTallyMaOutput({
  host,
  port = TALLY_MA_DEFAULT_PORT,
  tickMs = 500,
  sendInit = true,
  streamingPacket = false,
  onClose = 'unknown',
  socketFactory = () => dgram.createSocket('udp4'),
  clock = { now: () => Date.now(), setTimeout: (f, m) => setTimeout(f, m), clearTimeout: (t) => clearTimeout(t) },
  onError = () => {},
} = {}) {
  if (!host) throw new TypeError('host is required');
  let socket = null;
  let timer = null;
  let current = null;       // { reading, receivedAt, ctx }
  let phase = true;         // blink phase: true = lit
  let initSent = false;
  let closed = false;

  function ensureSocket() {
    if (socket) return socket;
    socket = socketFactory();
    socket.on?.('error', (err) => onError(err));
    socket.unref?.();
    return socket;
  }

  function send(buf) {
    return new Promise((resolve) => {
      try {
        ensureSocket().send(buf, port, host, (err) => {
          if (err) onError(err);
          resolve();
        });
      } catch (err) {
        onError(err);
        resolve();
      }
    });
  }

  function view() {
    const state = effectiveState(current.reading, current.receivedAt, clock.now());
    const look = current.ctx.lookFor(state);
    const rgb = look.blink && !phase ? [0, 0, 0] : look.rgb;
    return { state, rgb };
  }

  async function emit() {
    if (!current || closed) return;
    if (sendInit && !initSent) { initSent = true; await send(INIT_PACKET); }
    const { state, rgb } = view();
    await send(colorPacket(rgb));
    if (streamingPacket && state === 'LIVE') await send(STREAMING_PACKET);
  }

  function tick() {
    timer = clock.setTimeout(tick, tickMs);
    timer.unref?.();
    phase = !phase;
    emit();
  }

  return {
    name: `tally-ma:${host}`,
    async apply(reading, ctx) {
      if (closed) return;
      current = { reading, receivedAt: clock.now(), ctx };
      if (!timer) { timer = clock.setTimeout(tick, tickMs); timer.unref?.(); }
      await emit();
    },
    async close() {
      if (closed) return;
      if (timer) clock.clearTimeout(timer);
      timer = null;
      if (current && onClose !== 'hold') {
        const rgb = onClose === 'dark' ? [0, 0, 0] : current.ctx.lookFor('UNKNOWN').rgb;
        await send(colorPacket(rgb));
      }
      closed = true;
      try { socket?.close(); } catch { /* ignore */ }
      socket = null;
    },
  };
}
