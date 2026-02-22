import * as session from '../session.js';
import { showToast } from './toast.js';

export function createStatusBar(container, { onSettingsOpen, onSyncTogglePanel } = {}) {
  container.innerHTML = `
    <span class="status-bar__brand">lcyt-web</span>
    <span class="status-bar__dot" id="sb-dot"></span>
    <span class="status-bar__label" id="sb-status">Disconnected</span>
    <span class="status-bar__label" style="margin-left:8px">Seq:</span>
    <span class="status-bar__value" id="sb-seq">—</span>
    <span class="status-bar__label" style="margin-left:8px">Offset:</span>
    <span class="status-bar__value" id="sb-offset">—</span>
    <span class="status-bar__error" id="sb-error" style="display:none"></span>
    <span class="status-bar__spacer"></span>
    <button class="status-bar__btn" id="sb-sync-btn" title="Clock sync">⟳ Sync</button>
    <button class="status-bar__btn status-bar__btn--icon" id="sb-panel-toggle" title="Toggle sent panel" style="display:none">▦</button>
    <button class="status-bar__btn status-bar__btn--icon" id="sb-settings-btn" title="Settings (Ctrl+,)">⚙</button>
  `;

  const dot = container.querySelector('#sb-dot');
  const statusEl = container.querySelector('#sb-status');
  const seqEl = container.querySelector('#sb-seq');
  const offsetEl = container.querySelector('#sb-offset');
  const errorEl = container.querySelector('#sb-error');
  const syncBtn = container.querySelector('#sb-sync-btn');
  const settingsBtn = container.querySelector('#sb-settings-btn');
  const panelToggle = container.querySelector('#sb-panel-toggle');

  let errorTimer = null;

  function setConnected(connected, detail = {}) {
    dot.className = 'status-bar__dot' + (connected ? ' status-bar__dot--connected' : '');
    statusEl.textContent = connected ? 'Connected' : 'Disconnected';
    if (detail.sequence !== undefined) {
      seqEl.textContent = detail.sequence;
    }
    if (!connected) {
      seqEl.textContent = '—';
      offsetEl.textContent = '—';
    }
  }

  function showError(msg, autoDismiss = true) {
    errorEl.textContent = msg;
    errorEl.style.display = '';
    if (errorTimer) clearTimeout(errorTimer);
    if (autoDismiss) {
      errorTimer = setTimeout(() => {
        errorEl.style.display = 'none';
        errorEl.textContent = '';
      }, 5000);
    }
  }

  function clearError() {
    if (errorTimer) clearTimeout(errorTimer);
    errorEl.style.display = 'none';
    errorEl.textContent = '';
  }

  // Event listeners
  window.addEventListener('lcyt:connected', (e) => {
    setConnected(true, e.detail);
    clearError();
  });

  window.addEventListener('lcyt:disconnected', () => {
    setConnected(false);
  });

  window.addEventListener('lcyt:sequence-updated', (e) => {
    seqEl.textContent = e.detail.sequence;
  });

  window.addEventListener('lcyt:sync-updated', (e) => {
    offsetEl.textContent = `${e.detail.syncOffset}ms`;
  });

  window.addEventListener('lcyt:error', (e) => {
    showError(e.detail.message);
  });

  // Sync button
  syncBtn.addEventListener('click', async () => {
    if (!session.state.connected) return;
    try {
      const data = await session.sync();
      offsetEl.textContent = `${data.syncOffset}ms`;
      showToast('Synced', 'success', 2000);
    } catch (err) {
      showError(err.message);
    }
  });

  // Settings button
  settingsBtn.addEventListener('click', () => {
    onSettingsOpen && onSettingsOpen();
  });

  // Panel toggle (mobile)
  panelToggle.addEventListener('click', () => {
    onSyncTogglePanel && onSyncTogglePanel();
  });

  // Show panel toggle button on small screens
  function checkWidth() {
    panelToggle.style.display = window.innerWidth <= 768 ? '' : 'none';
  }
  checkWidth();
  window.addEventListener('resize', checkWidth);

  return { showError, clearError };
}
