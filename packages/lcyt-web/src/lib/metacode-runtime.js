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
      // Timer fires the CURRENT line after the delay, then advances to the next line.
      fileStore.setPointer(file.id, ptr);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        handleSendRef.current?.();
        // After firing, advance pointer to next line
        const nextPtr = ptr + 1;
        if (nextPtr < file.lines.length) {
          fileStore.setPointer(file.id, nextPtr);
        }
      }, lc.timer * 1000);
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
// Jaro-Winkler string similarity (pure JS, no deps)
// Exported for frontend fuzzy cue matching.
// ---------------------------------------------------------------------------

function jaroSimilarity(s1, s2) {
  if (s1 === s2) return 1.0;
  if (!s1.length || !s2.length) return 0.0;
  const matchWindow = Math.max(0, Math.floor(Math.max(s1.length, s2.length) / 2) - 1);
  const s1Matches = new Array(s1.length).fill(false);
  const s2Matches = new Array(s2.length).fill(false);
  let matches = 0, transpositions = 0;
  for (let i = 0; i < s1.length; i++) {
    const start = Math.max(0, i - matchWindow);
    const end = Math.min(i + matchWindow + 1, s2.length);
    for (let j = start; j < end; j++) {
      if (s2Matches[j] || s1[i] !== s2[j]) continue;
      s1Matches[i] = true; s2Matches[j] = true; matches++; break;
    }
  }
  if (matches === 0) return 0.0;
  let k = 0;
  for (let i = 0; i < s1.length; i++) {
    if (!s1Matches[i]) continue;
    while (!s2Matches[k]) k++;
    if (s1[i] !== s2[k]) transpositions++;
    k++;
  }
  return (matches / s1.length + matches / s2.length + (matches - transpositions / 2) / matches) / 3;
}

export function jaroWinkler(s1, s2) {
  const jaro = jaroSimilarity(s1, s2);
  let prefix = 0;
  for (let i = 0; i < Math.min(s1.length, s2.length, 4); i++) {
    if (s1[i] === s2[i]) prefix++; else break;
  }
  return jaro + prefix * 0.1 * (1 - jaro);
}

/**
 * Fuzzy word-level matching: slide a window of pattern words over text words,
 * return the best average Jaro-Winkler score and the matched text fragment.
 */
export function fuzzyWordMatch(pattern, text) {
  const pWords = pattern.toLowerCase().split(/\s+/).filter(Boolean);
  const tWords = text.toLowerCase().split(/\s+/).filter(Boolean);
  if (pWords.length === 0 || tWords.length === 0) return { score: 0, matched: '' };
  let bestScore = 0, bestMatched = '';
  for (let i = 0; i <= tWords.length - pWords.length; i++) {
    let windowScore = 0;
    for (let j = 0; j < pWords.length; j++) {
      windowScore += jaroWinkler(pWords[j], tWords[i + j]);
    }
    const avg = windowScore / pWords.length;
    if (avg > bestScore) { bestScore = avg; bestMatched = tWords.slice(i, i + pWords.length).join(' '); }
  }
  return { score: bestScore, matched: bestMatched };
}

// ---------------------------------------------------------------------------
// Cue map helpers — used by InputBar to detect cue phrase matches in captions
// ---------------------------------------------------------------------------

/**
 * Build a Map of lowercase cue phrase → { index, mode, fuzzy } from a parsed file.
 * Each `<!-- cue:phrase -->` entry creates one mapping.
 * Mode is 'next' (default), 'skip' (cue*:), or 'any' (cue**:).
 * Fuzzy is true when the cue uses `cue~:` modifier.
 *
 * @param {{ lineCodes: object[] }} file
 * @returns {Map<string, { index: number, mode: string, fuzzy: boolean }>}
 */
export function buildCueMap(file) {
  const map = new Map();
  if (!file?.lineCodes) return map;
  for (let i = 0; i < file.lineCodes.length; i++) {
    const lc = file.lineCodes[i];
    if (lc.cue) {
      map.set(lc.cue.toLowerCase(), { index: i, mode: lc.cueMode || 'next', fuzzy: !!lc.cueFuzzy });
    }
  }
  return map;
}

/**
 * Check if caption text matches any registered cue phrase that is eligible
 * to fire from the current pointer position.
 *
 * Returns the first match (phrase + target line index) or null.
 *
 * Supports glob-style wildcards: `*` in a cue phrase matches any characters.
 * E.g. `Let us *` matches "Let us pray", "Let us go", etc.
 * Without `*`, the phrase is matched as a substring (case-insensitive).
 *
 * Fuzzy matching (`cue~:phrase`): uses Jaro-Winkler word-level similarity
 * to match approximate phrases (catches STT variations).
 *
 * Cue mode determines eligibility relative to the pointer:
 *   - 'next': only fires if this cue is the NEXT cue after the pointer
 *   - 'skip': fires if this cue is anywhere ahead of the pointer
 *   - 'any':  fires regardless of pointer position (can go backwards)
 *
 * @param {Map<string, { index: number, mode: string, fuzzy?: boolean }>} cueMap — from buildCueMap()
 * @param {string} text — caption text to test
 * @param {number} [pointer=-1] — current file pointer position (-1 = legacy/no filtering)
 * @param {{ fuzzyThreshold?: number }} [opts] — optional config
 * @returns {{ phrase: string, index: number } | null}
 */
export function checkCueMatch(cueMap, text, pointer, opts) {
  if (!text || !cueMap || cueMap.size === 0) return null;
  const lower = text.toLowerCase();
  const hasPointer = pointer !== undefined && pointer !== null && pointer >= 0;
  const fuzzyThreshold = opts?.fuzzyThreshold ?? 0.75;

  // Determine the "next cue" index: the smallest cue index > pointer.
  // Cues with mode='next' can only fire if they are this exact next cue.
  let nextCueIndex = Infinity;
  if (hasPointer) {
    for (const [, entry] of cueMap) {
      if (entry.index > pointer && entry.index < nextCueIndex) {
        nextCueIndex = entry.index;
      }
    }
  }

  for (const [phrase, entry] of cueMap) {
    // Check eligibility based on mode and pointer position
    if (hasPointer) {
      if (entry.mode === 'next') {
        // Only fires if this is THE next cue after the pointer
        if (entry.index !== nextCueIndex) continue;
      } else if (entry.mode === 'skip') {
        // Can skip ahead but must be forward from the pointer
        if (entry.index <= pointer) continue;
      }
      // mode === 'any': no position restriction
    }

    // Test if the text matches the cue phrase
    let matches = false;
    if (phrase.includes('*')) {
      // Glob pattern: escape regex chars, convert * to .*
      const escaped = phrase.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
      try {
        matches = new RegExp(escaped).test(lower);
      } catch { /* invalid pattern — skip */ }
    } else if (entry.fuzzy) {
      // Fuzzy matching via Jaro-Winkler word-level similarity
      const { score } = fuzzyWordMatch(phrase, lower);
      matches = score >= fuzzyThreshold;
    } else {
      matches = lower.includes(phrase);
    }

    if (matches) return { phrase, index: entry.index };
  }
  return null;
}
