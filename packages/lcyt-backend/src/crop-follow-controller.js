/**
 * Crop auto-follow (plan_perception_completion.md Phase 4): while a project's vertical crop is running with
 * `autoFollow` on, keep the crop window on the people the detector sees in the camera that is on program.
 * Opt-in per project (crop_config.auto_follow), smoothed, and conservative: it only moves the window when it is sure
 * which camera is on program, and leaves it where it is when nobody is detected.
 *
 * Lives here (not in lcyt-rtmp) because it joins three things only the composition root holds: perception output
 * (EventBus camera.track_state), the feed attributor (which camera is on program) and the crop manager.
 */

/**
 * @param {{
 *   db: import('better-sqlite3').Database,
 *   eventBus: { tap: (fn: (e: object) => void) => () => void },
 *   cropManager: { isRunning: Function, getStatus: Function, applyPosition: Function },
 *   attributor: { getTag: (apiKey: string) => { cameraId: string|null } },
 *   getCropConfig: (db: object, apiKey: string) => { enabled: boolean, autoFollow: boolean },
 *   follow: { targetCenter: Function, xNormForCenter: Function, createFollowSmoother: Function },
 *   preferRoles?: string[], moveMs?: number, now?: () => number,
 * }} deps
 */
export function createCropFollowController({
  db, eventBus, cropManager, attributor, getCropConfig, follow,
  preferRoles = (process.env.CROP_FOLLOW_ROLES || 'preacher,speaker').split(',').map((s) => s.trim()).filter(Boolean),
  moveMs = 500, now = () => Date.now(),
}) {
  const { targetCenter, xNormForCenter, createFollowSmoother } = follow;
  /** @type {Map<string, { smoother: object, presetSeen: string|null }>} */
  const state = new Map();
  let busy = new Set();

  async function handle(apiKey, data) {
    if (busy.has(apiKey)) return;
    const cfg = getCropConfig(db, apiKey);
    if (!cfg.enabled || !cfg.autoFollow || !cropManager.isRunning(apiKey)) return;
    const tag = attributor.getTag(apiKey);
    if (!tag?.cameraId || tag.cameraId !== data.cameraId) return; // only the camera that is on program
    if (!data.visible) return;

    const st = cropManager.getStatus(apiKey);
    if (!st.running || !st.inW || !st.cropW) return;
    let s = state.get(apiKey);
    if (!s) { s = { smoother: createFollowSmoother(), presetSeen: null }; state.set(apiKey, s); }
    // A preset was applied by someone else (operator, production-follow): re-anchor to where the window is now.
    if (st.activePresetId && st.activePresetId !== s.presetSeen) { s.smoother.reset(); }
    s.presetSeen = st.activePresetId ?? null;

    const center = targetCenter(data.subjects, { windowFrac: st.cropW / st.inW, preferRoles });
    const target = center == null ? null : xNormForCenter(center, { inW: st.inW, cropW: st.cropW });
    const move = s.smoother.next(st.xNorm ?? 0.5, target, now());
    if (move == null) return;
    busy.add(apiKey);
    try {
      await cropManager.applyPosition(apiKey, { xNorm: move, yNorm: st.yNorm ?? 0, transitionMs: moveMs, activePresetId: null });
    } catch { /* renderer stopped meanwhile: nothing to follow */ } finally { busy.delete(apiKey); }
  }

  const untap = eventBus.tap((e) => {
    if (e.topic !== 'camera.track_state') return;
    void handle(e.projectId, e.data || {});
  });

  return { handle, clearProject: (apiKey) => state.delete(apiKey), stop: () => { untap(); state.clear(); } };
}
