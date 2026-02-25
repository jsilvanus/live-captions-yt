import * as session from '../session.js';
import { showToast } from './toast.js';

export function createSettingsModal() {
  const overlay = document.createElement('div');
  overlay.className = 'settings-modal';
  overlay.style.display = 'none';
  overlay.innerHTML = `
    <div class="settings-modal__backdrop" id="sm-backdrop"></div>
    <div class="settings-modal__box">
      <div class="settings-modal__header">
        <span class="settings-modal__title">Settings</span>
        <button class="settings-modal__close" id="sm-close" title="Close (Esc)">✕</button>
      </div>

      <div class="settings-modal__tabs">
        <button class="settings-tab settings-tab--active" data-tab="connection">Connection</button>
        <button class="settings-tab" data-tab="captions">Captions</button>
        <button class="settings-tab" data-tab="status">Status</button>
        <button class="settings-tab" data-tab="actions">Actions</button>
      </div>

      <div class="settings-modal__body">
        <!-- Connection tab -->
        <div class="settings-panel settings-panel--active" data-panel="connection">
          <div class="settings-field">
            <label class="settings-field__label" for="sm-backend-url">Backend URL</label>
            <input id="sm-backend-url" class="settings-field__input" type="url"
              placeholder="http://localhost:3000" autocomplete="off" />
          </div>

          <div class="settings-field">
            <label class="settings-field__label" for="sm-api-key">API Key</label>
            <div class="settings-field__input-wrap">
              <input id="sm-api-key" class="settings-field__input settings-field__input--has-eye"
                type="password" placeholder="••••••••" autocomplete="off" />
              <button class="settings-field__eye" id="sm-eye-api" title="Toggle visibility">👁</button>
            </div>
          </div>

          <div class="settings-field">
            <label class="settings-field__label" for="sm-stream-key">Stream Key</label>
            <div class="settings-field__input-wrap">
              <input id="sm-stream-key" class="settings-field__input settings-field__input--has-eye"
                type="password" placeholder="••••••••" autocomplete="off" />
              <button class="settings-field__eye" id="sm-eye-stream" title="Toggle visibility">👁</button>
            </div>
          </div>

          <label class="settings-checkbox">
            <input type="checkbox" id="sm-auto-connect" />
            Auto-connect on startup
          </label>

          <div class="settings-field">
            <label class="settings-field__label">Theme</label>
            <select id="sm-theme" class="settings-field__input" style="appearance:auto">
              <option value="auto">Auto (system)</option>
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </select>
          </div>

          <div id="sm-error" class="settings-error" style="display:none"></div>
        </div>

        <!-- Captions tab -->
        <div class="settings-panel" data-panel="captions">
          <div class="settings-field">
            <label class="settings-field__label" for="sm-batch-interval">
              Batch window: <span id="sm-batch-display">Off</span>
            </label>
            <input id="sm-batch-interval" class="settings-field__input" type="range"
              min="0" max="20" step="1" value="0" style="padding:0; cursor:pointer" />
          </div>
          <p style="font-size:12px; color:var(--color-text-dim); margin:0; line-height:1.5">
            0 = send each caption immediately.<br>
            1–20 s = collect captions over the window, then send as a single batch (one HTTP request).
          </p>
        </div>

        <!-- Status tab -->
        <div class="settings-panel" data-panel="status">
          <div class="settings-status-row">
            <span class="settings-status-row__label">Connection</span>
            <span class="settings-status-row__value" id="sm-s-connected">—</span>
          </div>
          <div class="settings-status-row">
            <span class="settings-status-row__label">Backend URL</span>
            <span class="settings-status-row__value" id="sm-s-url">—</span>
          </div>
          <div class="settings-status-row">
            <span class="settings-status-row__label">Sequence</span>
            <span class="settings-status-row__value" id="sm-s-seq">—</span>
          </div>
          <div class="settings-status-row">
            <span class="settings-status-row__label">Sync Offset</span>
            <span class="settings-status-row__value" id="sm-s-offset">—</span>
          </div>
          <div class="settings-status-row">
            <span class="settings-status-row__label">Last connected</span>
            <span class="settings-status-row__value" id="sm-s-time">—</span>
          </div>
        </div>

        <!-- Actions tab -->
        <div class="settings-panel" data-panel="actions">
          <div class="settings-modal__actions">
            <button class="btn btn--secondary btn--sm" id="sm-sync-btn">⟳ Sync Now</button>
            <button class="btn btn--secondary btn--sm" id="sm-heartbeat-btn">♥ Heartbeat</button>
          </div>
          <div class="settings-status-row" id="sm-hb-row" style="display:none">
            <span class="settings-status-row__label">Round-trip</span>
            <span class="settings-status-row__value" id="sm-hb-rtt">—</span>
          </div>
          <div class="settings-status-row" id="sm-sync-row" style="display:none">
            <span class="settings-status-row__label">Sync offset</span>
            <span class="settings-status-row__value" id="sm-sync-result">—</span>
          </div>
          <hr style="border-color:var(--color-border);margin:8px 0" />
          <button class="btn btn--danger btn--sm" id="sm-clear-btn">🗑 Clear saved config</button>
        </div>
      </div>

      <div class="settings-modal__footer">
        <div class="settings-modal__actions">
          <button class="btn btn--primary" id="sm-connect-btn">Connect</button>
          <button class="btn btn--secondary" id="sm-disconnect-btn">Disconnect</button>
          <button class="btn btn--secondary" id="sm-cancel-btn">Close</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  // ─── Elements ──────────────────────────────────────────

  const backendUrlInput = overlay.querySelector('#sm-backend-url');
  const apiKeyInput = overlay.querySelector('#sm-api-key');
  const streamKeyInput = overlay.querySelector('#sm-stream-key');
  const autoConnectCheck = overlay.querySelector('#sm-auto-connect');
  const themeSelect = overlay.querySelector('#sm-theme');
  const errorEl = overlay.querySelector('#sm-error');
  const connectBtn = overlay.querySelector('#sm-connect-btn');
  const disconnectBtn = overlay.querySelector('#sm-disconnect-btn');

  // Status tab
  const sConnected = overlay.querySelector('#sm-s-connected');
  const sUrl = overlay.querySelector('#sm-s-url');
  const sSeq = overlay.querySelector('#sm-s-seq');
  const sOffset = overlay.querySelector('#sm-s-offset');
  const sTime = overlay.querySelector('#sm-s-time');

  let lastConnectedTime = null;

  // ─── Tabs ──────────────────────────────────────────────

  const tabs = overlay.querySelectorAll('.settings-tab');
  const panels = overlay.querySelectorAll('.settings-panel');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('settings-tab--active'));
      panels.forEach(p => p.classList.remove('settings-panel--active'));
      tab.classList.add('settings-tab--active');
      overlay.querySelector(`[data-panel="${tab.dataset.tab}"]`)
        .classList.add('settings-panel--active');
      updateStatus();
    });
  });

  // ─── Eye toggles ───────────────────────────────────────

  overlay.querySelector('#sm-eye-api').addEventListener('click', () => {
    apiKeyInput.type = apiKeyInput.type === 'password' ? 'text' : 'password';
  });

  overlay.querySelector('#sm-eye-stream').addEventListener('click', () => {
    streamKeyInput.type = streamKeyInput.type === 'password' ? 'text' : 'password';
  });

  // ─── Batch interval ────────────────────────────────────

  const batchSlider = overlay.querySelector('#sm-batch-interval');
  const batchDisplay = overlay.querySelector('#sm-batch-display');

  function updateBatchDisplay(value) {
    batchDisplay.textContent = value === 0 ? 'Off' : `${value}s`;
  }

  batchSlider.addEventListener('input', () => {
    const v = parseInt(batchSlider.value, 10);
    updateBatchDisplay(v);
    try { localStorage.setItem('lcyt-batch-interval', String(v)); } catch {}
  });

  // ─── Theme selector ────────────────────────────────────

  function applyTheme(value) {
    const html = document.documentElement;
    if (value === 'dark') {
      html.setAttribute('data-theme', 'dark');
    } else if (value === 'light') {
      html.setAttribute('data-theme', 'light');
    } else {
      html.removeAttribute('data-theme');
    }
    try { localStorage.setItem('lcyt-theme', value); } catch {}
  }

  themeSelect.addEventListener('change', () => applyTheme(themeSelect.value));

  // Restore theme on load
  const savedTheme = localStorage.getItem('lcyt-theme') || 'auto';
  themeSelect.value = savedTheme;
  applyTheme(savedTheme);

  // ─── Error display ─────────────────────────────────────

  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.style.display = '';
  }

  function clearError() {
    errorEl.style.display = 'none';
    errorEl.textContent = '';
  }

  // ─── Status tab update ─────────────────────────────────

  function updateStatus() {
    const s = session.state;
    sConnected.textContent = s.connected ? '● Connected' : '○ Disconnected';
    sConnected.style.color = s.connected ? 'var(--color-success)' : 'var(--color-text-dim)';
    sUrl.textContent = s.backendUrl || '—';
    sSeq.textContent = s.connected ? s.sequence : '—';
    sOffset.textContent = s.connected ? `${s.syncOffset}ms` : '—';
    sTime.textContent = lastConnectedTime
      ? new Date(lastConnectedTime).toLocaleTimeString()
      : '—';
  }

  window.addEventListener('lcyt:connected', () => {
    lastConnectedTime = Date.now();
    updateStatus();
  });
  window.addEventListener('lcyt:disconnected', () => updateStatus());
  window.addEventListener('lcyt:sequence-updated', () => updateStatus());

  // ─── Connect / disconnect ──────────────────────────────

  connectBtn.addEventListener('click', async () => {
    clearError();
    const backendUrl = backendUrlInput.value.trim();
    const apiKey = apiKeyInput.value.trim();
    const streamKey = streamKeyInput.value.trim();

    if (!backendUrl) { showError('Backend URL is required'); return; }
    if (!apiKey)     { showError('API Key is required'); return; }
    if (!streamKey)  { showError('Stream Key is required'); return; }

    connectBtn.disabled = true;
    connectBtn.textContent = 'Connecting…';

    try {
      await session.connect({ backendUrl, apiKey, streamKey });
      session.setAutoConnect(autoConnectCheck.checked);
      showToast('Connected', 'success');
      close();
    } catch (err) {
      showError(err.message || 'Connection failed');
    } finally {
      connectBtn.disabled = false;
      connectBtn.textContent = 'Connect';
    }
  });

  disconnectBtn.addEventListener('click', async () => {
    await session.disconnect();
    showToast('Disconnected', 'info');
    close();
  });

  // ─── Sync / Heartbeat ──────────────────────────────────

  overlay.querySelector('#sm-sync-btn').addEventListener('click', async () => {
    if (!session.state.connected) { showToast('Not connected', 'warning'); return; }
    try {
      const data = await session.sync();
      const row = overlay.querySelector('#sm-sync-row');
      overlay.querySelector('#sm-sync-result').textContent = `${data.syncOffset}ms`;
      row.style.display = '';
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  overlay.querySelector('#sm-heartbeat-btn').addEventListener('click', async () => {
    if (!session.state.connected) { showToast('Not connected', 'warning'); return; }
    try {
      const data = await session.heartbeat();
      const row = overlay.querySelector('#sm-hb-row');
      overlay.querySelector('#sm-hb-rtt').textContent = `${data.roundTripTime}ms`;
      row.style.display = '';
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // ─── Clear config ──────────────────────────────────────

  overlay.querySelector('#sm-clear-btn').addEventListener('click', () => {
    session.clearPersistedConfig();
    backendUrlInput.value = '';
    apiKeyInput.value = '';
    streamKeyInput.value = '';
    autoConnectCheck.checked = false;
    showToast('Config cleared', 'info');
  });

  // ─── Close ─────────────────────────────────────────────

  function close() {
    overlay.style.display = 'none';
  }

  overlay.querySelector('#sm-close').addEventListener('click', close);
  overlay.querySelector('#sm-cancel-btn').addEventListener('click', close);
  overlay.querySelector('#sm-backdrop').addEventListener('click', close);

  // Escape key
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlay.style.display !== 'none') close();
  });

  // ─── Open ──────────────────────────────────────────────

  function open() {
    // Load persisted values
    const cfg = session.getPersistedConfig();
    if (cfg.backendUrl) backendUrlInput.value = cfg.backendUrl;
    if (cfg.apiKey) apiKeyInput.value = cfg.apiKey;
    if (cfg.streamKey) streamKeyInput.value = cfg.streamKey;
    autoConnectCheck.checked = session.getAutoConnect();

    const savedBatch = parseInt(localStorage.getItem('lcyt-batch-interval') || '0', 10);
    batchSlider.value = String(savedBatch);
    updateBatchDisplay(savedBatch);

    clearError();
    updateStatus();
    overlay.style.display = '';
  }

  // Ctrl+, / Cmd+, keyboard shortcut
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === ',') {
      e.preventDefault();
      if (overlay.style.display === 'none') {
        open();
      } else {
        close();
      }
    }
  });

  return { open, close };
}
