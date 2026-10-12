import pg from 'pg';

/**
 * Relays EventBus events between backend instances over PostgreSQL LISTEN/NOTIFY.
 *
 *   local publish  ->  bus.forward -> pg_notify(channel, {o: instanceId, e: envelope})
 *   notification   ->  (skip own) -> bus.publishRemote(envelope)
 *
 * Delivery stays best-effort, as the bus always was: a listener that is reconnecting misses what
 * was sent meanwhile. Order from one instance is kept (notifications go out through one queue).
 * A NOTIFY payload is limited to 8000 bytes; bigger envelopes are stored in `bus_payloads` and only
 * their id travels. LISTEN needs a direct or session-mode connection (not PgBouncer transaction mode).
 *
 * Only used in shared mode (PostgreSQL). With SQLite nothing is started.
 */

const MAX_INLINE_BYTES = 7000;
const MAX_QUEUE = 2000;
const PAYLOAD_TTL_MS = 5 * 60_000;

/** The connection string without Prisma-only query parameters. */
export function toPgConnectionString(url) {
  const u = new URL(url);
  for (const key of ['schema', 'connection_limit', 'pool_timeout', 'pgbouncer', 'socket_timeout', 'connect_timeout']) u.searchParams.delete(key);
  return u.toString();
}

/**
 * @param {object} opts
 * @param {import('lcyt/event-bus').EventBus} opts.eventBus
 * @param {import('../db/connection.js').Db} opts.db
 * @param {string} opts.connectionString  PostgreSQL URL
 * @param {string} opts.instanceId
 * @param {string} [opts.channel]  lower-case identifier; tests use their own
 * @param {{ info?:Function, warn?:Function }} [opts.log]
 * @param {number} [opts.maxInlineBytes]
 * @param {number} [opts.reconnectMaxMs]
 */
export function startPgBus({
  eventBus, db, connectionString, instanceId, channel = 'lcyt_bus', log = console,
  maxInlineBytes = MAX_INLINE_BYTES, reconnectMaxMs = 30_000, now = Date.now,
}) {
  if (!/^[a-z_][a-z0-9_]*$/.test(channel)) throw new Error(`invalid bus channel name: ${channel}`);
  const connString = toPgConnectionString(connectionString);

  let stopped = false;
  let client = null;
  let retryTimer = null;
  let retryMs = 500;
  let lastPrune = 0;
  let queue = Promise.resolve();
  let queued = 0;
  let dropped = 0;
  const stats = { sent: 0, received: 0, oversize: 0, dropped: 0, reconnects: 0 };

  async function send(envelope) {
    let text = JSON.stringify({ o: instanceId, e: envelope });
    if (Buffer.byteLength(text) > maxInlineBytes) {
      stats.oversize++;
      const t = now();
      const row = await db.bus_payloads.create({ data: { created_at: BigInt(t), payload: JSON.stringify(envelope) } });
      text = JSON.stringify({ o: instanceId, p: row.id });
      if (t - lastPrune > 60_000) {
        lastPrune = t;
        db.bus_payloads.deleteMany({ where: { created_at: { lt: BigInt(t - PAYLOAD_TTL_MS) } } }).catch(() => {});
      }
    }
    await db.$queryRawUnsafe('SELECT pg_notify($1, $2)', channel, text);
    stats.sent++;
  }

  function forward(envelope) {
    if (stopped) return;
    if (queued >= MAX_QUEUE) {
      stats.dropped++;
      if (++dropped === 1 || dropped % 1000 === 0) log.warn?.(`[cluster] event relay is backed up; dropped ${dropped} event(s)`);
      return;
    }
    queued++;
    queue = queue.then(() => send(envelope)).catch((err) => {
      log.warn?.(`[cluster] could not relay ${envelope.topic}: ${err.message}`);
    }).finally(() => { queued--; });
  }

  async function onNotification(msg) {
    if (msg.channel !== channel || !msg.payload) return;
    let body;
    try { body = JSON.parse(msg.payload); } catch { return; }
    if (!body || body.o === instanceId) return;
    try {
      let envelope = body.e;
      if (!envelope && body.p != null) {
        const row = await db.bus_payloads.findUnique({ where: { id: body.p } });
        if (!row) return;
        envelope = JSON.parse(row.payload);
      }
      if (!envelope) return;
      stats.received++;
      eventBus.publishRemote(envelope);
    } catch (err) {
      log.warn?.(`[cluster] bad relayed event: ${err.message}`);
    }
  }

  async function connect() {
    if (stopped) return;
    const c = new pg.Client({ connectionString: connString });
    c.on('notification', (m) => { onNotification(m); });
    const lost = (err) => {
      if (client !== c) return;
      client = null;
      c.removeAllListeners();
      c.end().catch(() => {});
      if (stopped) return;
      log.warn?.(`[cluster] event relay connection lost${err ? `: ${err.message}` : ''}; reconnecting`);
      scheduleReconnect();
    };
    c.on('error', lost);
    c.on('end', () => lost(null));
    try {
      await c.connect();
      client = c;
      await c.query(`LISTEN "${channel}"`);
      retryMs = 500;
      log.info?.(`[cluster] listening for events from other instances on "${channel}"`);
    } catch (err) {
      client = client === c ? null : client;
      c.removeAllListeners();
      c.end().catch(() => {});
      if (!stopped) {
        log.warn?.(`[cluster] event relay connect failed: ${err.message}`);
        scheduleReconnect();
      }
    }
  }

  function scheduleReconnect() {
    if (stopped || retryTimer) return;
    stats.reconnects++;
    retryTimer = setTimeout(() => { retryTimer = null; connect(); }, retryMs);
    retryTimer.unref?.();
    retryMs = Math.min(retryMs * 2, reconnectMaxMs);
  }

  const unforward = eventBus.forward(forward);

  return {
    /** Resolves once LISTEN is active (or the first attempt failed and a retry is scheduled). */
    ready: connect(),
    /** Resolves when everything queued so far has been sent. */
    flush: () => queue,
    stats: () => ({ ...stats }),
    async stop() {
      stopped = true;
      unforward();
      if (retryTimer) clearTimeout(retryTimer);
      await queue.catch(() => {});
      const c = client;
      client = null;
      if (c) { c.removeAllListeners(); await c.end().catch(() => {}); }
    },
  };
}
