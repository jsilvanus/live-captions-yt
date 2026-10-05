/**
 * Perception job dispatch (plan_video_perception.md Phase 2 Stream B,
 * lcyt-production half): starts/stops the fps30 tracker job for a
 * dedicated-feed camera as an fffleet job (`FFFLEET_URL`; workers run the
 * `perception` job type from `lcyt-compute/perception/fffleet-executor`).
 *
 * Frame source: a dedicated-feed camera's `cameraKey` IS its own MediaMTX
 * path name (verified against `lcyt-rtmp`'s `rtmp-manager.js` camera-sourced
 * relay code), so the already-public `GET /preview/:key/incoming` route (the
 * same one Tracker/Describer already poll) works unmodified — no new
 * frame-acquisition endpoint was needed for this phase.
 *
 * Shared/single-feed cameras (Phase 3, `plan_video_perception.md` §1 "Two
 * camera-feed topologies"): a mixer-input-only camera (amx/visca-ip, no
 * `cameraKey`) has no feed of its own to poll — the only image ever
 * available is the project's shared program feed. `startSharedFeed()`
 * dispatches one job per project against that shared feed
 * (`GET /preview/:apiKey/incoming`, the same project-scoped endpoint
 * Tracker/Describer already poll) with `cameraId: null` and
 * `feedKind: 'shared'` on the job plan — the ingest side (lcyt-backend's
 * shared-feed resolver) is what actually knows which camera that feed
 * currently shows, not the runner, so it re-tags each detection before it
 * reaches the aggregator. `feedKind` is a real, typed field on the plan
 * (not a sentinel `cameraId` string) so nothing downstream that reads
 * `detection.cameraId` can mistake an unresolved shared-feed detection for
 * a real camera id — code-review fix.
 */

import { mintIngestToken, verifyIngestToken } from 'lcyt-compute/perception/ingest-token';

export function isPerceptionDispatchAvailable(env = process.env) {
  return !!env.FFFLEET_URL;
}

/**
 * @param {{
 *   previewBaseUrl: string,   // base URL serving GET /preview/:key/incoming (this backend's own public URL)
 *   callbackBaseUrl: string,  // base URL this backend is reachable at for the ingest callback (usually the same host)
 *   fetchImpl?: typeof fetch,
 *   env?: object,
 *   db?: import('better-sqlite3').Database,  // optional: records dispatched jobs so adopt() can re-attach after a restart
 * }} opts
 */
export function createPerceptionManager({ previewBaseUrl, callbackBaseUrl, fetchImpl = fetch, env = process.env, getFleetImpl = null, db = null, tokenSecret = env.PERCEPTION_INGEST_SECRET || null } = {}) {
  // FFFLEET_URL: perception is an fffleet job type (workers started with
  // FFFLEET_EXECUTORS=lcyt-compute/perception/fffleet-executor).
  const fleetUrl = env.FFFLEET_URL || null;
  const workerToken = env.BACKEND_INTERNAL_TOKEN || null;

  /** @type {Map<string, { jobId: string, apiKey: string, startedAt: number }>} */
  const running = new Map();

  // PERCEPTION_STREAM_BASE_URL: where a perception worker can read the media server's streams (e.g.
  // rtsp://mediamtx:8554). Unset = snapshot polling only. A remote worker must be able to reach it.
  const streamBase = env.PERCEPTION_STREAM_BASE_URL ? env.PERCEPTION_STREAM_BASE_URL.replace(/\/$/, '') : null;
  function _streamUrl(key) {
    return streamBase ? `${streamBase}/${encodeURIComponent(key)}` : null;
  }

  function _sharedKey(apiKey) {
    return `shared:${apiKey}`;
  }

  /**
   * Common dispatch: build + POST a job plan, track it in `running` under
   * `key`. Both start() and startSharedFeed() reduce to this once they've
   * built their own `frameUrl`/`cameraId`.
   */
  async function _dispatch(key, apiKey, cameraId, frameUrl, emitIntervalMs, feedKind, streamUrl = null) {
    // Idempotency guard (code-review fix): without this, a retried start
    // request (client timeout, double form-submit) would dispatch a second
    // job and overwrite the first job's tracked id in `running` — the first
    // job keeps running on the worker/orchestrator but becomes permanently
    // unstoppable via this manager (its jobId is gone). Mirrors
    // VisionRoleManager.start()'s `if (this._sessions.has(key)) return
    // {ok:true, alreadyRunning:true}` guard in lcyt-agent.
    const existing = running.get(key);
    if (existing) return { jobId: existing.jobId, alreadyRunning: true };
    if (!fleetUrl) {
      const err = new Error('perception runner not configured (set FFFLEET_URL)');
      err.code = 'NOT_CONFIGURED';
      throw err;
    }
    const jobId = `perception-${key.replace(/[^A-Za-z0-9_-]/g, '')}-${Date.now().toString(36)}`;
    const plan = {
      id: jobId,
      jobId,
      type: 'perception',
      apiKey,
      cameraId,
      feedKind,
      frameUrl,
      // With a stream url the job decodes the stream itself (about 5 frames/s) instead of polling the snapshot.
      streamUrl: streamUrl || undefined,
      detectFps: streamUrl && env.PERCEPTION_DETECT_FPS ? Number(env.PERCEPTION_DETECT_FPS) : undefined,
      callbackUrl: `${callbackBaseUrl}/production/perception/ingest`,
      // Per-job token (scoped to this exact job) when a secret is configured, else the shared internal token.
      internalToken: tokenSecret ? mintIngestToken(tokenSecret, { apiKey, cameraId, feedKind, jobId }) : (workerToken || undefined),
      emitIntervalMs: emitIntervalMs || (streamUrl ? 200 : 1000),
    };

    const { id, type: _type, ...payload } = plan;
    const spec = { id, kind: 'stream', type: 'perception', owner: apiKey, labels: { purpose: 'perception' }, perception: { ...payload, jobId: id } };
    await _attachFleet(key, apiKey, spec);
    _persist(key, apiKey, id, 'fleet', spec);
    return { jobId: id };
  }

  // ── persistence + re-adoption ────────────────────────────────────────────
  function _persist(key, apiKey, jobId, mode, spec) {
    if (!db) return;
    try {
      db.prepare(`INSERT INTO prod_perception_jobs (job_key, api_key, job_id, mode, spec, started_at) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(job_key) DO UPDATE SET api_key = excluded.api_key, job_id = excluded.job_id, mode = excluded.mode, spec = excluded.spec, started_at = excluded.started_at`)
        .run(key, apiKey, jobId, mode, JSON.stringify(spec), new Date().toISOString());
    } catch (err) { console.warn(`[perception] could not record job ${jobId}: ${err.message}`); }
  }

  function _forget(key) {
    if (!db) return;
    try { db.prepare('DELETE FROM prod_perception_jobs WHERE job_key = ?').run(key); } catch { /* ignore */ }
  }

  /** Submit (or re-attach to) a fleet job and track it under `key`. */
  async function _attachFleet(key, apiKey, spec) {
    const fleet = await (getFleetImpl ? getFleetImpl() : (await import('lcyt-compute/ffmpeg')).getFleet(env));
    const job = await fleet.submit(spec);
    const entry = { jobId: spec.id, apiKey, startedAt: Date.now(), job };
    running.set(key, entry);
    // A job that ends by itself (cancelled elsewhere, worker lost) frees the key and its record. A rejection means
    // we stopped following it (shutdown, lost connection): the record stays so adopt() can re-attach after a restart.
    job.done.then(
      () => { if (running.get(key) === entry) { running.delete(key); _forget(key); } },
      () => { if (running.get(key) === entry) running.delete(key); },
    );
    return entry;
  }

  /**
   * After a backend restart: re-attach to the jobs recorded before it. A fleet job is resubmitted with the same id,
   * which the fleet answers with the job it already runs (or runs afresh when it no longer knows the id), so no
   * duplicate and no orphan is left. Records from the retired orchestrator/worker daemon (mode 'legacy') cannot be
   * re-attached: they are forgotten, and auto-start (or the operator) starts a new job.
   * @returns {Promise<{ adopted: number, dropped: number }>}
   */
  async function adopt() {
    if (!db) return { adopted: 0, dropped: 0 };
    let adopted = 0; let dropped = 0;
    for (const row of db.prepare('SELECT * FROM prod_perception_jobs').all()) {
      if (running.has(row.job_key)) continue;
      let spec;
      try { spec = JSON.parse(row.spec); } catch { _forget(row.job_key); dropped += 1; continue; }
      if (row.mode === 'fleet' && fleetUrl) {
        try { await _attachFleet(row.job_key, row.api_key, spec); adopted += 1; } catch (err) {
          console.warn(`[perception] could not re-attach job ${row.job_id}: ${err.message}`);
        }
      } else {
        _forget(row.job_key); dropped += 1;
      }
    }
    return { adopted, dropped };
  }

  async function _dispatchStop(key) {
    const entry = running.get(key);
    if (!entry) return false;
    // Code-review fix: only clear local bookkeeping once the remote stop is
    // actually confirmed (2xx, or 404 meaning the job is already gone) —
    // previously `running.delete(key)` ran unconditionally before the
    // DELETE call and this always returned true, so a failed remote stop
    // (network error, 500, auth mismatch) was silently reported as success
    // with no local record left to retry or re-discover the still-running
    // job by.
    if (entry.job) {
      try {
        await entry.job.cancel();
      } catch (err) {
        console.error(`perception stop dispatch failed for ${key}:`, err && err.message);
        return false;
      }
      running.delete(key);
      _forget(key);
      return true;
    }
    return false;
  }

  /**
   * @param {string} apiKey
   * @param {{ id: string|number, cameraKey?: string|null }} camera
   * @param {{ emitIntervalMs?: number }} [opts]
   */
  async function start(apiKey, camera, { emitIntervalMs } = {}) {
    if (!camera?.cameraKey) {
      const err = new Error('camera has no cameraKey (dedicated-feed cameras only)');
      err.code = 'NO_FEED';
      throw err;
    }
    const cameraId = String(camera.id);
    const frameUrl = `${previewBaseUrl}/preview/${encodeURIComponent(camera.cameraKey)}/incoming`;
    return _dispatch(cameraId, apiKey, cameraId, frameUrl, emitIntervalMs, 'dedicated', _streamUrl(camera.cameraKey));
  }

  /**
   * @param {string|number} cameraId
   * @returns {Promise<boolean>} true if a running job was found and a stop was attempted
   */
  async function stop(cameraId) {
    return _dispatchStop(String(cameraId));
  }

  function status(cameraId) {
    return running.get(String(cameraId)) || null;
  }

  /**
   * Start one shared-feed perception job for the whole project (Phase 3) —
   * see the module doc's "Shared/single-feed cameras" section.
   * @param {string} apiKey
   * @param {{ emitIntervalMs?: number }} [opts]
   */
  async function startSharedFeed(apiKey, { emitIntervalMs } = {}) {
    const frameUrl = `${previewBaseUrl}/preview/${encodeURIComponent(apiKey)}/incoming`;
    return _dispatch(_sharedKey(apiKey), apiKey, null, frameUrl, emitIntervalMs, 'shared', _streamUrl(apiKey));
  }

  async function stopSharedFeed(apiKey) {
    return _dispatchStop(_sharedKey(apiKey));
  }

  function sharedFeedStatus(apiKey) {
    return running.get(_sharedKey(apiKey)) || null;
  }

  /**
   * Check the per-job token a perception job sent with its detection.
   * @param {{ apiKey: string, cameraId?: string|null, feedKind?: string|null, jobId?: string }} scope  from the posted body
   * @param {string|undefined} token  the X-Internal-Auth header
   */
  function verifyIngest(scope, token) {
    return !!tokenSecret && verifyIngestToken(tokenSecret, scope, token);
  }

  return { start, stop, status, startSharedFeed, stopSharedFeed, sharedFeedStatus, verifyIngest, adopt };
}
