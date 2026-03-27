/**
 * useBrowserFileSaving — saves confirmed captions directly to the user's
 * computer as a WebVTT file.
 *
 * Uses the File System Access API (showSaveFilePicker) when available
 * (Chrome, Edge, Safari 15.2+) for real-time streaming writes.
 * Falls back to in-memory accumulation + a download on stopSaving() for
 * browsers without showSaveFilePicker (Firefox).
 *
 * VTT timestamps are session-relative (start from 00:00:00.000 at the
 * moment startSaving() is called), making the file load-able alongside
 * a recording of the event.
 */

import { useState, useRef, useCallback, useEffect } from 'react';

const HAS_FILE_ACCESS = typeof window !== 'undefined' && 'showSaveFilePicker' in window;

const CUE_DURATION_MS = 3000; // assumed caption display time when no next cue follows

function vttTime(relativeMs) {
  const h  = Math.floor(relativeMs / 3600000);
  const m  = Math.floor((relativeMs % 3600000) / 60000);
  const s  = Math.floor((relativeMs % 60000) / 1000);
  const ms = relativeMs % 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

/**
 * @param {Object} params
 * @param {Array}  params.entries — sentLog entries array (newest first)
 */
export function useBrowserFileSaving({ entries }) {
  const [isWriting, setIsWriting]   = useState(false);
  const [filename,  setFilename]    = useState('');
  const [cueCount,  setCueCount]    = useState(0);
  const [error,     setError]       = useState(null);

  const sessionStartRef = useRef(null);  // Date.now() when startSaving() was called
  const writerRef       = useRef(null);  // FileSystemWritableFileStream | null
  const fallbackRef     = useRef([]);    // accumulated chunks when File Access unavailable
  const writtenIdsRef   = useRef(new Set());
  const cueIndexRef     = useRef(0);

  // Watch for newly confirmed entries and write them
  useEffect(() => {
    if (!isWriting || sessionStartRef.current == null) return;

    // entries is newest-first; iterate in reverse so we write oldest first
    const toWrite = [];
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i];
      if (!e || e.pending || e.error) continue;
      if (writtenIdsRef.current.has(e.requestId)) continue;
      toWrite.push(e);
    }

    for (const e of toWrite) {
      writtenIdsRef.current.add(e.requestId);
      cueIndexRef.current += 1;
      const idx = cueIndexRef.current;

      const startMs = new Date(e.timestamp).getTime() - sessionStartRef.current;
      const endMs   = startMs + CUE_DURATION_MS;
      const cue = `${idx}\n${vttTime(Math.max(0, startMs))} --> ${vttTime(Math.max(CUE_DURATION_MS, endMs))}\n${e.text}\n\n`;

      if (HAS_FILE_ACCESS && writerRef.current) {
        writerRef.current.write(cue).catch(err => setError(err.message));
      } else {
        fallbackRef.current.push(cue);
      }

      setCueCount(idx);
    }
  }, [entries, isWriting]);

  const startSaving = useCallback(async function startSaving(suggestedName) {
    const name = suggestedName || `captions-${new Date().toISOString().slice(0, 10)}.vtt`;
    setError(null);
    writtenIdsRef.current = new Set();
    fallbackRef.current   = [];
    cueIndexRef.current   = 0;
    setCueCount(0);
    sessionStartRef.current = Date.now();

    if (HAS_FILE_ACCESS) {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: name,
          types: [
            { description: 'WebVTT subtitles', accept: { 'text/vtt': ['.vtt'] } },
          ],
        });
        const writable = await handle.createWritable();
        await writable.write('WEBVTT\n\n');
        writerRef.current = writable;
        setFilename(handle.name);
        setIsWriting(true);
      } catch (err) {
        if (err.name !== 'AbortError') setError(err.message);
        sessionStartRef.current = null;
      }
    } else {
      // Fallback: accumulate in memory, download on stop
      fallbackRef.current = ['WEBVTT\n\n'];
      setFilename(name);
      setIsWriting(true);
    }
  }, []);

  const stopSaving = useCallback(async function stopSaving() {
    if (HAS_FILE_ACCESS && writerRef.current) {
      try { await writerRef.current.close(); } catch { /* ignore */ }
      writerRef.current = null;
    } else if (fallbackRef.current.length > 1) {
      // Trigger browser download of accumulated content
      const blob = new Blob(fallbackRef.current, { type: 'text/vtt' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = filename || 'captions.vtt';
      a.click();
      URL.revokeObjectURL(url);
    }
    fallbackRef.current     = [];
    writtenIdsRef.current   = new Set();
    sessionStartRef.current = null;
    cueIndexRef.current     = 0;
    setIsWriting(false);
    setFilename('');
    setCueCount(0);
  }, [filename]);

  return {
    isWriting,
    filename,
    cueCount,
    error,
    hasFileAccess: HAS_FILE_ACCESS,
    startSaving,
    stopSaving,
  };
}
