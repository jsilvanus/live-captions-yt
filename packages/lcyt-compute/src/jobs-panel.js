/**
 * Data for the jobs panel in lcyt-web's top bar (`GET /jobs`, `GET /jobs/strip` in lcyt-backend).
 * Read-only except `cancel` (see CANCELLABLE_PURPOSES). LCYT has no job table, so the rows are what is running right now:
 *
 *  - the ffmpeg runs of the process (`listRunningFfmpegRuns`, local spawns and fleet jobs alike),
 *  - the live sessions that LCYT started on the liturgos-auditor STT service (`POST /v1/live` from
 *    lcyt-rtmp's AuditorLiveAdapter, which sets `client_ref` to `lcyt:<first 8 chars of the
 *    project key>`); found by listing `GET /v1/live` and keeping the `lcyt:` sessions.
 *
 * The strip adds the fffleet orchestrator (`fleet-status.js`) and the auditor queue (`GET /status`).
 * The auditor parts are left out silently when the service is not configured or does not answer.
 * Row and strip shapes are those of the shared panel (`PanelJob`, `FleetStripData`), see
 * packages/lcyt-web/src/components/jobs-panel/README.md.
 */
import { listRunningFfmpegRuns } from './ffmpeg/run-registry.js';
import { readFleet } from './fleet-status.js';

export const AUDITOR_TIMEOUT_MS = 1500;
export const OUTSIDE_CACHE_MS = 2000;
export const CLIENT_REF_PREFIX = 'lcyt:';

/** The `client_ref` lcyt-rtmp gives the live session of a project. */
export const liveClientRef = (projectId) => `${CLIENT_REF_PREFIX}${String(projectId || '').slice(0, 8)}`;

/**
 * Queue and live sessions of the auditor service. Null when it is not configured or neither call
 * answers; a part that fails (e.g. 503 because live sessions are off) is just empty.
 * @returns {Promise<null | { queue: null | { total: number }, sessions: object[] }>}
 */
export async function readAuditor({ url, apiKey = '', fetch: fetchFn = globalThis.fetch } = {}) {
  const base = String(url || '').trim().replace(/\/+$/, '');
  if (!base) return null;
  const headers = apiKey ? { authorization: `Bearer ${apiKey}` } : {};
  const get = async (path) => {
    const res = await fetchFn(`${base}${path}`, { headers, signal: AbortSignal.timeout(AUDITOR_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  };
  const [status, live] = await Promise.allSettled([get('/status'), get('/v1/live')]);
  if (status.status === 'rejected' && live.status === 'rejected') return null;
  const depth = status.status === 'fulfilled' ? Number(status.value?.queue?.live_depth ?? 0) + Number(status.value?.queue?.batch_depth ?? 0) : null;
  return {
    queue: depth === null || !Number.isFinite(depth) ? null : { total: depth },
    sessions: live.status === 'fulfilled' && Array.isArray(live.value?.sessions) ? live.value.sessions : [],
  };
}

/**
 * Allow-list of ffmpeg `purpose`s that the panel may cancel: finite batch jobs that are safe to stop. Nothing is on it:
 * every purpose LCYT starts today (relay, crop, stt, dsk, music, pcm, perception) belongs to a live broadcast or is
 * restarted by its manager, and a one-off batch ffmpeg job has not been added yet. A new batch purpose is added here
 * on purpose, together with a `stop` on its registry entry (`trackFfmpegRun`). Live auditor sessions are never
 * cancellable from the panel, whatever this set says.
 */
export const CANCELLABLE_PURPOSES = new Set();

/**
 * 'pull' = the auditor pulls the stream itself (`POST /v1/live`, rtsp/srt source: AuditorLiveAdapter, "pull type"
 * in liturgos-auditor docs/live-sessions.md); 'push' = LCYT sends the audio to the service. `/v1/live` only holds pull
 * sessions, so a listed session is 'pull' unless it reports a non-stream source.
 */
export function auditorMode(session) {
  const source = typeof session?.source === 'string' ? session.source : '';
  if (source && !/^(rtsps?|srt):\/\//i.test(source)) return 'push';
  return 'pull';
}

const iso = (ms) => new Date(ms).toISOString();

/** The ffmpeg runs the caller may see (all for an admin, else the project's own). */
export function ffmpegRows(runs, { projectId = null, isAdmin = false } = {}, { cancellablePurposes = CANCELLABLE_PURPOSES } = {}) {
  return runs
    .filter((run) => isAdmin || (projectId && run.apiKey === projectId))
    .map((run) => ({
      id: run.id,
      projectId: run.apiKey || '',
      projectTitle: run.purpose,
      type: 'FFMPEG',
      status: 'RUNNING',
      phase: null,
      progress: 0,
      message: null,
      error: null,
      workerId: run.runner,
      cancelRequested: false,
      cancellable: cancellablePurposes.has(run.purpose) && typeof run.stop === 'function',
      createdAt: iso(run.startedAt),
      startedAt: iso(run.startedAt),
      completedAt: null,
    }));
}

/** Active LCYT live sessions of the auditor the caller may see, as RUNNING rows. */
export function auditorRows(sessions, { projectId = null, isAdmin = false } = {}) {
  const own = projectId ? liveClientRef(projectId) : null;
  return sessions
    .filter((s) => typeof s?.client_ref === 'string' && s.client_ref.startsWith(CLIENT_REF_PREFIX) && s.status !== 'ended')
    .filter((s) => isAdmin || s.client_ref === own)
    .map((s) => ({
      id: `auditor-${s.id}`,
      projectId: s.client_ref.slice(CLIENT_REF_PREFIX.length),
      projectTitle: s.language || '',
      type: 'AUDITOR_LIVE',
      status: 'RUNNING',
      phase: s.status || null,
      progress: 0,
      message: `${s.language || '?'} · ${s.transcripts ?? 0}`,
      error: null,
      workerId: 'auditor',
      cancelRequested: false,
      cancellable: false, // a live feed: never from the panel
      mode: auditorMode(s),
      createdAt: s.created || new Date().toISOString(),
      startedAt: s.created || null,
      completedAt: null,
    }));
}

/**
 * @param {object} [opts]
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @param {typeof fetch} [opts.fetch]
 * @param {() => { url?: string, apiKey?: string }} [opts.getAuditor]  read per call (settings can change hot)
 * @param {() => object[]} [opts.listRuns]
 * @param {(opts: object) => Promise<object|null>} [opts.readFleet]
 * @param {() => number} [opts.now]
 * @param {Set<string>} [opts.cancellablePurposes]  override of CANCELLABLE_PURPOSES (tests)
 */
export function createJobsPanelService({ env = process.env, fetch: fetchFn = globalThis.fetch, getAuditor = () => ({ url: env.AUDITOR_STT_URL, apiKey: env.AUDITOR_STT_API_KEY }), listRuns = listRunningFfmpegRuns, readFleet: readFleetFn = readFleet, now = Date.now, cancellablePurposes = CANCELLABLE_PURPOSES } = {}) {
  let cache = null; // { at, key, value }
  let inflight = null;

  /** Orchestrator and auditor, shared by all callers for OUTSIDE_CACHE_MS. */
  async function outside() {
    const auditor = getAuditor() || {};
    const key = `${auditor.url}|${auditor.apiKey}`;
    if (cache && cache.key === key && now() - cache.at < OUTSIDE_CACHE_MS) return cache.value;
    if (!inflight || inflight.key !== key) {
      const promise = (async () => {
        const [fleet, aud] = await Promise.all([
          readFleetFn({ env, fetch: fetchFn }).catch(() => ({ state: 'offline' })),
          readAuditor({ url: auditor.url, apiKey: auditor.apiKey, fetch: fetchFn }).catch(() => null),
        ]);
        cache = { at: now(), key, value: { fleet, auditor: aud } };
        return cache.value;
      })().finally(() => { if (inflight?.promise === promise) inflight = null; });
      inflight = { key, promise };
    }
    return inflight.promise;
  }

  return {
    /** `{ jobs, counts }` for the panel. */
    async jobs(scope) {
      const ext = await outside();
      const jobs = [...ffmpegRows(listRuns(), scope, { cancellablePurposes }), ...auditorRows(ext.auditor?.sessions ?? [], scope)];
      jobs.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
      return { jobs, counts: { running: jobs.length, queued: 0 } };
    },
    /**
     * Stops a cancellable run the caller may see.
     * @returns {Promise<{ ok: true } | { ok: false, status: 404 | 409, error: string }>}
     */
    async cancel(id, scope) {
      const run = listRuns().find((r) => r.id === id);
      const row = run && ffmpegRows([run], scope, { cancellablePurposes })[0];
      if (!row) {
        // Auditor rows are visible but never cancellable: answer 409, not 404, when the caller can see it.
        if (String(id).startsWith('auditor-')) {
          const ext = await outside();
          if (auditorRows(ext.auditor?.sessions ?? [], scope).some((r) => r.id === id)) return { ok: false, status: 409, error: 'A live session cannot be cancelled from the panel' };
        }
        return { ok: false, status: 404, error: 'Unknown job' };
      }
      if (!row.cancellable) return { ok: false, status: 409, error: 'This job cannot be cancelled from the panel' };
      try {
        await run.stop();
      } catch (err) {
        return { ok: false, status: 500, error: 'Could not stop the job' };
      }
      return { ok: true };
    },
    /** The fleet strip block. */
    async strip(scope) {
      const ext = await outside();
      const running = ffmpegRows(listRuns(), scope, { cancellablePurposes }).length;
      const queue = ext.auditor?.queue ?? null;
      const live = ext.auditor ? auditorRows(ext.auditor.sessions, scope).length : null;
      const sttRunning = queue ? Math.min(1, queue.total) : 0;
      return {
        enabled: true,
        fleet: ext.fleet ?? null,
        local: null,
        app: { running, queued: 0 },
        stt: queue ? { queued: queue.total - sttRunning, running: sttRunning } : null,
        live,
      };
    },
  };
}
