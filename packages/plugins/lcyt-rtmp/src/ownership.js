/**
 * Process ownership for the managers that hold a live process or in-memory state per project
 * (RTMP relay, vertical crop, server-side STT) when several backend instances share a database.
 *
 * A manager keeps what it started in its own memory, so a start, stop or status call that lands on
 * another instance would duplicate the process, miss it or report "not running". `withOwnership()`
 * wraps a manager so that:
 *
 *  - a **claiming** call (`start`) first takes the lease `proc:<kind>:<key>`. The winner runs it
 *    locally; a loser forwards the same call to the instance that holds the lease, so a second
 *    publish callback or a config change never starts a duplicate;
 *  - a **routed** call (`stop`, `applyPosition`, `writeCaption`, ...) goes to the lease holder when
 *    that is another instance, and runs locally otherwise;
 *  - a **read** (`isRunning`, `getStatus`, ...) is available as `manager.__read(method, key, ...)`
 *    and asks the holder when this instance has no state of its own for the key;
 *  - the lease is renewed while the process runs locally and released when it is gone, so an
 *    instance that dies loses its keys after the lease TTL and the next start takes over.
 *
 * Everything else (event emitter methods, `stopAll`, getters) passes through to the real manager,
 * bound to it. Without an `ownership` object (single instance, SQLite) callers should not wrap at all.
 *
 * `ownership` (built in lcyt-backend `src/cluster/ownership.js`):
 *   claim(kind, key, { stillNeeded }) -> { ok, owner? }   take/renew the lease and keep renewing it
 *   release(kind, key)
 *   ownerOf(kind, key) -> { id, url, self } | null
 *   forward(owner, kind, method, args) -> result          HTTP call to the owner's /internal/cluster/call
 */

/** Symbol under which the wrapper exposes the real manager (for the internal route and tests). */
export const LOCAL = Symbol.for('lcyt.ownership.local');

/**
 * @param {object} target  the manager
 * @param {{
 *   kind: string,
 *   ownership: object,
 *   claiming?: string[],
 *   routed?: Record<string, { keyIndex?: number, forwardKeyIndex?: number, stops?: boolean, forwardArgs?: (a: any[]) => any[], localArgs?: (a: any[]) => any[] }>,
 *   marks?: string[],
 *   reads?: string[],
 *   isRunning?: (key: string) => boolean,
 *   log?: { warn?: Function }
 * }} spec
 *   `claiming`: methods that start something for `args[0]` (the key).
 *   `routed`: methods sent to the lease holder; `stops` releases the lease when nothing runs afterwards.
 *   A method whose first argument is not the key (`applyForSource(db, key, ...)`) sets `keyIndex`,
 *   `forwardArgs` (what travels over HTTP) and `localArgs` (how the holder rebuilds the call), with
 *   `forwardKeyIndex` for the key's place in the forwarded arguments.
 *   `marks`: sync, fire-and-forget flags (`markPublishing`): applied locally at once, then passed on
 *   to the holder when there is another one (errors are logged, never thrown).
 *   `reads`: sync getters reachable through `__read`.
 */
export function withOwnership(target, spec) {
  const { kind, ownership, claiming = [], routed = {}, marks = [], reads = [], log = console } = spec;
  const running = spec.isRunning || ((key) => target.isRunning(key));

  // Own keys only: `routed['constructor']` would otherwise find Object's constructor.
  const isRouted = (m) => Object.hasOwn(routed, m);

  const warn = (msg) => (log.warn || log.log || (() => {}))(`[ownership:${kind}] ${msg}`);

  async function releaseIfIdle(key) {
    try {
      if (!(await running(key))) await ownership.release(kind, key);
    } catch (err) {
      warn(`release ${String(key).slice(0, 8)}: ${err.message}`);
    }
  }

  async function callClaiming(method, args) {
    const key = args[0];
    const claim = await ownership.claim(kind, key, { stillNeeded: () => running(key) });
    if (!claim.ok) {
      if (!claim.owner || claim.owner.self) throw new Error(`${kind} ${String(key).slice(0, 8)}: could not take ownership`);
      return ownership.forward(claim.owner, kind, method, args);
    }
    try {
      return await target[method](...args);
    } finally {
      await releaseIfIdle(key);
    }
  }

  async function callRouted(method, args) {
    const def = routed[method];
    const key = args[def.keyIndex ?? 0];
    const owner = await ownership.ownerOf(kind, key);
    if (owner && !owner.self) {
      return ownership.forward(owner, kind, method, def.forwardArgs ? def.forwardArgs(args) : args);
    }
    return runRouted(method, args, key);
  }

  async function runRouted(method, callArgs, key) {
    try {
      return await target[method](...callArgs);
    } finally {
      if (routed[method].stops) await releaseIfIdle(key);
    }
  }

  function callMark(method, args) {
    const key = args[0];
    const result = target[method](...args);
    ownership.ownerOf(kind, key).then((owner) => {
      if (owner && !owner.self) return ownership.forward(owner, kind, method, args);
      return undefined;
    }).catch((err) => warn(`${method} ${String(key).slice(0, 8)}: ${err.message}`));
    return result;
  }

  /** Read through: local state wins, otherwise ask the holder. */
  async function read(method, key, ...rest) {
    const local = target[method](key, ...rest);
    const localHas = method === 'isPublishing' ? local === true : Boolean(running(key));
    if (localHas) return local;
    const owner = await ownership.ownerOf(kind, key);
    if (!owner || owner.self) return local;
    return ownership.forward(owner, kind, method, [key, ...rest]);
  }

  /**
   * Run a whitelisted call on THIS instance without forwarding it again (the body of the
   * internal route, called on the instance that holds the lease).
   */
  async function invokeLocal(method, args) {
    if (claiming.includes(method)) {
      const key = args[0];
      const claim = await ownership.claim(kind, key, { stillNeeded: () => running(key) });
      if (!claim.ok) throw Object.assign(new Error(`${kind} ${String(key).slice(0, 8)} is no longer owned by this instance`), { code: 'NOT_OWNER' });
      try {
        return await target[method](...args);
      } finally {
        await releaseIfIdle(key);
      }
    }
    if (isRouted(method)) {
      const def = routed[method];
      const key = args[def.forwardKeyIndex ?? def.keyIndex ?? 0];
      return runRouted(method, def.localArgs ? def.localArgs(args) : args, key);
    }
    if (marks.includes(method)) return target[method](...args);
    if (reads.includes(method)) return target[method](...args);
    throw Object.assign(new Error(`method not allowed: ${kind}.${method}`), { code: 'METHOD_NOT_ALLOWED' });
  }

  return new Proxy(target, {
    get(t, prop) {
      if (prop === LOCAL) return t;
      if (prop === '__read') return read;
      if (prop === '__invokeLocal') return invokeLocal;
      if (prop === '__ownedElsewhere') {
        return async (key) => {
          const owner = await ownership.ownerOf(kind, key);
          return Boolean(owner && !owner.self);
        };
      }
      const value = Reflect.get(t, prop, t);
      if (typeof value !== 'function') return value;
      if (claiming.includes(prop)) return (...args) => callClaiming(prop, args);
      if (isRouted(prop)) return (...args) => callRouted(prop, args);
      if (marks.includes(prop)) return (...args) => callMark(prop, args);
      return value.bind(t);
    },
  });
}

/**
 * Read `method(key, ...rest)` from a manager, asking the instance that owns the key when the
 * manager is wrapped and this instance has no state for it. Plain managers answer directly.
 * @returns {Promise<any>}
 */
export async function readThrough(manager, method, key, ...rest) {
  if (manager && typeof manager.__read === 'function') return manager.__read(method, key, ...rest);
  return manager[method](key, ...rest);
}

/** True when the manager is wrapped and another instance owns `key` (always false otherwise). */
export async function ownedElsewhere(manager, key) {
  if (manager && typeof manager.__ownedElsewhere === 'function') return manager.__ownedElsewhere(key);
  return false;
}

/** Method lists per manager kind (shared by the wrappers in api.js and the internal route). */
export const RELAY_OWNERSHIP = {
  kind: 'relay',
  claiming: ['start', 'startAll'],
  routed: {
    stop: { stops: true },
    stopKey: { stops: true },
    setDskRtmpSource: {},
    writeCaption: {},
  },
  marks: ['markPublishing', 'markNotPublishing'],
  reads: ['isRunning', 'runningSlots', 'isSlotRunning', 'startedAt', 'lastExit', 'liveStderr', 'isPublishing', 'hasCea708'],
};

export const CROP_OWNERSHIP = {
  kind: 'crop',
  claiming: ['start'],
  routed: {
    stop: { stops: true },
    applyPosition: {},
  },
  marks: [],
  reads: ['isRunning', 'getStatus'],
};

export const STT_OWNERSHIP = {
  kind: 'stt',
  claiming: ['start'],
  routed: {
    stop: { stops: true },
  },
  marks: [],
  reads: ['isRunning', 'getStatus'],
};
