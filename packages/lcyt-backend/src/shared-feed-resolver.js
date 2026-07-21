/**
 * Shared/single-feed resolver (plan_video_perception.md §1 "Two camera-feed
 * topologies", tmp_plan_video_perception.md Phase 3): a mixer-input-only
 * camera (amx/visca-ip, no `cameraKey`) has no independent feed — detections
 * can only be produced while it happens to be live on the shared program
 * feed. `lcyt-production`'s perception-manager dispatches one shared-feed
 * job per project (`SHARED_FEED_CAMERA_ID` sentinel `cameraId`); this
 * resolver tags each of that job's detections with whichever camera is
 * actually on program right now, using `DeviceRegistry`'s existing
 * `onProgramChanged`/`onCameraPresetRecalled` signals — the same plain
 * callback API `plan_vertical_crop.md` Phase 4's production-follow already
 * consumes (`CropManager.applyForSource()`), not yet promoted to a real
 * EventBus event. Per the phase plan's recommendation, promoting that is
 * a worthwhile follow-up once a second real consumer needs it — this is
 * that second consumer, but migrating the existing one is out of scope
 * here (this resolver just registers its own listener alongside it).
 *
 * Lives in lcyt-backend (not a plugin) for the same reason
 * perception-aggregator.js does: it needs to call the aggregator directly
 * to emit the outgoing camera's `visible: false` transition, a cross-plugin
 * capability only the composition root holds.
 */

import { SHARED_FEED_CAMERA_ID } from 'lcyt-production';

/**
 * @param {{
 *   db: import('better-sqlite3').Database,
 *   registry: import('lcyt-production').DeviceRegistry,
 *   aggregator: { ingest: (apiKey: string, detection: object) => void },
 * }} deps
 */
export function createSharedFeedResolver({ db, registry, aggregator }) {
  /** @type {Map<string, string|null>} apiKey -> cameraId currently on program */
  const activeCameraByApiKey = new Map();

  function _cameraForMixerInput(inputNumber) {
    if (inputNumber == null) return null;
    const row = db.prepare('SELECT id FROM prod_cameras WHERE mixer_input = ?').get(inputNumber);
    return row ? row.id : null;
  }

  function _setActiveCamera(apiKey, newCameraId) {
    const prev = activeCameraByApiKey.get(apiKey) ?? null;
    if (prev === newCameraId) return;
    if (prev) {
      // Confirmed absent, not silence — see plan §1's explicit requirement.
      aggregator.ingest(apiKey, { cameraId: prev, ts: Date.now(), objects: [], visible: false });
    }
    activeCameraByApiKey.set(apiKey, newCameraId ?? null);
  }

  const unsubscribeProgramChanged = registry?.onProgramChanged?.(({ apiKey, inputNumber }) => {
    if (!apiKey) return;
    _setActiveCamera(apiKey, _cameraForMixerInput(inputNumber));
  }) ?? null;

  const unsubscribePresetRecalled = registry?.onCameraPresetRecalled?.(({ apiKey, cameraId }) => {
    if (!apiKey || !cameraId) return;
    _setActiveCamera(apiKey, cameraId);
  }) ?? null;

  /**
   * Re-tag a shared-feed job's detection with the currently-active camera.
   * @param {string} apiKey
   * @param {object} detection — cameraId is expected to be SHARED_FEED_CAMERA_ID
   * @returns {object|null} the re-tagged detection, or null if no camera is
   *   currently resolved for this project (nothing to report yet — dropped,
   *   not forwarded with a made-up cameraId)
   */
  function tagSharedDetection(apiKey, detection) {
    const cameraId = activeCameraByApiKey.get(apiKey) ?? null;
    if (!cameraId) return null;
    return { ...detection, cameraId };
  }

  function isSharedFeedDetection(detection) {
    return detection?.cameraId === SHARED_FEED_CAMERA_ID;
  }

  function activeCameraFor(apiKey) {
    return activeCameraByApiKey.get(apiKey) ?? null;
  }

  function stop() {
    unsubscribeProgramChanged?.();
    unsubscribePresetRecalled?.();
  }

  return { tagSharedDetection, isSharedFeedDetection, activeCameraFor, stop };
}
