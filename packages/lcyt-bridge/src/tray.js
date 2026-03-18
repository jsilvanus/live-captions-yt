/**
 * System tray integration for lcyt-bridge (Windows / macOS).
 * Uses node-systray. If it fails to load (e.g. headless Linux CI),
 * the bridge runs in console-only mode without crashing.
 *
 * Menu layout:
 *   Backend: Connected / Disconnected
 *   TCP: <n> connection(s)
 *   ─────────────────────
 *   Reconnect All
 *   ─────────────────────
 *   Quit
 */

const ICON_CONNECTED    = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='; // 1×1 green placeholder
const ICON_DISCONNECTED = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwADhQGAWjR9awAAAABJRU5ErkJggg=='; // 1×1 grey placeholder

const IDX_STATUS_SSE = 0;
const IDX_STATUS_TCP = 1;
const IDX_RECONNECT  = 3;
const IDX_QUIT       = 5;

export async function createTray({ bridge, onQuit }) {
  let SysTray;
  try {
    const mod = await import('node-systray');
    SysTray = mod.default ?? mod.SysTray;
  } catch {
    // node-systray not available (headless, pkg issue, etc.) — skip tray
  }

  if (!SysTray) {
    console.info('[lcyt-bridge] System tray not available — running in console mode.');
    // Still wire up status logging
    _wireConsoleLog(bridge);
    return { update: () => {} };
  }

  const tray = new SysTray({
    menu: {
      icon:    ICON_DISCONNECTED,
      title:   '',
      tooltip: 'lcyt-bridge',
      items: [
        { title: 'Backend: Connecting…', tooltip: '', checked: false, enabled: false },
        { title: 'TCP: 0 connections',   tooltip: '', checked: false, enabled: false },
        SysTray.separator,
        { title: 'Reconnect All', tooltip: 'Reconnect SSE and all TCP connections', checked: false, enabled: true },
        SysTray.separator,
        { title: 'Quit',          tooltip: '', checked: false, enabled: true },
      ],
    },
    debug: false,
    copyDir: false,
  });

  tray.onClick((action) => {
    if (action.seq_id === IDX_RECONNECT) bridge.reconnectAll();
    if (action.seq_id === IDX_QUIT)      onQuit();
  });

  function update(sseConnected, tcpStatus) {
    const tcpCount     = tcpStatus.length;
    const tcpConnected = tcpStatus.filter(t => t.connected).length;
    const healthy      = sseConnected && tcpConnected === tcpCount;

    tray.sendAction({
      type: 'update-item',
      item: { title: `Backend: ${sseConnected ? '✓ Connected' : '✗ Disconnected'}`, seq_id: IDX_STATUS_SSE },
    });
    tray.sendAction({
      type: 'update-item',
      item: { title: `TCP: ${tcpConnected}/${tcpCount} connected`, seq_id: IDX_STATUS_TCP },
    });
    tray.sendAction({
      type: 'update-menu',
      menu: { icon: healthy ? ICON_CONNECTED : ICON_DISCONNECTED },
    });
  }

  _wireBridgeEvents(bridge, update);
  return { update };
}

function _wireBridgeEvents(bridge, update) {
  let sseConnected = false;

  bridge.on('connected',    ()      => { sseConnected = true;  update(sseConnected, bridge.status().tcp); });
  bridge.on('disconnected', ()      => { sseConnected = false; update(sseConnected, bridge.status().tcp); });
  bridge.on('tcp:connected',    () => update(sseConnected, bridge.status().tcp));
  bridge.on('tcp:disconnected', () => update(sseConnected, bridge.status().tcp));
}

function _wireConsoleLog(bridge) {
  bridge.on('connecting',    (url)      => console.info(`[bridge] Connecting to ${url}`));
  bridge.on('connected',     ()         => console.info('[bridge] SSE connected'));
  bridge.on('disconnected',  ()         => console.warn('[bridge] SSE disconnected'));
  bridge.on('reconnecting',  (ms)       => console.info(`[bridge] Reconnecting in ${ms}ms`));
  bridge.on('tcp:connected', (key)      => console.info(`[bridge] TCP connected: ${key}`));
  bridge.on('tcp:disconnected', (key)   => console.warn(`[bridge] TCP disconnected: ${key}`));
  bridge.on('tcp:error',     (key, err) => console.error(`[bridge] TCP error ${key}: ${err.message}`));
  bridge.on('command:ok',    ({ host, port }) => console.info(`[bridge] Command OK → ${host}:${port}`));
  bridge.on('command:error', ({ host, port, error }) => console.error(`[bridge] Command FAIL → ${host}:${port}: ${error}`));
  bridge.on('error',         (err)      => console.error(`[bridge] Error: ${err.message}`));
}
