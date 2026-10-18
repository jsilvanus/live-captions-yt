import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { trackFfmpegRun, listRunningFfmpegRuns } from '../src/ffmpeg/run-registry.js';

describe('ffmpeg run registry', { timeout: 10_000 }, () => {
  it('lists a run from start until it is untracked, once', () => {
    const before = listRunningFfmpegRuns().length;
    const untrack = trackFfmpegRun({ purpose: 'hls', apiKey: 'k1', runner: 'fleet' });
    const runs = listRunningFfmpegRuns();
    assert.equal(runs.length, before + 1);
    const mine = runs.find((r) => r.purpose === 'hls' && r.apiKey === 'k1');
    assert.equal(mine.runner, 'fleet');
    assert.ok(mine.startedAt <= Date.now());
    untrack();
    untrack();
    assert.equal(listRunningFfmpegRuns().length, before);
  });

  it('returns copies', () => {
    const untrack = trackFfmpegRun({ purpose: 'x' });
    listRunningFfmpegRuns().forEach((r) => { r.purpose = 'changed'; });
    assert.ok(listRunningFfmpegRuns().some((r) => r.purpose === 'x'));
    untrack();
  });

  it('keeps an optional stop function, null otherwise', () => {
    const stop = () => {};
    const a = trackFfmpegRun({ purpose: 'with-stop', stop });
    const b = trackFfmpegRun({ purpose: 'without-stop' });
    const runs = listRunningFfmpegRuns();
    assert.equal(runs.find((r) => r.purpose === 'with-stop').stop, stop);
    assert.equal(runs.find((r) => r.purpose === 'without-stop').stop, null);
    a(); b();
  });
});
