import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  slugifyLabel, cameraAtom, mixerAtom, mixerInputs, duplicateRefs, cameraRef, appendStep,
  runUsesDevices, buildRuleAction, foldActionEvent,
} from '../src/lib/action-atoms.js';

function subset(actual, expected) {
  for (const [k, v] of Object.entries(expected)) assert.equal(actual[k], v, k);
}

describe('action atoms', () => {
  it('slugifies like the server', () => {
    assert.equal(slugifyLabel('  Pulpit — Wide!  '), 'pulpit-wide');
    assert.equal(slugifyLabel(null), '');
  });

  it('builds camera atoms from label, name, preset number or id', () => {
    assert.equal(cameraAtom({ id: 'c1', name: 'Pulpit Cam' }, { id: 'p1', name: 'Wide Shot' }), 'camera:pulpit-cam.wide-shot');
    assert.equal(cameraAtom({ id: 'c1', label: 'Altar', name: 'x' }, { id: 'p1', presetNumber: 3 }), 'camera:altar.3');
    assert.equal(cameraAtom({ id: 'c1' }, { id: 'p9' }), 'camera:c1.p9');
  });

  it('builds mixer atoms and lists named inputs', () => {
    assert.equal(mixerAtom({ id: 'm', name: 'Main Mixer' }, 2), 'mixer:main-mixer.2');
    assert.deepEqual(
      mixerInputs({ connectionConfig: { inputs: [{ number: 1, sceneName: 'Wide' }, { number: 2 }, { sceneName: 'bad' }] } }),
      [{ value: '1', label: '1 · Wide' }, { value: '2', label: '2' }],
    );
    assert.deepEqual(mixerInputs({}), []);
  });

  it('finds refs shared by several devices', () => {
    const cams = [{ id: 'a', name: 'Cam' }, { id: 'b', name: 'cam' }, { id: 'c', name: 'Other' }];
    assert.deepEqual([...duplicateRefs(cams, cameraRef)], ['cam']);
  });

  it('appends steps with a pipe', () => {
    assert.equal(appendStep('', 'a:b'), 'a:b');
    assert.equal(appendStep(' @intro ', 'camera:x.y'), '@intro | camera:x.y');
    assert.equal(appendStep('a:b', '  '), 'a:b');
  });

  it('detects device atoms', () => {
    assert.equal(runUsesDevices('audio:start | wait:2s'), false);
    assert.equal(runUsesDevices('@intro | Camera:a.b'), true);
    assert.equal(runUsesDevices('graphics[vertical]:+x | crop:wide'), true);
    assert.equal(runUsesDevices(''), false);
  });

  it('merges the form into a rule action without dropping other keys', () => {
    assert.deepEqual(
      buildRuleAction({ type: 'event', label: 'old', cooldownMs: 0, stopOnError: true }, { label: 'New', run: ' camera:a.b ' }),
      { type: 'event', label: 'New', cooldownMs: 0, stopOnError: true, run: 'camera:a.b' },
    );
    assert.deepEqual(buildRuleAction({ type: 'event', label: 'old', run: 'x:y' }, { label: '', run: '' }), {});
    assert.deepEqual(buildRuleAction(undefined, { run: 'a:b' }), { run: 'a:b' });
  });

  it('folds action events into run summaries, newest first', () => {
    let runs = [];
    runs = foldActionEvent(runs, { topic: 'action.started', ts: 1, data: { runId: 'r1', action: '@intro', source: 'cue' } });
    runs = foldActionEvent(runs, { topic: 'action.step', ts: 2, data: { runId: 'r1', index: 0, atom: 'camera:a.b', status: 'skipped', reason: 'disarmed' } });
    runs = foldActionEvent(runs, { topic: 'action.step', ts: 3, data: { runId: 'r1', index: 1, atom: 'audio:start', status: 'client' } });
    runs = foldActionEvent(runs, { topic: 'action.completed', ts: 4, data: { runId: 'r1' } });
    runs = foldActionEvent(runs, { topic: 'action.skipped', ts: 5, data: { action: 'x:y', source: 'cue', reason: 'cooldown' } });
    assert.equal(runs.length, 2);
    subset(runs[0], { status: 'skipped', reason: 'cooldown' });
    subset(runs[1], { runId: 'r1', status: 'done', source: 'cue' });
    assert.deepEqual(runs[1].steps.map((s) => s.status), ['skipped', 'browser']);
    assert.equal(foldActionEvent(runs, { topic: 'caption.sent', data: {} }), runs);
    subset(foldActionEvent([], { topic: 'action.failed', ts: 1, data: { runId: 'z', error: 'nope' } })[0], { status: 'failed', error: 'nope' });
  });
});
