/**
 * Wires the perception runner (src/perception/*) into one worker-daemon job:
 * poll the camera's frame source, run the stub detector, POST each
 * detection back to the caller-supplied callback URL (plan_video_perception.md
 * Phase 2 Stream B).
 */

import { createHttpFrameSource } from './perception/frame-source.js';
import { createStubDetector } from './perception/stub-backend.js';
import { createPerceptionRunner } from './perception/runner.js';

/**
 * @param {{ cameraId: string, apiKey: string, frameUrl: string, callbackUrl?: string, internalToken?: string, emitIntervalMs?: number }} plan
 * @param {string} jobId
 * @param {{ fetchImpl?: typeof fetch }} [opts]
 * @returns {{ start: () => void, stop: () => void }}
 */
export function createPerceptionJob(plan, jobId, { fetchImpl = fetch } = {}) {
  const frameSource = createHttpFrameSource(plan.frameUrl, { fetchImpl });
  const backend = createStubDetector();

  async function postDetection(detection) {
    if (!plan.callbackUrl) return;
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (plan.internalToken) headers['X-Internal-Auth'] = plan.internalToken;
      const res = await fetchImpl(plan.callbackUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({ apiKey: plan.apiKey, ...detection }),
      });
      if (!res.ok) {
        console.error(`perception job ${jobId} callback rejected: ${res.status}`);
      }
    } catch (err) {
      console.error(`perception job ${jobId} callback failed:`, err && err.message);
    }
  }

  return createPerceptionRunner(plan.cameraId, frameSource, {
    emitIntervalMs: plan.emitIntervalMs,
    backend,
    onDetection: postDetection,
    onError: (err) => console.error(`perception job ${jobId} detect error:`, err && err.message),
  });
}
