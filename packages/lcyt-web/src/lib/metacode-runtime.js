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
      // If the line has content text, stop here so it gets sent
      if (lineText?.trim()) break;
      ptr++;
    } else if (lc.timer != null) {
      // Timer fires the CURRENT line after the delay.
      // Set pointer here and schedule auto-send after timer seconds.
      fileStore.setPointer(file.id, ptr);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => handleSendRef.current?.(), lc.timer * 1000);
      return { status: 'stop', pointer: ptr };
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

// ---------------------------------------------------------------------------
// Cue map helpers — used by InputBar to detect cue phrase matches in captions
// ---------------------------------------------------------------------------

/**
 * Build a Map of lowercase cue phrase → line index from a parsed file.
 * Each `<!-- cue:phrase -->` entry creates one mapping.
 *
 * @param {{ lineCodes: object[] }} file
 * @returns {Map<string, number>}
 */
export function buildCueMap(file) {
  const map = new Map();
  if (!file?.lineCodes) return map;
  for (let i = 0; i < file.lineCodes.length; i++) {
    const lc = file.lineCodes[i];
    if (lc.cue) {
      map.set(lc.cue.toLowerCase(), i);
    }
  }
  return map;
}

/**
 * Check if caption text matches any registered cue phrase.
 * Returns the first match (phrase + target line index) or null.
 *
 * Supports glob-style wildcards: `*` in a cue phrase matches any characters.
 * E.g. `Let us *` matches "Let us pray", "Let us go", etc.
 * Without `*`, the phrase is matched as a substring (case-insensitive).
 *
 * @param {Map<string, number>} cueMap — from buildCueMap()
 * @param {string} text — caption text to test
 * @returns {{ phrase: string, index: number } | null}
 */
export function checkCueMatch(cueMap, text) {
  if (!text || !cueMap || cueMap.size === 0) return null;
  const lower = text.toLowerCase();
  for (const [phrase, index] of cueMap) {
    if (phrase.includes('*')) {
      // Glob pattern: escape regex chars, convert * to .*
      const escaped = phrase.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
      try {
        if (new RegExp(escaped).test(lower)) return { phrase, index };
      } catch { /* invalid pattern — skip */ }
    } else {
      if (lower.includes(phrase)) return { phrase, index };
    }
  }
  return null;
}
