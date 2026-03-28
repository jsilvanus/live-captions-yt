// Runtime helpers for InputBar metacode actions (goto resolution, timer, file switches, action draining)

export function findLineIndexForRaw(lineNumbers, targetRaw) {
  if (!lineNumbers || lineNumbers.length === 0) return 0;
  for (let i = 0; i < lineNumbers.length; i++) {
    if (lineNumbers[i] >= targetRaw) return i;
  }
  return lineNumbers.length - 1;
}

export async function performFileSwitchAction(fileStore, session, switchName, switchServerPath, showToast) {
  if (switchServerPath) {
    try {
      const isAbsoluteUrl = switchServerPath.startsWith('http://') || switchServerPath.startsWith('https://');
      const url = isAbsoluteUrl ? switchServerPath : `${session.backendUrl}${switchServerPath}`;
      const token = session.getSessionToken?.();
      const fetchHeaders = token ? { Authorization: `Bearer ${token}` } : {};
      const res = await fetch(url, { headers: fetchHeaders });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const rawText = await res.text();
      let fileName = 'server-file.txt';
      try {
        fileName = decodeURIComponent(
          switchServerPath.replace(/[?#].*$/, '').split('/').pop() || 'server-file.txt'
        );
      } catch {}
      const existing = fileStore.files.find(f => f.name === fileName);
      if (existing) {
        fileStore.setActive(existing.id);
      } else {
        const entry = fileStore.loadFileFromText(fileName, rawText);
        fileStore.setActive(entry.id);
      }
    } catch (err) {
      showToast?.(`file[server] error: ${err.message}`, 'warning');
    }
  } else if (switchName) {
    const target = fileStore.files.find(f => f.name === switchName);
    if (target) {
      fileStore.setActive(target.id);
    } else {
      showToast?.(`file: "${switchName}" is not open`, 'info', 3000);
    }
  }
}

export async function drainActions({ file, startPtr = 0, fileStore, timerRef, handleSendRef, showToast, session }) {
  let ptr = startPtr;
  while (ptr < (file.lines.length)) {
    const lc = file.lineCodes?.[ptr] || {};
    const lineText = file.lines[ptr];

    if (lc.audioCapture) {
      // Dispatch audio-capture event; consumer may listen
      if (typeof window !== 'undefined' && window?.dispatchEvent) {
        try { window.dispatchEvent(new CustomEvent('lcyt:audio-capture', { detail: { action: lc.audioCapture } })); } catch {}
      }
      ptr++;
    } else if (lc.timer != null) {
      ptr++;
      const target = ptr < file.lines.length ? ptr : file.lines.length - 1;
      fileStore.setPointer(file.id, target);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => handleSendRef.current?.(), lc.timer * 1000);
      return { status: 'stop', pointer: target };
    } else if (lc.goto != null) {
      const maxRaw = file.lineNumbers?.at(-1) ?? 0;
      const targetIdx = findLineIndexForRaw(file.lineNumbers, lc.goto);
      if (file.lineNumbers && lc.goto > maxRaw) {
        showToast?.(`goto: line ${lc.goto} is past end of file`, 'info', 2500);
      }
      fileStore.setPointer(file.id, targetIdx);
      return { status: 'stop', pointer: targetIdx };
    } else if (lc.fileSwitch != null || lc.fileSwitchServer != null) {
      await performFileSwitchAction(fileStore, session, lc.fileSwitch, lc.fileSwitchServer, showToast);
      return { status: 'stop', pointer: fileStore.activeFile?.pointer ?? 0 };
    } else if (!lineText?.trim() || lineText?.startsWith('#')) {
      ptr++;
    } else {
      break;
    }
  }
  return ptr >= file.lines.length ? { status: 'done', pointer: file.lines.length - 1 } : { status: 'continue', pointer: ptr };
}
