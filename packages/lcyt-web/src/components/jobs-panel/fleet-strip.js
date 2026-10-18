/**
 * SHARED-COMPONENT NOTICE: copied between SaarnaVideo and LCYT (see job-panel.js and README.md). LCYT-only addition:
 * `live` (live translation sessions on the speech-to-text service), port it back when SaarnaVideo needs it.
 *
 * The numbers behind the one-line fleet strip in the job panel. Every block is optional so a missing source
 * (no fleet configured, no speech-to-text key, orchestrator without admin rights) just leaves its part out.
 *
 * @typedef {{ name: string, instances: number, max: number }} FleetPool
 *
 * @typedef {object} FleetStripData
 * @property {null | { state: 'ok' | 'offline', workers?: number, slotsUsed?: number, slotsTotal?: number, queued?: number, draining?: number, pools?: FleetPool[] }} fleet
 *   An fffleet orchestrator is configured (FFFLEET_URL). `offline` = it did not answer.
 * @property {null | { workers: number, lanes: number }} local  No fleet: the worker processes of the app and their lanes.
 * @property {{ running: number, queued: number }} app  The app's own jobs.
 * @property {null | { queued: number, running: number }} stt  Speech-to-text service queue from its /status; null when unavailable.
 * @property {number | null} [live]  LCYT only: active live translation sessions of this caller on the speech-to-text service.
 */

/** The strip as parts; the panel joins them with a middle dot. */
export function fleetStripParts(data, t) {
  const parts = [];
  const { fleet, local } = data;
  if (fleet?.state === 'offline') parts.push(t('fleetStrip.offline'));
  else if (fleet) {
    if (fleet.workers !== undefined) parts.push(t('fleetStrip.workers', { count: fleet.workers }));
    if (fleet.slotsTotal !== undefined) parts.push(t('fleetStrip.slots', { used: fleet.slotsUsed ?? 0, total: fleet.slotsTotal }));
    if (fleet.queued !== undefined) parts.push(t('fleetStrip.queue', { count: fleet.queued }));
    if (fleet.draining) parts.push(t('fleetStrip.draining', { count: fleet.draining }));
    for (const pool of fleet.pools ?? []) parts.push(`${pool.name} ${pool.instances}/${pool.max}`);
  } else if (local) {
    parts.push(t('fleetStrip.local'));
    parts.push(t('fleetStrip.localWorkers', { count: local.workers }));
    parts.push(t('fleetStrip.lanes', { used: Math.min(data.app.running, local.lanes), total: local.lanes }));
  }
  parts.push(t('fleetStrip.app', { running: data.app.running, queued: data.app.queued }));
  if (data.stt) parts.push(data.stt.running > 0 ? t('fleetStrip.sttBusy', { running: data.stt.running, queued: data.stt.queued }) : t('fleetStrip.stt', { queued: data.stt.queued }));
  if (data.live) parts.push(t('fleetStrip.live', { count: data.live }));
  return parts;
}

export const formatFleetStrip = (data, t) => fleetStripParts(data, t).join(' · ');

/** Summarises the orchestrator's answers into the fleet block. `workers` and `pools` are the admin-only lists (null when refused). */
export function summariseFleet(capabilities, workers, pools) {
  const sum = (values) => values.reduce((acc, v) => ({ total: acc.total + v.total, used: acc.used + v.used }), { total: 0, used: 0 });
  let slots = sum(Object.values(capabilities.slots ?? {}));
  let count = capabilities.workers;
  let draining;
  if (workers?.workers) {
    // Slots of a draining worker take no new work: they do not count as capacity.
    const list = workers.workers;
    count = list.length;
    draining = list.filter((w) => w.draining).length;
    slots = sum(list.filter((w) => !w.draining).map((w) => ({ total: Object.values(w.slots ?? {}).reduce((a, b) => a + b, 0), used: Object.values(w.used ?? {}).reduce((a, b) => a + b, 0) })));
  }
  return {
    state: 'ok',
    workers: count,
    slotsUsed: slots.used,
    slotsTotal: slots.total,
    queued: capabilities.queued,
    ...(draining ? { draining } : {}),
    ...(pools?.pools?.length ? { pools: pools.pools.map((p) => ({ name: p.name, instances: p.instances, max: p.max })) } : {}),
  };
}
