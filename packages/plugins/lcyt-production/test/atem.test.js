import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

// ---------------------------------------------------------------------------
// ATEM adapter unit tests — no live UDP; exercise state via injected handles
// ---------------------------------------------------------------------------

/**
 * Build a fake Atem instance that mirrors the atem-connection Atem class
 * without opening any network connections.
 */
function makeFakeAtem({ programInput = null } = {}) {
  const atem = new EventEmitter();
  const switched = [];

  atem.state = programInput != null
    ? { video: { mixEffects: [{ programInput }] } }
    : null;

  atem.connect    = () => {};
  atem.disconnect = () => {};
  atem.changeProgramInput = async (input, me = 0) => {
    switched.push({ input, me });
    // Update state to reflect the switch
    if (atem.state) {
      atem.state.video.mixEffects[me] = { programInput: input };
    }
  };

  atem._switched = switched;
  return atem;
}

/**
 * Build a fake ATEM handle (what connect() would return).
 */
function makeHandle({ connected = true, host = '192.168.1.100', meIndex = 0, programInput = null } = {}) {
  return {
    atem: makeFakeAtem({ programInput }),
    host,
    meIndex,
    connected,
    destroyed: false,
    _reconnectTimer: null,
    _reconnectDelay: 5000,
  };
}

// ---------------------------------------------------------------------------
// getSwitchCommand — pure function, no handle needed
// ---------------------------------------------------------------------------

describe('ATEM adapter — getSwitchCommand', () => {
  test('returns typed atem_switch command object', async () => {
    const { getSwitchCommand } = await import('../src/adapters/mixer/atem.js');
    const result = getSwitchCommand({ host: '192.168.1.10', meIndex: 0 }, 3);

    assert.deepEqual(result, {
      type: 'atem_switch',
      host: '192.168.1.10',
      meIndex: 0,
      inputNumber: 3,
    });
  });

  test('defaults meIndex to 0 when not specified', async () => {
    const { getSwitchCommand } = await import('../src/adapters/mixer/atem.js');
    const result = getSwitchCommand({ host: '192.168.1.10' }, 2);

    assert.equal(result.meIndex, 0);
    assert.equal(result.inputNumber, 2);
    assert.equal(result.type, 'atem_switch');
  });

  test('respects non-zero meIndex', async () => {
    const { getSwitchCommand } = await import('../src/adapters/mixer/atem.js');
    const result = getSwitchCommand({ host: '192.168.1.10', meIndex: 1 }, 5);

    assert.equal(result.meIndex, 1);
    assert.equal(result.inputNumber, 5);
  });
});

// ---------------------------------------------------------------------------
// switchSource
// ---------------------------------------------------------------------------

describe('ATEM adapter — switchSource', () => {
  test('calls changeProgramInput with correct (input, meIndex) args', async () => {
    const { switchSource } = await import('../src/adapters/mixer/atem.js');
    const handle = makeHandle({ connected: true, meIndex: 0 });

    await switchSource(handle, 3);

    assert.equal(handle.atem._switched.length, 1);
    assert.equal(handle.atem._switched[0].input, 3);
    assert.equal(handle.atem._switched[0].me, 0);
  });

  test('uses non-zero meIndex from handle config', async () => {
    const { switchSource } = await import('../src/adapters/mixer/atem.js');
    const handle = makeHandle({ connected: true, meIndex: 1 });

    await switchSource(handle, 2);

    assert.equal(handle.atem._switched[0].me, 1);
    assert.equal(handle.atem._switched[0].input, 2);
  });

  test('throws when not connected', async () => {
    const { switchSource } = await import('../src/adapters/mixer/atem.js');
    const handle = makeHandle({ connected: false });

    await assert.rejects(
      () => switchSource(handle, 1),
      /not connected/
    );
  });

  test('throws when atem is null', async () => {
    const { switchSource } = await import('../src/adapters/mixer/atem.js');
    const handle = makeHandle({ connected: true });
    handle.atem = null;

    await assert.rejects(
      () => switchSource(handle, 1),
      /not connected/
    );
  });
});

// ---------------------------------------------------------------------------
// getActiveSource
// ---------------------------------------------------------------------------

describe('ATEM adapter — getActiveSource', () => {
  test('returns null when atem is null', async () => {
    const { getActiveSource } = await import('../src/adapters/mixer/atem.js');
    const handle = makeHandle();
    handle.atem = null;
    assert.equal(getActiveSource(handle), null);
  });

  test('returns null when state is null', async () => {
    const { getActiveSource } = await import('../src/adapters/mixer/atem.js');
    const handle = makeHandle();
    handle.atem.state = null;
    assert.equal(getActiveSource(handle), null);
  });

  test('returns null when mixEffects is empty', async () => {
    const { getActiveSource } = await import('../src/adapters/mixer/atem.js');
    const handle = makeHandle();
    handle.atem.state = { video: { mixEffects: [] } };
    assert.equal(getActiveSource(handle), null);
  });

  test('returns programInput from state for meIndex 0', async () => {
    const { getActiveSource } = await import('../src/adapters/mixer/atem.js');
    const handle = makeHandle({ meIndex: 0, programInput: 4 });
    assert.equal(getActiveSource(handle), 4);
  });

  test('returns programInput from the correct meIndex', async () => {
    const { getActiveSource } = await import('../src/adapters/mixer/atem.js');
    const handle = makeHandle({ meIndex: 1 });
    handle.atem.state = { video: { mixEffects: [
      { programInput: 1 },
      { programInput: 7 },
    ] } };
    assert.equal(getActiveSource(handle), 7);
  });
});

// ---------------------------------------------------------------------------
// disconnect
// ---------------------------------------------------------------------------

describe('ATEM adapter — disconnect', () => {
  test('sets destroyed=true and connected=false', async () => {
    const { disconnect } = await import('../src/adapters/mixer/atem.js');
    const handle = makeHandle({ connected: true });

    await disconnect(handle);

    assert.equal(handle.destroyed, true);
    assert.equal(handle.connected, false);
  });

  test('clears reconnect timer if set', async () => {
    const { disconnect } = await import('../src/adapters/mixer/atem.js');
    const handle = makeHandle({ connected: true });
    let timerCleared = false;
    handle._reconnectTimer = setTimeout(() => {}, 10000);
    const orig = clearTimeout;
    // Track that the timer is cleared by checking handle state
    await disconnect(handle);
    clearTimeout(handle._reconnectTimer); // cleanup
    assert.equal(handle._reconnectTimer, null);
  });

  test('does not throw if atem is null', async () => {
    const { disconnect } = await import('../src/adapters/mixer/atem.js');
    const handle = makeHandle({ connected: true });
    handle.atem = null;

    await assert.doesNotReject(() => disconnect(handle));
    assert.equal(handle.connected, false);
    assert.equal(handle.destroyed, true);
  });
});

// ---------------------------------------------------------------------------
// Registry — getMixerAdapter resolution for atem
// ---------------------------------------------------------------------------

describe('registry getMixerAdapter — atem', () => {
  test('returns atem adapter for type atem', async () => {
    const { getMixerAdapter } = await import('../src/registry.js');
    const adapter = getMixerAdapter({ type: 'atem' });
    assert.ok(typeof adapter.connect === 'function');
    assert.ok(typeof adapter.disconnect === 'function');
    assert.ok(typeof adapter.switchSource === 'function');
    assert.ok(typeof adapter.getActiveSource === 'function');
    assert.ok(typeof adapter.getSwitchCommand === 'function');
  });
});
