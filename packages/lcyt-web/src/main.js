import './styles/reset.css';
import './styles/layout.css';
import './styles/components.css';

import * as session from './session.js';
import { createStatusBar } from './ui/status-bar.js';
import { createSettingsModal } from './ui/settings-modal.js';
import { createDropZone } from './ui/drop-zone.js';
import { createFileTabs } from './ui/file-tabs.js';
import { createCaptionView } from './ui/caption-view.js';
import { createSentPanel } from './ui/sent-panel.js';
import { createInputBar } from './ui/input-bar.js';

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

// File tabs (hidden until files loaded)
const { triggerFilePicker } = createDropZone(leftPanel);
const fileTabs = createFileTabs(leftPanel, { triggerFilePicker });

// Caption view
const captionView = createCaptionView(leftPanel);

// ─── Right panel ─────────────────────────────────────────

createSentPanel(rightPanel);

// ─── Footer / input bar ───────────────────────────────────

const footer = document.getElementById('footer');
createInputBar(footer, { captionView });

// ─── Keyboard navigation (global) ────────────────────────

import * as fileStore from './file-store.js';

document.addEventListener('keydown', (e) => {
  // Don't intercept when a text input or dialog is focused
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  const inDialog = document.activeElement?.closest('dialog, .settings-modal');
  if (inDialog) return;

  const file = fileStore.getActive();
  if (!file) return;

  switch (e.key) {
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
