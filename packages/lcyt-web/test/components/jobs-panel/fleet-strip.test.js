import { describe, expect, it } from 'vitest';
import { getMessages } from '../../../src/lib/i18n.js';
import { makePanelT } from '../../../src/components/JobsIndicator.jsx';
import { formatFleetStrip, summariseFleet } from '../../../src/components/jobs-panel/fleet-strip.js';

const t = makePanelT(getMessages('en'));
const app = { running: 1, queued: 4 };

describe('formatFleetStrip', { timeout: 10_000 }, () => {
  it('writes the whole strip for a fleet with pools and a speech-to-text queue', () => {
    const data = {
      fleet: { state: 'ok', workers: 3, slotsUsed: 5, slotsTotal: 8, queued: 2, pools: [{ name: 'hetzner', instances: 1, max: 5 }] },
      local: null, app, stt: { queued: 1, running: 0 },
    };
    expect(formatFleetStrip(data, t)).toBe('fleet 3w · slots 5/8 · queue 2 · hetzner 1/5 · app 1 run / 4 queued · stt 1 queued');
  });
  it('adds the live translation sessions (LCYT)', () => {
    const data = { fleet: null, local: null, app, stt: { queued: 0, running: 1 }, live: 1 };
    expect(formatFleetStrip(data, t)).toBe('app 1 run / 4 queued · stt 1 run / 0 queued · live translation 1');
  });
  it('leaves out what is unknown (capabilities only, no stt, no live sessions)', () => {
    const data = { fleet: { state: 'ok', workers: 1, slotsUsed: 0, slotsTotal: 2, queued: 0 }, local: null, app: { running: 0, queued: 0 }, stt: null, live: 0 };
    expect(formatFleetStrip(data, t)).toBe('fleet 1w · slots 0/2 · queue 0 · app 0 run / 0 queued');
  });
  it('says offline when the orchestrator does not answer', () => {
    expect(formatFleetStrip({ fleet: { state: 'offline' }, local: null, app, stt: null }, t)).toBe('fleet offline · app 1 run / 4 queued');
  });
  it('shows the local worker lanes without a fleet', () => {
    expect(formatFleetStrip({ fleet: null, local: { workers: 2, lanes: 8 }, app, stt: null }, t)).toBe('local · workers 2 · lanes 1/8 · app 1 run / 4 queued');
  });
});

describe('summariseFleet', { timeout: 10_000 }, () => {
  const caps = { workers: 2, slots: { default: { total: 6, used: 2 }, gpu: { total: 2, used: 1 } }, queued: 3 };
  it('uses capabilities alone when the lists are refused', () => {
    expect(summariseFleet(caps, null, null)).toEqual({ state: 'ok', workers: 2, slotsUsed: 3, slotsTotal: 8, queued: 3 });
  });
  it('takes workers and pools when allowed and ignores slots of draining workers', () => {
    const workers = { workers: [{ slots: { default: 4 }, used: { default: 1 } }, { draining: true, slots: { default: 4 }, used: {} }] };
    expect(summariseFleet(caps, workers, { pools: [{ name: 'hetzner', instances: 1, max: 5 }] })).toEqual({
      state: 'ok', workers: 2, slotsUsed: 1, slotsTotal: 4, queued: 3, draining: 1, pools: [{ name: 'hetzner', instances: 1, max: 5 }],
    });
  });
});
