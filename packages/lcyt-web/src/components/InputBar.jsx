import { useState, useRef, forwardRef, useImperativeHandle, useEffect } from 'react';
import { useSessionContext } from '../contexts/SessionContext';
import { useFileContext } from '../contexts/FileContext';
import { useSentLogContext } from '../contexts/SentLogContext';
import { useToastContext } from '../contexts/ToastContext';
import { KEYS } from '../lib/storageKeys.js';
import { COMMON_LANGUAGES } from '../lib/sttConfig';
import { getEnabledTranslations, getTranslationShowOriginal } from '../lib/translationConfig';
import { translateAll, openLocalCaptionFile, formatVttCue, formatYouTubeLine } from '../lib/translate';
import { getActiveCodes } from '../lib/activeCodes';
import { readInputLang, writeInputLang, INPUT_LANG_EVENT } from '../lib/inputLang';
import { parseFileContent } from '../lib/fileUtils';

// Matches [lang-code] at the start of input, e.g. "[fi-FI]"
const LANG_CODE_RE = /^\[([a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?)\]\s*$/i;

export const InputBar = forwardRef(function InputBar(_props, ref) {
  const session = useSessionContext();
  const fileStore = useFileContext();
  const sentLog = useSentLogContext();
  const { showToast } = useToastContext();

  const [inputValue, setInputValue] = useState('');
  const [errorFlash, setErrorFlash] = useState(false);
  const [sendFlash, setSendFlash] = useState(false);
  const [batchCount, setBatchCount] = useState(0);
  const [inputLang, setInputLang] = useState(readInputLang);
  const [langPickerOpen, setLangPickerOpen] = useState(false);
  const [langQuery, setLangQuery] = useState('');
  const inputRef = useRef(null);
  const langPickerRef = useRef(null);

  // Ref always pointing to latest handleSend — used by the timer auto-advance.
  const handleSendRef = useRef(null);
  // Active timer handle for auto-advance (timer metacode).
  const timerRef = useRef(null);

  // Keep inputLang in sync when changed by ActionsPanel or file metadata
  useEffect(() => {
    function onLangChange() { setInputLang(readInputLang()); }
    window.addEventListener(INPUT_LANG_EVENT, onLangChange);
    return () => window.removeEventListener(INPUT_LANG_EVENT, onLangChange);
  }, []);

  // Clean up any pending timer on unmount
  useEffect(() => {
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, []);

  // Per-language local file handles: Map<lang, { writable, seqIdx, format }>
  const localFileHandlesRef = useRef(new Map());
  const localFileSeqRef = useRef({});

  useImperativeHandle(ref, () => ({
    focus: () => inputRef.current?.focus(),
    triggerSend: handleSend,
    // Called from CaptionView double-click (text is already known)
    sendText: async (text, fileId, lineIndex) => {
      if (!session.connected) { flashError(); return; }
      try {
        const file = fileStore.files.find(f => f.id === fileId);
        const lc = file?.lineCodes?.[lineIndex] || {};
        await doSend(text, lc);
        fileStore.setLastSentLine({ fileId, lineIndex });
      } catch (err) {
        handleSendError(err);
      }
    },
  }));

  function getBatchIntervalMs() {
    try {
      const v = parseInt(localStorage.getItem(KEYS.captions.batchInterval) || '0', 10);
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

  function setInputBarLang(code) {
    setInputLang(code);
    writeInputLang(code);
  }

  async function writeLocalFiles(entries, timestamp) {
    for (const entry of entries) {
      const lang = entry.lang;
      let fileInfo = localFileHandlesRef.current.get(lang);
      if (!fileInfo) {
        const suggestedName = `input-captions-${lang}-${new Date().toISOString().slice(0, 10)}.${entry.format === 'vtt' ? 'vtt' : 'txt'}`;
        const opened = await openLocalCaptionFile(suggestedName);
        if (!opened) continue;
        if (entry.format === 'vtt') await opened.writable.write('WEBVTT\n\n');
        localFileSeqRef.current[lang] = 0;
        fileInfo = { writable: opened.writable, format: entry.format };
        localFileHandlesRef.current.set(lang, fileInfo);
      }
      const seqIdx = (localFileSeqRef.current[lang] || 0) + 1;
      localFileSeqRef.current[lang] = seqIdx;
      const ts = timestamp || new Date().toISOString().replace('Z', '');
      try {
        if (fileInfo.format === 'vtt') {
          await fileInfo.writable.write(formatVttCue(seqIdx, ts, null, entry.text));
        } else {
          await fileInfo.writable.write(formatYouTubeLine(entry.text));
        }
      } catch (e) {
        console.warn('Local file write failed', e);
      }
    }
  }

  async function doSend(text, lineCodes = {}) {
    if (!text?.trim()) return;

    // Merge manual active codes (from ActionsPanel) with per-line codes from file.
    // Per-line codes take priority; lang is derived from lineCodes.lang or inputLang.
    const manualCodes = getActiveCodes();
    const mergedCodes = { ...manualCodes, ...lineCodes };
    const effectiveLang = mergedCodes.lang || inputLang || null;
    if (effectiveLang) mergedCodes.lang = effectiveLang;
    else delete mergedCodes.lang;

    // If the file line has a lang code, persist it as the new inputLang
    if (lineCodes.lang && lineCodes.lang !== inputLang) {
      setInputBarLang(lineCodes.lang);
    }

    // Build translations and handle local file writing
    const enabledTranslations = getEnabledTranslations();
    let translationsMap = {};
    let captionLang = null;
    if (enabledTranslations.length > 0) {
      const result = await translateAll(text, effectiveLang || 'en-US', enabledTranslations);
      translationsMap = result.translationsMap;
      captionLang = result.captionLang;
      if (result.localFileEntries.length > 0) {
        writeLocalFiles(result.localFileEntries, undefined).catch(e => console.warn(e));
      }
    }

    const codes = Object.keys(mergedCodes).length > 0 ? mergedCodes : undefined;
    const opts = {
      ...(Object.keys(translationsMap).length > 0 && {
        translations: translationsMap,
        captionLang,
        showOriginal: getTranslationShowOriginal(),
      }),
      ...(codes && { codes }),
    };
    const finalOpts = Object.keys(opts).length > 0 ? opts : undefined;

    const intervalMs = getBatchIntervalMs();
    if (intervalMs > 0) {
      await session.construct(text, undefined, finalOpts);
      // Update badge from session queue length
      try { setBatchCount(session.getQueuedCount()); } catch {}
      flashSuccess();
      return;
    }

    await session.send(text, undefined, finalOpts);
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

      let ptr = file.pointer;

      /**
       * Drain action lines starting at ptr:
       *   audio     — fires lcyt:audio-capture event, advance ptr
       *   timer     — set auto-advance timer, set pointer, return 'stop'
       *   goto      — jump pointer to raw line N, return 'stop'
       *   fileSwitch / fileSwitchServer — switch active file, return 'stop'
       *   blank / heading — skip, advance ptr
       *   else — sendable line, break
       * Returns 'continue' | 'done' | 'stop'.
       */
      const drainActions = async () => {
        while (ptr < file.lines.length) {
          const lc = file.lineCodes?.[ptr] || {};
          const lineText = file.lines[ptr];

          if (lc.audioCapture) {
            window.dispatchEvent(new CustomEvent('lcyt:audio-capture', { detail: { action: lc.audioCapture } }));
            ptr++;
          } else if (lc.timer != null) {
            // Timer: advance past the timer line, then schedule a deferred send.
            ptr++;
            const target = ptr < file.lines.length ? ptr : file.lines.length - 1;
            fileStore.setPointer(file.id, target);
            if (timerRef.current) clearTimeout(timerRef.current);
            timerRef.current = setTimeout(() => handleSendRef.current?.(), lc.timer * 1000);
            return 'stop';
          } else if (lc.goto != null) {
            // Goto: find the lines[] index whose lineNumber >= targetRaw, jump there.
            const maxRaw = file.lineNumbers?.at(-1) ?? 0;
            const targetIdx = findLineIndexForRaw(file.lineNumbers, lc.goto);
            if (file.lineNumbers && lc.goto > maxRaw) {
              showToast(`goto: line ${lc.goto} is past end of file`, 'info', 2500);
            }
            fileStore.setPointer(file.id, targetIdx);
            return 'stop';
          } else if (lc.fileSwitch != null || lc.fileSwitchServer != null) {
            await handleFileSwitchAction(lc.fileSwitch, lc.fileSwitchServer);
            return 'stop';
          } else if (!lineText?.trim() || lineText?.startsWith('#')) {
            ptr++; // skip blank / heading
          } else {
            break; // found a sendable line
          }
        }
        return ptr >= file.lines.length ? 'done' : 'continue';
      };

      const preResult = await drainActions();
      if (preResult === 'stop') return;
      if (preResult === 'done') {
        fileStore.setPointer(file.id, file.lines.length - 1);
        showToast('End of file reached', 'info', 2500);
        return;
      }
      // If we only skipped blank/heading lines, just reposition the pointer.
      if (ptr !== file.pointer) {
        fileStore.setPointer(file.id, ptr);
        return;
      }

      const lineText = file.lines[ptr];
      const lc = file.lineCodes?.[ptr] || {};
      const prevPointer = ptr;

      try {
        await doSend(lineText, lc);
        fileStore.setLastSentLine({ fileId: file.id, lineIndex: prevPointer });

        // Advance past the sent line and drain any immediately following action lines.
        ptr = ptr + 1;
        const postResult = await drainActions();
        if (postResult === 'stop') return;
        if (postResult === 'done') {
          fileStore.setPointer(file.id, file.lines.length - 1);
          showToast('End of file reached', 'info', 2500);
        } else {
          fileStore.setPointer(file.id, ptr);
        }
      } catch (err) {
        handleSendError(err);
      }
    } else {
      // Check for [lang-code] shortcut
      const langMatch = text.trim().match(LANG_CODE_RE);
      if (langMatch) {
        const code = langMatch[1];
        setInputBarLang(code);
        setInputValue('');
        showToast(`Input language set to ${code}`, 'info', 2000);
        return;
      }

      // Send-custom mode
      try {
        await doSend(text.trim());
        setInputValue('');
      } catch (err) {
        handleSendError(err);
      }
    }
  }

  /**
   * Find the first index in lineNumbers[] where lineNumbers[i] >= targetRaw.
   * Used by the goto metacode to map raw file line numbers to lines[] indices.
   */
  function findLineIndexForRaw(lineNumbers, targetRaw) {
    if (!lineNumbers || lineNumbers.length === 0) return 0;
    for (let i = 0; i < lineNumbers.length; i++) {
      if (lineNumbers[i] >= targetRaw) return i;
    }
    return lineNumbers.length - 1;
  }

  /**
   * Handle a file-switch action metacode.
   * - fileSwitch: switch to an already-open file by name (no-op if not found)
   * - fileSwitchServer: fetch content from a URL and open (or switch if already open)
   */
  async function handleFileSwitchAction(switchName, switchServerPath) {
    if (switchServerPath) {
      try {
        const isAbsoluteUrl = switchServerPath.startsWith('http://') || switchServerPath.startsWith('https://');
        const url = isAbsoluteUrl ? switchServerPath : `${session.backendUrl}${switchServerPath}`;
        const token = session.getSessionToken?.();
        const fetchHeaders = token ? { Authorization: `Bearer ${token}` } : {};
        const res = await fetch(url, { headers: fetchHeaders });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const rawText = await res.text();
        // Derive a display name from the URL path (strip query string/fragment)
        let fileName = 'server-file.txt';
        try {
          fileName = decodeURIComponent(
            switchServerPath.replace(/[?#].*$/, '').split('/').pop() || 'server-file.txt'
          );
        } catch { /* malformed percent-encoding — keep default name */ }
        const existing = fileStore.files.find(f => f.name === fileName);
        if (existing) {
          fileStore.setActive(existing.id);
        } else {
          const entry = fileStore.loadFileFromText(fileName, rawText);
          fileStore.setActive(entry.id);
        }
      } catch (err) {
        showToast(`file[server] error: ${err.message}`, 'warning');
      }
    } else if (switchName) {
      const target = fileStore.files.find(f => f.name === switchName);
      if (target) {
        fileStore.setActive(target.id);
      } else {
        showToast(`file: "${switchName}" is not open`, 'info', 3000);
      }
    }
  }

  // Keep handleSendRef pointing to the latest version of handleSend so that
  // the timer auto-advance always calls fresh state (synchronous render-body update).
  handleSendRef.current = handleSend;

  function handleSendError(err) {
    const status = err.statusCode || err.status;
    if (status === 401) {
      session.disconnect();
      showToast('Session expired — please reconnect', 'error', 8000);
    } else {
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

  const langEntry = inputLang ? COMMON_LANGUAGES.find(l => l.code === inputLang) : null;
  const langLabel = langEntry ? langEntry.code : (inputLang || '…');

  const langMatches = langQuery.trim().length > 0
    ? COMMON_LANGUAGES.filter(l =>
        l.label.toLowerCase().includes(langQuery.toLowerCase()) ||
        l.code.toLowerCase().includes(langQuery.toLowerCase())
      )
    : COMMON_LANGUAGES.slice(0, 12);

  return (
    <div className="input-bar">
      {/* Language selector */}
      <div className="input-bar__lang-picker-wrap" ref={langPickerRef}>
        <button
          type="button"
          className="input-bar__lang-btn"
          title={inputLang ? `Input language: ${inputLang}` : 'Set input language'}
          onClick={() => {
            setLangPickerOpen(v => !v);
            setLangQuery('');
          }}
        >
          {langLabel}
        </button>
        {langPickerOpen && (
          <div className="input-bar__lang-dropdown">
            <input
              type="text"
              placeholder="Filter…"
              value={langQuery}
              autoFocus
              onChange={e => setLangQuery(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Escape') setLangPickerOpen(false);
              }}
              style={{ width: '100%', boxSizing: 'border-box', padding: '4px 8px', border: 'none', borderBottom: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-text)', outline: 'none' }}
            />
            {langMatches.map(l => (
              <button
                key={l.code}
                className="audio-lang-option"
                onClick={() => {
                  setInputBarLang(l.code);
                  setLangPickerOpen(false);
                }}
              >
                {l.label} <span className="audio-lang-code">{l.code}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <input
        ref={inputRef}
        className={inputCls}
        type="text"
        placeholder="Enter: send current line | Type: send custom text | [lang-code] to set language"
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
