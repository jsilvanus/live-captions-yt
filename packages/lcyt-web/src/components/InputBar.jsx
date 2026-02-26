import { useState, useRef, forwardRef, useImperativeHandle } from 'react';
import { useSessionContext } from '../contexts/SessionContext';
import { useFileContext } from '../contexts/FileContext';
import { useSentLogContext } from '../contexts/SentLogContext';
import { useToastContext } from '../contexts/ToastContext';

export const InputBar = forwardRef(function InputBar(_props, ref) {
  const session = useSessionContext();
  const fileStore = useFileContext();
  const sentLog = useSentLogContext();
  const { showToast } = useToastContext();

  const [inputValue, setInputValue] = useState('');
  const [errorFlash, setErrorFlash] = useState(false);
  const [sendFlash, setSendFlash] = useState(false);
  const [batchCount, setBatchCount] = useState(0);

  const inputRef = useRef(null);
  const batchBufferRef = useRef([]);  // Array<{ text, requestId }>
  const batchTimerRef = useRef(null);

  useImperativeHandle(ref, () => ({
    focus: () => inputRef.current?.focus(),
    triggerSend: handleSend,
    // Called from CaptionView double-click (text is already known)
    sendText: async (text, fileId, lineIndex) => {
      if (!session.connected) { flashError(); return; }
      try {
        await doSend(text);
        fileStore.setLastSentLine({ fileId, lineIndex });
      } catch (err) {
        handleSendError(err);
      }
    },
  }));

  function getBatchIntervalMs() {
    try {
      const v = parseInt(localStorage.getItem('lcyt-batch-interval') || '0', 10);
      return Math.min(20, Math.max(0, v)) * 1000;
    } catch { return 0; }
  }

  function flashError() {
    setErrorFlash(true);
    setTimeout(() => setErrorFlash(false), 500);
  }

  function flashSuccess() {
    setSendFlash(true);
    setTimeout(() => setSendFlash(false), 300);
  }

  async function flushBatch() {
    const items = batchBufferRef.current.slice();
    batchBufferRef.current = [];
    batchTimerRef.current = null;
    setBatchCount(0);

    if (!items.length) return;

    try {
      const data = await session.sendBatch(items.map(i => i.text));
      items.forEach(item => sentLog.updateRequestId(item.requestId, data.requestId));
    } catch (err) {
      items.forEach(item => sentLog.markError(item.requestId));
      handleSendError(err);
    }
  }

  async function doSend(text) {
    if (!text?.trim()) return;

    const intervalMs = getBatchIntervalMs();
    if (intervalMs > 0) {
      const tempId = 'q-' + Math.random().toString(36).slice(2);
      sentLog.add({ requestId: tempId, text, pending: true });
      batchBufferRef.current.push({ text, requestId: tempId });
      setBatchCount(batchBufferRef.current.length);
      if (!batchTimerRef.current) {
        batchTimerRef.current = setTimeout(flushBatch, intervalMs);
      }
      flashSuccess();
      return;
    }

    const data = await session.send(text);
    sentLog.add({ requestId: data.requestId, text, pending: true });
    flashSuccess();
  }

  async function handleSend() {
    if (!session.connected) { flashError(); return; }

    const text = inputValue;

    if (text.trim() === '') {
      // Send-pointer mode: send the current line
      const file = fileStore.activeFile;
      if (!file || file.lines.length === 0) {
        flashError();
        showToast('No file loaded or file is empty', 'warning');
        return;
      }

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
        fileStore.setLastSentLine({ fileId: file.id, lineIndex: prevPointer });

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
      try {
        await doSend(text.trim());
        setInputValue('');
      } catch (err) {
        handleSendError(err);
      }
    }
  }

  function handleSendError(err) {
    const status = err.statusCode || err.status;
    if (status === 401) {
      session.disconnect();
      showToast('Session expired — please reconnect', 'error', 8000);
    } else {
      // Show in status bar via toast
      showToast(err.message || 'Send failed', 'error');
    }
    flashError();
  }

  function onKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSend();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const file = fileStore.activeFile;
      if (file) fileStore.setPointer(file.id, file.pointer - 1);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const file = fileStore.activeFile;
      if (file) fileStore.advancePointer(file.id);
    }
  }

  const inputCls = `input-bar__input${errorFlash ? ' input-bar__input--error' : ''}`;
  const sendCls = `input-bar__send${sendFlash ? ' input-bar__send--flash' : ''}`;

  return (
    <div className="input-bar">
      <input
        ref={inputRef}
        className={inputCls}
        type="text"
        placeholder="Enter: send current line | Type: send custom text"
        disabled={!session.connected}
        value={inputValue}
        onChange={e => setInputValue(e.target.value)}
        onKeyDown={onKeyDown}
      />
      {batchCount > 0 && (
        <span className="input-bar__batch-badge">{batchCount}</span>
      )}
      <button
        className={sendCls}
        disabled={!session.connected}
        onClick={handleSend}
      >▶</button>
    </div>
  );
});
