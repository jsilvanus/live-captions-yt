/**
 * Concrete lifecycle steps (plan_broadcast_lifecycle.md 2.3), built from the
 * pieces the composition root already owns. Every step is `(ctx) => Promise`,
 * idempotent, and may throw; the lifecycle decides which failures are fatal.
 * A dependency that is not given leaves its step out (it is skipped).
 *
 * ctx = { db, apiKey, broadcast, results, report, reason, by, force }
 */

import { armOnGoLive, disarmOnEnd } from '../db/arming.js';
import { startRecordingGroup, stopRecordingGroup } from '../recording/feeds.js';

/**
 * @param {object} deps
 * @param {import('../db/connection.js').Db} deps.db
 * @param {{ publish: Function }|null} [deps.eventBus]
 * @param {import('./caption-sync.js').createBroadcastCaptionSync extends (...a: any) => infer R ? R : never} [deps.captionSync]
 * @param {{ transition: Function, markStopped: Function }|null} [deps.platform]  lcyt-platforms `createPlatformTransitions`
 * @param {{ on: (apiKey: string) => Promise<any>, off: (apiKey: string) => Promise<any> }|null} [deps.relay]  today's relay switch
 * @param {{ preflight?: (ctx: object) => Promise<object[]> }} [deps.checks]
 * @param {object|null} [deps.mediamtxClient]
 * @param {object|null} [deps.recordingsStore]
 * @param {object|null} [deps.settings]
 * @param {(info: { apiKey: string, groupId: string, results: any[] }) => any} [deps.onRecordingFinalized]
 */
export function createLifecycleSteps(deps) {
  const {
    db, eventBus = null, captionSync = null, platform = null, relay = null, checks = null,
    mediamtxClient = null, recordingsStore = null, settings = null, onRecordingFinalized = null,
  } = deps;

  /** broadcastId -> recording group id of the current go-live (a stop and re-up makes a new group). */
  const groups = new Map();
  const startedAt = new Map();

  const steps = {
    preflight: checks?.preflight,

    async outputsOn({ apiKey }) {
      if (!relay) return { note: 'no relay configured' };
      await relay.on(apiKey);
    },
    async outputsOff({ apiKey }) {
      if (!relay) return;
      await relay.off(apiKey);
    },

    // Scheduling a YouTube broadcast (and binding its stream key) is still the
    // manual platform route; staging only reports whether a link exists.
    async platformStage({ broadcast }) {
      if (!platform) return { note: 'no platform' };
      const links = await db.broadcast_platform_links.count({ where: { broadcast_id: broadcast.id } });
      return { note: links ? 'platform link present' : 'no platform link; staging without YouTube' };
    },

    async captionSync({ apiKey, broadcast }) {
      if (!captionSync) return;
      const r = await captionSync.syncNow(apiKey, broadcast.id);
      return { note: r.ok ? `offset ${r.offsetMs} ms` : `no sync yet (${r.error})` };
    },

    async platformGoLive({ apiKey, broadcast }) {
      if (!platform) return;
      const r = await platform.transition(apiKey, broadcast.id, 'live');
      return { note: r.skipped ? r.reason : `platform ${r.status}` };
    },

    async startRecording({ apiKey, broadcast }) {
      if (!broadcast.recordEnabled) return { note: 'recording off' };
      if (groups.has(broadcast.id)) return { note: 'already recording' };
      const startAt = new Date().toISOString();
      const group = await startRecordingGroup(db, {
        apiKey, broadcastId: broadcast.id, title: broadcast.title || 'Recorded broadcast', startedAt: startAt,
        recordingsStore, mediamtxClient, settings, eventBus,
      });
      groups.set(broadcast.id, group.groupId);
      startedAt.set(broadcast.id, Date.parse(startAt));
      return { note: `group ${group.groupId}` };
    },

    async arm({ apiKey, broadcast }) {
      await armOnGoLive(db, eventBus, apiKey, broadcast.id);
    },

    async startCaptionSync({ apiKey, broadcast }) {
      if (!captionSync) return;
      captionSync.start(apiKey, broadcast.id);
      await captionSync.syncNow(apiKey, broadcast.id);
    },

    async stopCaptionSync({ broadcast }) {
      captionSync?.stop(broadcast.id);
    },

    async disarm({ apiKey, broadcast }) {
      await disarmOnEnd(db, eventBus, apiKey, broadcast.id);
    },

    async stopRecording({ apiKey, broadcast }) {
      const groupId = groups.get(broadcast.id);
      if (!groupId) return { note: 'no recording' };
      const t0 = startedAt.get(broadcast.id);
      await stopRecordingGroup(db, {
        apiKey, groupId, endedAt: new Date().toISOString(),
        durationMs: Number.isFinite(t0) ? Math.max(0, Date.now() - t0) : null,
        mediamtxClient, recordingsStore, settings,
        delayMs: settings ? settings.get('retention.recording_upload_delay_ms') : undefined,
        onGroupFinalized: onRecordingFinalized,
      });
      groups.delete(broadcast.id);
      startedAt.delete(broadcast.id);
    },

    // YouTube is not completed by a stop: the broadcast can go up again.
    async platformStop({ broadcast }) {
      await platform?.markStopped(broadcast.id);
    },

    async platformComplete({ apiKey, broadcast }) {
      if (!platform) return;
      const r = await platform.transition(apiKey, broadcast.id, 'complete');
      return { note: r.skipped ? r.reason : `platform ${r.status}` };
    },
  };

  // Steps whose dependency is absent are simply not defined.
  for (const k of Object.keys(steps)) if (typeof steps[k] !== 'function') delete steps[k];
  return steps;
}

// closeSessions (PR 3) and the completion handoff are not steps yet: sessions are
// still bound the old way until the session is decoupled, and HANDOFF_AUTO_SEND
// already fires when a recording group is finalized.
