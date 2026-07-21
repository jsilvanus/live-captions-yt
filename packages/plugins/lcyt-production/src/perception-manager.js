/**
 * Perception job dispatch (plan_video_perception.md Phase 2 Stream B,
 * lcyt-production half): starts/stops the fps30 tracker job for a
 * dedicated-feed camera on the existing compute orchestration layer.
 * Reuses the same two dispatch knobs `FFMPEG_RUNNER=worker` already uses
 * (`ORCHESTRATOR_URL`, else `WORKER_DAEMON_URL`) rather than inventing a
 * third config surface — see `lcyt-worker-daemon/src/perception/runner.js`'s
 * module doc for why there's no 'local'/'docker' mode here (the runner is
 * pure JS with a stub detector, nothing to containerize yet).
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

export function isPerceptionDispatchAvailable(env = process.env) {
  return !!(env.ORCHESTRATOR_URL || env.WORKER_DAEMON_URL);
}

/**
 * @param {{
 *   previewBaseUrl: string,   // base URL serving GET /preview/:key/incoming (this backend's own public URL)
 *   callbackBaseUrl: string,  // base URL this backend is reachable at for the ingest callback (usually the same host)
 *   fetchImpl?: typeof fetch,
 *   env?: object,
 * }} opts
 */
export function createPerceptionManager({ previewBaseUrl, callbackBaseUrl, fetchImpl = fetch, env = process.env } = {}) {
  const orchestratorUrl = env.ORCHESTRATOR_URL || null;
  const orchestratorToken = env.ORCHESTRATOR_INTERNAL_TOKEN || env.BACKEND_INTERNAL_TOKEN || null;
  const workerDaemonUrl = env.WORKER_DAEMON_URL || null;
  const workerToken = env.BACKEND_INTERNAL_TOKEN || null;

  /** @type {Map<string, { jobId: string, apiKey: string, startedAt: number }>} */
  const running = new Map();

  function _headers(token, headerName) {
    const h = { 'Content-Type': 'application/json' };
    if (token) h[headerName] = token;
    return h;
  }

  async function _post(path, body) {
    if (orchestratorUrl) {
      return fetchImpl(`${orchestratorUrl}${path}`, { method: 'POST', headers: _headers(orchestratorToken, 'X-Internal-Auth'), body: JSON.stringify(body) });
    }
    return fetchImpl(`${workerDaemonUrl}${path}`, { method: 'POST', headers: _headers(workerToken, 'X-Worker-Auth'), body: JSON.stringify(body) });
  }

  async function _delete(path) {
    if (orchestratorUrl) {
      return fetchImpl(`${orchestratorUrl}${path}`, { method: 'DELETE', headers: _headers(orchestratorToken, 'X-Internal-Auth') });
    }
    return fetchImpl(`${workerDaemonUrl}${path}`, { method: 'DELETE', headers: _headers(workerToken, 'X-Worker-Auth') });
  }

  function _sharedKey(apiKey) {
    return `shared:${apiKey}`;
  }

  /**
   * Common dispatch: build + POST a job plan, track it in `running` under
   * `key`. Both start() and startSharedFeed() reduce to this once they've
   * built their own `frameUrl`/`cameraId`.
   */
  async function _dispatch(key, apiKey, cameraId, frameUrl, emitIntervalMs, feedKind) {
    // Idempotency guard (code-review fix): without this, a retried start
    // request (client timeout, double form-submit) would dispatch a second
    // job and overwrite the first job's tracked id in `running` — the first
    // job keeps running on the worker/orchestrator but becomes permanently
    // unstoppable via this manager (its jobId is gone). Mirrors
    // VisionRoleManager.start()'s `if (this._sessions.has(key)) return
    // {ok:true, alreadyRunning:true}` guard in lcyt-agent.
    const existing = running.get(key);
    if (existing) return { jobId: existing.jobId, alreadyRunning: true };
    if (!orchestratorUrl && !workerDaemonUrl) {
      const err = new Error('perception runner not configured (set ORCHESTRATOR_URL or WORKER_DAEMON_URL)');
      err.code = 'NOT_CONFIGURED';
      throw err;
    }
    const jobId = `perception-${key.replace(/[^A-Za-z0-9_-]/g, '')}-${Date.now().toString(36)}`;
    const plan = {
      id: jobId,
      type: 'perception',
      apiKey,
      cameraId,
      feedKind,
      frameUrl,
      callbackUrl: `${callbackBaseUrl}/production/perception/ingest`,
      internalToken: workerToken || undefined,
      emitIntervalMs: emitIntervalMs || 1000,
    };

    const path = orchestratorUrl ? '/compute/jobs' : '/jobs';
    const res = await _post(path, plan);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`perception dispatch failed: ${res.status} ${text}`);
    }

    running.set(key, { jobId, apiKey, startedAt: Date.now() });
    return { jobId };
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
    try {
      const path = orchestratorUrl ? `/compute/jobs/${entry.jobId}` : `/jobs/${entry.jobId}`;
      const res = await _delete(path);
      if (!res.ok && res.status !== 404) {
        console.error(`perception stop dispatch failed for ${key}: ${res.status}`);
        return false;
      }
    } catch (err) {
      console.error(`perception stop dispatch failed for ${key}:`, err && err.message);
      return false;
    }
    running.delete(key);
    return true;
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
    return _dispatch(cameraId, apiKey, cameraId, frameUrl, emitIntervalMs, 'dedicated');
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
    return _dispatch(_sharedKey(apiKey), apiKey, null, frameUrl, emitIntervalMs, 'shared');
  }

  async function stopSharedFeed(apiKey) {
    return _dispatchStop(_sharedKey(apiKey));
  }

  function sharedFeedStatus(apiKey) {
    return running.get(_sharedKey(apiKey)) || null;
  }

  return { start, stop, status, startSharedFeed, stopSharedFeed, sharedFeedStatus };
}
