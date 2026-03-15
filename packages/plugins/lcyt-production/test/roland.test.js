import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// Roland adapter unit tests — no live TCP; exercise state via injected handles
// ---------------------------------------------------------------------------

/**
 * Build a fake Roland handle with a mock socket.
 */
function makeHandle({ connected = true, activeSource = null } = {}) {
  const written = [];
  const socket = {
    write(data, _enc, cb) { written.push(data); if (cb) cb(null); },
    destroy() {},
    setEncoding() {},
    setTimeout() {},
    on() {},
    once() {},
    setKeepAlive() {},
  };
  return {
    _socket: socket,
    connected,
    destroyed: false,
    host: '127.0.0.1',
    port: 8023,
    _activeSource: activeSource,
    _lineBuffer: '',
    _reconnectTimer: null,
    written,
  };
}

describe('Roland adapter — switchSource', () => {
  test('switchSource sends a JSON command to the socket', async () => {
    const { switchSource } = await import('../src/adapters/mixer/roland.js');
    const handle = makeHandle({ connected: true });

    await switchSource(handle, 2);

    assert.equal(handle.written.length, 1);
    const parsed = JSON.parse(handle.written[0].trimEnd());
    assert.equal(parsed.method, 'set');
    assert.equal(parsed.params?.name, 'program');
    // input number matches what we passed
    assert.equal(parsed.params?.inputBus?.number, 2);
  });

  test('switchSource updates _activeSource optimistically', async () => {
    const { switchSource } = await import('../src/adapters/mixer/roland.js');
    const handle = makeHandle({ connected: true, activeSource: 1 });

    await switchSource(handle, 3);

    assert.equal(handle._activeSource, 3);
  });

  test('switchSource throws when not connected', async () => {
    const { switchSource } = await import('../src/adapters/mixer/roland.js');
    const handle = makeHandle({ connected: false });

    await assert.rejects(
      () => switchSource(handle, 1),
      /not connected/
    );
  });

  test('switchSource throws when socket is null', async () => {
    const { switchSource } = await import('../src/adapters/mixer/roland.js');
    const handle = makeHandle({ connected: true });
    handle._socket = null;

    await assert.rejects(
      () => switchSource(handle, 1),
      /not connected/
    );
  });
});

describe('Roland adapter — getActiveSource', () => {
  test('returns null when no source known', async () => {
    const { getActiveSource } = await import('../src/adapters/mixer/roland.js');
    const handle = makeHandle({ activeSource: null });
    assert.equal(getActiveSource(handle), null);
  });

  test('returns the stored active source', async () => {
    const { getActiveSource } = await import('../src/adapters/mixer/roland.js');
    const handle = makeHandle({ activeSource: 4 });
    assert.equal(getActiveSource(handle), 4);
  });
});

describe('Roland adapter — disconnect', () => {
  test('sets destroyed=true and connected=false', async () => {
    const { disconnect } = await import('../src/adapters/mixer/roland.js');
    const handle = makeHandle({ connected: true });

    await disconnect(handle);

    assert.equal(handle.destroyed, true);
    assert.equal(handle.connected, false);
    assert.equal(handle._socket, null);
  });
});

describe('Roland adapter — command format', () => {
  test('switchSource to input 1 generates valid JSON with number=1', async () => {
    const { switchSource } = await import('../src/adapters/mixer/roland.js');
    const handle = makeHandle({ connected: true });

    await switchSource(handle, 1);

    const msg = JSON.parse(handle.written[0].trimEnd());
    assert.equal(msg.params.inputBus.number, 1);
  });

  test('each switchSource call includes a message id', async () => {
    const { switchSource } = await import('../src/adapters/mixer/roland.js');
    const handle = makeHandle({ connected: true });

    await switchSource(handle, 1);

    const msg = JSON.parse(handle.written[0].trimEnd());
    assert.ok(typeof msg.id === 'number', 'message must have numeric id');
  });

  test('command is newline-terminated', async () => {
    const { switchSource } = await import('../src/adapters/mixer/roland.js');
    const handle = makeHandle({ connected: true });

    await switchSource(handle, 2);

    assert.ok(handle.written[0].endsWith('\r\n') || handle.written[0].endsWith('\n'),
      'command must end with newline');
  });
});

// ---------------------------------------------------------------------------
// Registry — getMixerAdapter resolution
// ---------------------------------------------------------------------------

describe('registry getMixerAdapter', () => {
  test('returns roland adapter for type roland', async () => {
    const { getMixerAdapter } = await import('../src/registry.js');
    const adapter = getMixerAdapter({ type: 'roland' });
    assert.ok(typeof adapter.switchSource === 'function');
    assert.ok(typeof adapter.getActiveSource === 'function');
    assert.ok(typeof adapter.connect === 'function');
    assert.ok(typeof adapter.disconnect === 'function');
  });

  test('throws for unknown mixer type', async () => {
    const { getMixerAdapter } = await import('../src/registry.js');
    assert.throws(
      () => getMixerAdapter({ type: 'unknown-mixer' }),
      /unknown mixer type/
    );
  });
});
