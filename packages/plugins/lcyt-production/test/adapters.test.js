import { test, describe, mock } from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// AMX adapter — unit tests (no live TCP; net.createConnection is mocked)
// ---------------------------------------------------------------------------

describe('AMX adapter', () => {
  /**
   * Build a fake AMX handle that simulates a connected socket without real TCP.
   */
  function makeHandle(connected = true) {
    const written = [];
    const socket = {
      write(data, _enc, cb) { written.push(data); if (cb) cb(null); },
      setKeepAlive() {},
      destroy() {},
      on() {},
      once() {},
    };
    return { socket, connected, host: '127.0.0.1', port: 1319, destroyed: false, written };
  }

  function makeCamera(presets = []) {
    return {
      name: 'Test Cam',
      controlConfig: {
        host: '127.0.0.1',
        port: 1319,
        presets,
      },
    };
  }

  test('callPreset sends command verbatim over TCP', async (t) => {
    // Import the module under test
    const { callPreset } = await import('../src/adapters/camera/amx.js');
    const handle = makeHandle(true);
    const camera = makeCamera([
      { id: 'wide', name: 'Wide', command: "SEND_COMMAND dvCam,'PRESET-1'" },
    ]);

    await callPreset(handle, camera, 'wide');

    assert.equal(handle.written.length, 1);
    assert.equal(handle.written[0], "SEND_COMMAND dvCam,'PRESET-1'\r\n");
  });

  test('callPreset throws for unknown presetId', async () => {
    const { callPreset } = await import('../src/adapters/camera/amx.js');
    const handle = makeHandle(true);
    const camera = makeCamera([{ id: 'wide', name: 'Wide', command: 'CMD' }]);

    await assert.rejects(
      () => callPreset(handle, camera, 'missing'),
      /unknown preset 'missing'/
    );
  });

  test('callPreset throws when not connected', async () => {
    const { callPreset } = await import('../src/adapters/camera/amx.js');
    const handle = makeHandle(false);
    const camera = makeCamera([{ id: 'wide', name: 'Wide', command: 'CMD' }]);

    await assert.rejects(
      () => callPreset(handle, camera, 'wide'),
      /not connected/
    );
  });

  test('callPreset passes command string unchanged (no transformation)', async () => {
    const { callPreset } = await import('../src/adapters/camera/amx.js');
    const rawCommand = "SEND_COMMAND dvCam,\"POSITION 123,456,789\"";
    const handle = makeHandle(true);
    const camera = makeCamera([{ id: 'p1', name: 'P1', command: rawCommand }]);

    await callPreset(handle, camera, 'p1');

    // The payload sent must be exactly rawCommand + CRLF, no alteration
    assert.equal(handle.written[0], rawCommand + '\r\n');
  });

  test('callPreset works with empty presets array gives clear error', async () => {
    const { callPreset } = await import('../src/adapters/camera/amx.js');
    const handle = makeHandle(true);
    const camera = makeCamera([]);

    await assert.rejects(
      () => callPreset(handle, camera, 'wide'),
      /unknown preset 'wide'/
    );
  });
});

// ---------------------------------------------------------------------------
// `none` adapter — unit tests
// ---------------------------------------------------------------------------

describe('none adapter', () => {
  test('connect returns a handle with connected=true', async () => {
    const { connect } = await import('../src/adapters/camera/none.js');
    const handle = await connect({});
    assert.equal(handle.connected, true);
    assert.equal(handle.type, 'none');
  });

  test('disconnect does not throw', async () => {
    const { connect, disconnect } = await import('../src/adapters/camera/none.js');
    const handle = await connect({});
    await assert.doesNotReject(() => disconnect(handle));
  });

  test('callPreset throws with a descriptive error', async () => {
    const { connect, callPreset } = await import('../src/adapters/camera/none.js');
    const handle = await connect({});
    const camera = { name: 'Overview', controlConfig: {} };
    await assert.rejects(
      () => callPreset(handle, camera, 'wide'),
      /no camera control/
    );
  });
});

// ---------------------------------------------------------------------------
// Registry — adapter resolution tests
// ---------------------------------------------------------------------------

describe('registry getCameraAdapter', () => {
  test('returns amx adapter for controlType amx', async () => {
    const { getCameraAdapter } = await import('../src/registry.js');
    const camera = { controlType: 'amx' };
    const adapter = getCameraAdapter(camera);
    assert.ok(typeof adapter.callPreset === 'function');
    assert.ok(typeof adapter.connect === 'function');
  });

  test('returns none adapter for controlType none', async () => {
    const { getCameraAdapter } = await import('../src/registry.js');
    const camera = { controlType: 'none' };
    const adapter = getCameraAdapter(camera);
    assert.ok(typeof adapter.callPreset === 'function');
  });

  test('throws for unknown controlType', async () => {
    const { getCameraAdapter } = await import('../src/registry.js');
    assert.throws(
      () => getCameraAdapter({ controlType: 'unknown-type' }),
      /unknown camera controlType/
    );
  });
});
