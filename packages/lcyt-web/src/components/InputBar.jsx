import { useState, useRef, useMemo, forwardRef, useImperativeHandle, useEffect } from 'react';
import { useSessionContext } from '../contexts/SessionContext';
import { useFileContext } from '../contexts/FileContext';
import { useSentLogContext } from '../contexts/SentLogContext';
import { useToastContext } from '../contexts/ToastContext';
import { KEYS } from '../lib/storageKeys.js';
import { COMMON_LANGUAGES } from '../lib/sttConfig';
import { getEnabledTranslations, getTranslationShowOriginal } from '../lib/translationConfig';
import { translateAll, openLocalCaptionFile, formatVttCue, formatYouTubeLine } from '../lib/translate';
import { getActiveCodes } from '../lib/metacode-active.js';
import { readInputLang, writeInputLang, INPUT_LANG_EVENT } from '../lib/inputLang';
import { parseFileContent } from '../lib/metacode-parser.js';
import { drainActions, findLineIndexForRaw, performFileSwitchAction, buildCueMap, checkCueMatch } from '../lib/metacode-runtime.js';

// Matches [lang-code] at the start of input, e.g. "[fi-FI]"
const LANG_CODE_RE = /^\[([a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?)\]\s*$/i;

// Dedup window (ms) to prevent double-firing a cue from both local match
// and backend SSE event arriving for the same phrase.
const CUE_DEDUP_MS = 3000;

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
  // Dedup guard: tracks last cue fired (phrase + timestamp) to prevent
  // double-firing when both local match and SSE event trigger for the same cue.
  const lastCueFiredRef = useRef({ phrase: '', time: 0 });

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

  // Build cue phrase → line index map from the active file's cue metacodes.
  // When a sent caption matches a cue phrase, the pointer jumps to that line
  // and the cue line's content is auto-sent.
  const cueMap = useMemo(
    () => buildCueMap(fileStore.activeFile),
    [fileStore.activeFile?.id, fileStore.activeFile?.lineCodes]
  );

  // Listen for backend-fired cue_fired SSE events (e.g. from CueEngine matching
  // against STT transcripts) and jump the pointer + auto-send the cue line.
  useEffect(() => {
    if (!session.subscribeSseEvent) return;
    const unsub = session.subscribeSseEvent('cue_fired', (data) => {
      const file = fileStore.activeFile;
      if (!file || cueMap.size === 0) return;
      const label = (data.label || data.matched || '').toLowerCase();
      if (cueMap.has(label)) {
        // Dedup: skip if same cue was fired locally within the dedup window
        const last = lastCueFiredRef.current;
        if (last.phrase === label && (Date.now() - last.time) < CUE_DEDUP_MS) return;
        lastCueFiredRef.current = { phrase: label, time: Date.now() };
        const targetIdx = cueMap.get(label);
        fileStore.setPointer(file.id, targetIdx);
        showToast(`Cue: ${data.label}`, 'info', 2000);
        // Auto-send: the cue line has content — send it after pointer update
        setTimeout(() => handleSendRef.current?.(), 0);
      }
    });
    return unsub;
  }, [session.subscribeSseEvent, cueMap, fileStore, showToast]);

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
      const pre = await drainActions({ file, startPtr: ptr, fileStore, timerRef, handleSendRef, showToast, session });
      if (pre.status === 'stop') return;
      if (pre.status === 'done') {
        fileStore.setPointer(file.id, file.lines.length - 1);
        showToast('End of file reached', 'info', 2500);
        return;
      }
      if (pre.pointer !== ptr) {
        fileStore.setPointer(file.id, pre.pointer);
        return;
      }

      const lineText = file.lines[ptr];
      const lc = file.lineCodes?.[ptr] || {};
      const prevPointer = ptr;
      try {
        await doSend(lineText, lc);
        fileStore.setLastSentLine({ fileId: file.id, lineIndex: prevPointer });

        ptr = ptr + 1;
        const post = await drainActions({ file, startPtr: ptr, fileStore, timerRef, handleSendRef, showToast, session });
        if (post.status === 'stop') return;
        if (post.status === 'done') {
          fileStore.setPointer(file.id, file.lines.length - 1);
          showToast('End of file reached', 'info', 2500);
        } else {
          fileStore.setPointer(file.id, post.pointer);
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

        // Check if the sent text matches any cue phrase in the active file.
        // If so, jump the pointer to the cue line and auto-send its content.
        const match = checkCueMatch(cueMap, text);
        if (match) {
          const file = fileStore.activeFile;
          if (file) {
            lastCueFiredRef.current = { phrase: match.phrase, time: Date.now() };
            fileStore.setPointer(file.id, match.index);
            showToast(`Cue: ${match.phrase}`, 'info', 2000);
            // Auto-send the cue line content after React processes the pointer update
            setTimeout(() => handleSendRef.current?.(), 0);
          }
        }
      } catch (err) {
        handleSendError(err);
      }
    }
  }

  // File-switch and goto helpers live in src/lib/metacode-runtime.js

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
