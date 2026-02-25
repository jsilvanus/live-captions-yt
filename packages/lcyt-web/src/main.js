import './styles/reset.css';
import './styles/layout.css';
import './styles/components.css';

import * as session from './session.js';
import * as fileStore from './file-store.js';
import { createStatusBar } from './ui/status-bar.js';
import { createSettingsModal } from './ui/settings-modal.js';
import { createDropZone } from './ui/drop-zone.js';
import { createFileTabs } from './ui/file-tabs.js';
import { createCaptionView } from './ui/caption-view.js';
import { createSentPanel } from './ui/sent-panel.js';
import { createInputBar } from './ui/input-bar.js';
import { createAudioPanel } from './ui/audio-panel.js';

// ─── Settings modal ─────────────────────────────────────

const settingsModal = createSettingsModal();

// ─── Status bar ──────────────────────────────────────────

const header = document.getElementById('header');
const rightPanel = document.getElementById('right-panel');

createStatusBar(header, {
  onSettingsOpen: () => settingsModal.open(),
  onSyncTogglePanel: () => {
    rightPanel.classList.toggle('panel--right-visible');
  },
});

// ─── Left panel layout ───────────────────────────────────

const leftPanel = document.getElementById('left-panel');

// Drop zone — hidden when files are loaded, also suppressed when audio view is active
const dropZone = createDropZone(leftPanel);
const { triggerFilePicker } = dropZone;

// Tab bar — always visible (contains file tabs + Audio tab)
createFileTabs(leftPanel, { triggerFilePicker });

// Caption view — shown when captions view is active
const captionView = createCaptionView(leftPanel);

// Audio panel — shown when Audio tab is active
const audioPanel = createAudioPanel(leftPanel);

// Toggle between caption-view and audio-panel based on current view.
// Also suppress the drop-zone when audio view is active.
window.addEventListener('lcyt:view-changed', (e) => {
  const { view } = e.detail;
  if (view === 'audio') {
    dropZone.element.style.display = 'none';
    captionView.element.style.display = 'none';
    audioPanel.show();
  } else {
    // Restore normal file view; drop-zone visibility is driven by file count
    const hasFiles = fileStore.getAll().length > 0;
    dropZone.element.style.display = hasFiles ? 'none' : '';
    captionView.element.style.display = '';
    audioPanel.hide();
  }
});

// ─── Right panel ─────────────────────────────────────────

createSentPanel(rightPanel);

// ─── Footer / input bar ───────────────────────────────────

const footer = document.getElementById('footer');
const inputBar = createInputBar(footer, { captionView });

// ─── Keyboard navigation (global) ────────────────────────

document.addEventListener('keydown', (e) => {
  // Don't intercept when a text input or dialog is focused
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  const inDialog = document.activeElement?.closest('dialog, .settings-modal');
  if (inDialog) return;

  const file = fileStore.getActive();
  if (!file) return;

  switch (e.key) {
    case 'Enter':
      e.preventDefault();
      inputBar.focus();
      return;
    case 'ArrowUp':
      e.preventDefault();
      fileStore.setPointer(file.id, file.pointer - 1);
      break;
    case 'ArrowDown':
      e.preventDefault();
      fileStore.advancePointer(file.id);
      break;
    case 'PageUp':
      e.preventDefault();
      fileStore.setPointer(file.id, file.pointer - 10);
      break;
    case 'PageDown':
      e.preventDefault();
      fileStore.setPointer(file.id, file.pointer + 10);
      break;
    case 'Home':
      e.preventDefault();
      fileStore.setPointer(file.id, 0);
      break;
    case 'End':
      e.preventDefault();
      fileStore.setPointer(file.id, file.lines.length - 1);
      break;
    case 'Tab':
      e.preventDefault();
      fileStore.cycleActive();
      break;
  }
});

// ─── Auto-connect on startup ──────────────────────────────

(async () => {
  if (session.getAutoConnect()) {
    const cfg = session.getPersistedConfig();
    if (cfg.backendUrl && cfg.apiKey && cfg.streamKey) {
      // Show connecting status via a quick event
      window.dispatchEvent(new CustomEvent('lcyt:error', {
        detail: { message: 'Connecting…' }
      }));
      try {
        await session.connect(cfg);
      } catch (err) {
        window.dispatchEvent(new CustomEvent('lcyt:error', {
          detail: { message: `Auto-connect failed: ${err.message}` }
        }));
      }
    }
  }
})();
