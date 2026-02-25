import * as session from '../session.js';
import * as fileStore from '../file-store.js';
import * as sentLog from '../sent-log.js';
import { showToast } from './toast.js';

export function createInputBar(container, { captionView } = {}) {
  const el = document.createElement('div');
  el.className = 'input-bar';
  el.innerHTML = `
    <input
      class="input-bar__input"
      type="text"
      id="caption-input"
      placeholder="Enter: send current line | Type: send custom text"
      disabled
    />
    <span class="input-bar__batch-badge" id="batch-badge" style="display:none">0</span>
    <button class="input-bar__send" id="send-btn" disabled>▶</button>
  `;

  const input = el.querySelector('#caption-input');
  const sendBtn = el.querySelector('#send-btn');
  const batchBadge = el.querySelector('#batch-badge');

  // ─── Batch buffer ───────────────────────────────────────

  let batchBuffer = [];   // Array<{ text, requestId }>
  let batchTimer = null;

  function getBatchIntervalMs() {
    try {
      const v = parseInt(localStorage.getItem('lcyt-batch-interval') || '0', 10);
      return Math.min(20, Math.max(0, v)) * 1000;
    } catch { return 0; }
  }

  function updateBatchBadge() {
    if (batchBuffer.length > 0) {
      batchBadge.textContent = batchBuffer.length;
      batchBadge.style.display = '';
    } else {
      batchBadge.style.display = 'none';
    }
  }

  async function flushBatch() {
    const items = batchBuffer.slice();
    batchBuffer = [];
    batchTimer = null;
    updateBatchBadge();

    if (!items.length) return;

    try {
      const data = await session.sendBatch(items.map(i => i.text));
      // Remap each temp requestId to the real server requestId so SSE can confirm them
      items.forEach(item => sentLog.updateRequestId(item.requestId, data.requestId));
    } catch (err) {
      // Mark all buffered items as failed
      items.forEach(item => sentLog.markError(item.requestId));
      handleSendError(err);
    }
  }

  // ─── UI helpers ─────────────────────────────────────────

  function setEnabled(enabled) {
    input.disabled = !enabled;
    sendBtn.disabled = !enabled;
  }

  function flashError() {
    input.classList.add('input-bar__input--error');
    setTimeout(() => input.classList.remove('input-bar__input--error'), 500);
  }

  function flashSuccess() {
    sendBtn.classList.add('input-bar__send--flash');
    setTimeout(() => sendBtn.classList.remove('input-bar__send--flash'), 300);
  }

  // ─── Send logic ─────────────────────────────────────────

  async function doSend(text) {
    if (!text?.trim()) return;
    if (getBatchIntervalMs() > 0) {
      // Add to sentLog immediately with a temp ID — will be remapped on flush
      const tempId = 'q-' + Math.random().toString(36).slice(2);
      sentLog.add({ requestId: tempId, text, pending: true });
      batchBuffer.push({ text, requestId: tempId });
      updateBatchBadge();
      if (!batchTimer) {
        batchTimer = setTimeout(flushBatch, getBatchIntervalMs());
      }
      flashSuccess();
      return;
    }
    const data = await session.send(text);
    sentLog.add({ requestId: data.requestId, text, pending: true });
    flashSuccess();
  }

  async function handleSend() {
    if (!session.state.connected) {
      flashError();
      return;
    }

    const text = input.value;

    if (text.trim() === '') {
      // Send-pointer mode
      const file = fileStore.getActive();
      if (!file || file.lines.length === 0) {
        flashError();
        showToast('No file loaded or file is empty', 'warning');
        return;
      }

      // If on a heading or blank line, advance past it and don't send
      // (getActive() returns a shallow copy, so compute target index locally)
      const isSkippable = line => !line?.trim() || line.startsWith('#');
      if (isSkippable(file.lines[file.pointer])) {
        let targetPointer = file.pointer + 1;
        while (targetPointer < file.lines.length && isSkippable(file.lines[targetPointer])) {
          targetPointer++;
        }
        fileStore.setPointer(file.id, Math.min(targetPointer, file.lines.length - 1));
        return;
      }

      const lineText = file.lines[file.pointer];
      const prevPointer = file.pointer;

      try {
        await doSend(lineText);

        captionView && captionView.flashSent(file.id, prevPointer);

        if (file.pointer < file.lines.length - 1) {
          fileStore.advancePointer(file.id);
        } else {
          showToast('End of file reached', 'info', 2500);
        }
      } catch (err) {
        handleSendError(err);
      }
    } else {
      // Send-custom mode
      const customText = text.trim();
      try {
        await doSend(customText);
        input.value = '';
      } catch (err) {
        handleSendError(err);
      }
    }
  }

  function handleSendError(err) {
    const msg = err.message || 'Send failed';
    const status = err.statusCode || err.status;

    if (status === 401) {
      session.disconnect();
      showToast('Session expired — please reconnect', 'error', 8000);
    } else {
      window.dispatchEvent(new CustomEvent('lcyt:error', { detail: { message: msg } }));
    }
    flashError();
  }

  // ─── Events ─────────────────────────────────────────────

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSend();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const file = fileStore.getActive();
      if (file) fileStore.setPointer(file.id, file.pointer - 1);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const file = fileStore.getActive();
      if (file) fileStore.advancePointer(file.id);
    }
  });

  sendBtn.addEventListener('click', handleSend);

  // Double-click send from caption-view
  window.addEventListener('lcyt:line-send', async (e) => {
    if (!session.state.connected) { flashError(); return; }
    try {
      await doSend(e.detail.text);
    } catch (err) {
      handleSendError(err);
    }
  });

  // Enable/disable based on connection
  window.addEventListener('lcyt:connected', () => setEnabled(true));
  window.addEventListener('lcyt:disconnected', () => setEnabled(false));

  container.appendChild(el);

  return { element: el, focus: () => input.focus() };
}
