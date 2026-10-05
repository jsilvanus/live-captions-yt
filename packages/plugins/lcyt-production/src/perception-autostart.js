/**
 * Perception auto-start (plan_perception_completion.md Phase 3): keeps perception jobs in step with the feeds.
 * A reconciler runs every `intervalMs`:
 *
 *   - a camera with `perception_enabled = 1` and a `camera_key` gets its job started while its MediaMTX path is
 *     publishing, and stopped after `graceCycles` quiet cycles in a row;
 *   - a project with the shared-feed switch on gets the program-feed job on the same rule (path = the project's key).
 *
 * Jobs for feeds that are switched on are the reconciler's to start and stop (also after a backend restart, when
 * they were re-attached by adopt()). A job it started for a feed that has since been switched off is stopped once;
 * a job an operator started by hand for a feed that was never switched on is never touched. When the liveness
 * check fails (media server unreachable) it does nothing that cycle: unknown is not "offline".
 */

/** Per-project shared-feed switch (table prod_perception_settings). */
export function setSharedAutostart(db, apiKey, enabled) {
  db.prepare(`INSERT INTO prod_perception_settings (api_key, shared_enabled) VALUES (?, ?)
    ON CONFLICT(api_key) DO UPDATE SET shared_enabled = excluded.shared_enabled`).run(apiKey, enabled ? 1 : 0);
}

export function getSharedAutostart(db, apiKey) {
  return !!db.prepare('SELECT shared_enabled FROM prod_perception_settings WHERE api_key = ?').get(apiKey)?.shared_enabled;
}

/**
 * @param {{
 *   db: import('better-sqlite3').Database,
 *   manager: ReturnType<typeof import('./perception-manager.js').createPerceptionManager>,
 *   mediamtxClient: { isPathPublishing: (path: string) => Promise<boolean> } | null,
 *   intervalMs?: number, graceCycles?: number, log?: (msg: string) => void,
 * }} deps
 */
export function createPerceptionAutostart({ db, manager, mediamtxClient, intervalMs = Number(process.env.PERCEPTION_AUTOSTART_MS ?? 15000), graceCycles = 2, log = (m) => console.warn(m) }) {
  /** @type {Set<string>} keys of jobs this reconciler started */
  const mine = new Set();
  /** @type {Map<string, number>} consecutive quiet cycles per key */
  const quiet = new Map();
  let timer = null;
  let busy = false;
  const warned = new Set();

  async function liveness(path) {
    if (!mediamtxClient) return null;
    try { return !!(await mediamtxClient.isPathPublishing(path)); } catch { return null; }
  }

  async function reconcile(key, wantRunning, isRunning, start, stop) {
    if (wantRunning === null) return; // unknown: leave things as they are
    if (wantRunning) {
      quiet.delete(key);
      if (!isRunning) {
        try { await start(); mine.add(key); } catch (err) {
          if (!warned.has(key)) { warned.add(key); log(`[perception] auto-start of ${key} failed: ${err.message}`); }
        }
      }
      return;
    }
    if (isRunning) {
      const n = (quiet.get(key) ?? 0) + 1;
      quiet.set(key, n);
      if (n >= graceCycles && await stop()) { mine.delete(key); quiet.delete(key); }
    } else {
      quiet.delete(key);
    }
  }

  async function tick() {
    if (busy) return;
    busy = true;
    try {
      for (const cam of db.prepare('SELECT id, camera_key, owner_api_key FROM prod_cameras WHERE perception_enabled = 1 AND camera_key IS NOT NULL').all()) {
        if (!cam.owner_api_key) {
          if (!warned.has(cam.id)) { warned.add(cam.id); log(`[perception] camera ${cam.id} has auto-start on but no owning project; skipped`); }
          continue;
        }
        const key = String(cam.id);
        await reconcile(key, await liveness(cam.camera_key), !!manager.status(key),
          () => manager.start(cam.owner_api_key, { id: cam.id, cameraKey: cam.camera_key }), () => manager.stop(key));
      }
      for (const row of db.prepare('SELECT api_key FROM prod_perception_settings WHERE shared_enabled = 1').all()) {
        const key = `shared:${row.api_key}`;
        await reconcile(key, await liveness(row.api_key), !!manager.sharedFeedStatus(row.api_key),
          () => manager.startSharedFeed(row.api_key), () => manager.stopSharedFeed(row.api_key));
      }
      // A job we started whose camera or switch has since been turned off: stop it.
      for (const key of [...mine]) {
        if (key.startsWith('shared:')) {
          const apiKey = key.slice('shared:'.length);
          if (!getSharedAutostart(db, apiKey) && await manager.stopSharedFeed(apiKey)) mine.delete(key);
        } else if (!db.prepare('SELECT 1 FROM prod_cameras WHERE id = ? AND perception_enabled = 1').get(key)) {
          if (await manager.stop(key)) mine.delete(key);
        }
      }
    } catch (err) {
      log(`[perception] auto-start cycle failed: ${err.message}`);
    } finally {
      busy = false;
    }
  }

  function start() {
    if (timer) return;
    timer = setInterval(() => { void tick(); }, intervalMs);
    timer.unref?.();
    void tick();
  }
  function stop() { if (timer) { clearInterval(timer); timer = null; } }

  return { start, stop, tick, _mine: mine };
}
