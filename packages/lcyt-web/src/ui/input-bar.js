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
    <button class="input-bar__send" id="send-btn" disabled>▶</button>
  `;

  const input = el.querySelector('#caption-input');
  const sendBtn = el.querySelector('#send-btn');

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

      const lineText = file.lines[file.pointer];
      const prevPointer = file.pointer;

      try {
        const data = await session.send(lineText);
        sentLog.add({ sequence: data.sequence, text: lineText });

        // Flash sent animation on the previous active line
        captionView && captionView.flashSent(file.id, prevPointer);

        // Advance pointer (unless at end)
        if (file.pointer < file.lines.length - 1) {
          fileStore.advancePointer(file.id);
        } else {
          showToast('End of file reached', 'info', 2500);
        }

        flashSuccess();
      } catch (err) {
        handleSendError(err);
      }
    } else {
      // Send-custom mode
      const customText = text.trim();
      try {
        const data = await session.send(customText);
        sentLog.add({ sequence: data.sequence, text: customText });
        input.value = '';
        flashSuccess();
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
  }

  // Enter key or button click
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

  // Enable/disable based on connection
  window.addEventListener('lcyt:connected', () => setEnabled(true));
  window.addEventListener('lcyt:disconnected', () => setEnabled(false));

  container.appendChild(el);

  return { element: el, focus: () => input.focus() };
}
