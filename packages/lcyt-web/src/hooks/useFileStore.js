import { useState, useRef, useEffect } from 'react';
import { parseFileContent } from '../lib/metacode-parser.js';
import { expandVarBlocks } from '../lib/metacode-varblocks.js';
import { findLineIndexForRaw } from '../lib/metacode-runtime.js';

const POINTERS_KEY = 'lcyt-pointers';
const FILES_STORAGE_KEY = 'lcyt:files';
const FILES_STORAGE_MAX_BYTES = 500_000; // 500 KB per file max
const FILES_STORAGE_MAX_COUNT = 10;

/** Generate a unique ID, falling back to a timestamp+random string if crypto is unavailable. */
function newId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Manages loaded caption files, active file selection, and per-file pointer positions.
 *
 * @param {object} [opts]
 * @param {function} [opts.onFileLoaded]     - (file: {id, name, lines, pointer}) => void
 * @param {function} [opts.onFileRemoved]    - (fileId: string) => void
 * @param {function} [opts.onActiveChanged]  - ({fileId, file}) => void
 * @param {function} [opts.onPointerChanged] - ({fileId, fromIndex, toIndex, line}) => void
 * @param {function} [opts.getVariablesSnapshot] - () => ({ [name]: value }); used to expand
 *   {{name[N]}}/{{name[N*]}} variable-backed text blocks into virtual lines at parse time
 *   (see lib/metacode-varblocks.js). Omit to leave such markers unexpanded.
 */
export function useFileStore({
  onFileLoaded,
  onFileRemoved,
  onActiveChanged,
  onPointerChanged,
  getVariablesSnapshot,
} = {}) {
  const [files, setFilesState] = useState([]);
  const [activeId, setActiveIdState] = useState(null);
  // lastSentLine: { fileId, lineIndex } | null — drives flash animation in CaptionView
  const [lastSentLine, setLastSentLine] = useState(null);
  // rawEditMode: whether the CaptionView is in text-editor mode
  const [rawEditMode, setRawEditMode] = useState(false);
  // rawEditValue: the current content of the raw editor textarea (kept in sync)
  const [rawEditValue, setRawEditValue] = useState('');

  // Mirror state in refs so mutation functions always read fresh values
  const filesRef = useRef([]);
  const activeIdRef = useRef(null);

  // Keep callbacks always fresh — updated on every render before any code runs
  const cbs = useRef({});
  cbs.current = { onFileLoaded, onFileRemoved, onActiveChanged, onPointerChanged };
  const getVariablesSnapshotRef = useRef(getVariablesSnapshot);
  getVariablesSnapshotRef.current = getVariablesSnapshot;

  /**
   * parseFileContent() + {{name[N]}} block expansion using the current
   * variable snapshot. `previous` (a file's currently-displayed
   * lines/lineCodes/lineNumbers) makes already-materialized blocks reused
   * verbatim rather than recomputed — pass it only from the reactive
   * background path (refreshVarBlocks), never from a user-initiated raw-text
   * save, which should always do a fully fresh expansion.
   */
  function parseAndExpand(rawText, previous) {
    const parsed = parseFileContent(rawText);
    const snapshot = getVariablesSnapshotRef.current?.() || {};
    const expanded = expandVarBlocks(parsed.lines, parsed.lineCodes, parsed.lineNumbers, snapshot, previous ? { previous } : undefined);
    return { ...parsed, ...expanded };
  }

  function setFiles(newFiles) {
    filesRef.current = newFiles;
    setFilesState(newFiles);
  }

  function setActiveId(newId) {
    activeIdRef.current = newId;
    setActiveIdState(newId);
  }

  // ─── Persistence ────────────────────────────────────────

  function loadPointers() {
    try {
      const raw = localStorage.getItem(POINTERS_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  }

  function savePointerToStorage(name, index) {
    try {
      const map = loadPointers();
      map[name] = index;
      localStorage.setItem(POINTERS_KEY, JSON.stringify(map));
    } catch {}
  }

  function clearPointers() {
    localStorage.removeItem(POINTERS_KEY);
  }

  // ─── File content persistence ────────────────────────────

  function saveFilesToStorage(fileList) {
    try {
      const toSave = fileList
        .filter(f => f.rawText !== undefined)
        .slice(0, FILES_STORAGE_MAX_COUNT)
        .map(f => ({
          name: f.name,
          rawText: f.rawText.length > FILES_STORAGE_MAX_BYTES
            ? f.rawText.slice(0, FILES_STORAGE_MAX_BYTES)
            : f.rawText,
        }));
      localStorage.setItem(FILES_STORAGE_KEY, JSON.stringify(toSave));
    } catch {}
  }

  // Load files from localStorage on first mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(FILES_STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (!Array.isArray(saved) || saved.length === 0) return;

      const pointers = loadPointers();
      const entries = [];
      for (const item of saved) {
        if (!item.name || typeof item.rawText !== 'string') continue;
        const { lines, lineCodes, lineNumbers, cueDefs, actionDefs } = parseAndExpand(item.rawText);
        const id = newId();
        const savedPointer = pointers[item.name] ?? 0;
        const pointer = Math.min(savedPointer, Math.max(0, lines.length - 1));
        entries.push({ id, name: item.name, lines, lineCodes, lineNumbers, cueDefs, actionDefs, pointer, rawText: item.rawText });
      }
      if (entries.length === 0) return;
      setFiles(entries);
      setActiveId(entries[0].id);
      cbs.current.onActiveChanged?.({ fileId: entries[0].id, file: entries[0] });
      for (const entry of entries) {
        cbs.current.onFileLoaded?.(entry);
      }
    } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── File loading ────────────────────────────────────────

  function loadFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = (e) => {
        const rawText = e.target.result;
        const { lines, lineCodes, lineNumbers, cueDefs, actionDefs } = parseAndExpand(rawText);

        const id = newId();
        const pointers = loadPointers();
        const savedPointer = pointers[file.name] ?? 0;
        const pointer = Math.min(savedPointer, Math.max(0, lines.length - 1));

        const entry = { id, name: file.name, lines, lineCodes, lineNumbers, cueDefs, actionDefs, pointer, rawText };
        const newFiles = [...filesRef.current, entry];
        setFiles(newFiles);
        saveFilesToStorage(newFiles);

        if (!activeIdRef.current) {
          setActiveId(id);
          cbs.current.onActiveChanged?.({ fileId: id, file: entry });
        }

        cbs.current.onFileLoaded?.(entry);
        resolve(entry);
      };

      reader.onerror = () => reject(new Error(`Failed to read file: ${file.name}`));
      reader.readAsText(file);
    });
  }

  // ─── File removal ────────────────────────────────────────

  function removeFile(id) {
    const idx = filesRef.current.findIndex(f => f.id === id);
    if (idx === -1) return;

    const newFiles = filesRef.current.filter(f => f.id !== id);
    setFiles(newFiles);
    saveFilesToStorage(newFiles);
    cbs.current.onFileRemoved?.(id);

    if (activeIdRef.current === id) {
      const newActiveId = newFiles.length > 0
        ? newFiles[Math.min(idx, newFiles.length - 1)].id
        : null;
      setActiveId(newActiveId);
      const newActiveFile = newFiles.find(f => f.id === newActiveId) ?? null;
      cbs.current.onActiveChanged?.({ fileId: newActiveId, file: newActiveFile });
    }
  }

  // ─── Active management ──────────────────────────────────

  function setActive(id) {
    if (!filesRef.current.find(f => f.id === id)) return;
    setActiveId(id);
    const file = filesRef.current.find(f => f.id === id);
    cbs.current.onActiveChanged?.({ fileId: id, file });
  }

  function cycleActive() {
    if (filesRef.current.length <= 1) return;
    const idx = filesRef.current.findIndex(f => f.id === activeIdRef.current);
    const nextIdx = (idx + 1) % filesRef.current.length;
    const nextId = filesRef.current[nextIdx].id;
    setActiveId(nextId);
    cbs.current.onActiveChanged?.({ fileId: nextId, file: filesRef.current[nextIdx] });
  }

  // ─── Pointer management ─────────────────────────────────

  function setPointer(id, index) {
    const fileIdx = filesRef.current.findIndex(f => f.id === id);
    if (fileIdx === -1) return;

    const file = filesRef.current[fileIdx];
    const fromIndex = file.pointer;
    const clamped = Math.max(0, Math.min(index, file.lines.length - 1));

    const newFiles = [...filesRef.current];
    newFiles[fileIdx] = { ...file, pointer: clamped };
    setFiles(newFiles);
    savePointerToStorage(file.name, clamped);

    cbs.current.onPointerChanged?.({
      fileId: id,
      fromIndex,
      toIndex: clamped,
      line: file.lines[clamped],
    });
  }

  function advancePointer(id) {
    const fileIdx = filesRef.current.findIndex(f => f.id === id);
    if (fileIdx === -1) return;

    const file = filesRef.current[fileIdx];
    const fromIndex = file.pointer;
    const next = Math.min(file.pointer + 1, file.lines.length - 1);

    const newFiles = [...filesRef.current];
    newFiles[fileIdx] = { ...file, pointer: next };
    setFiles(newFiles);
    savePointerToStorage(file.name, next);

    cbs.current.onPointerChanged?.({
      fileId: id,
      fromIndex,
      toIndex: next,
      line: file.lines[next],
    });
  }

  // ─── Raw edit ───────────────────────────────────────────

  /** Update a file in memory from raw text (from the editor). Also persists to localStorage. */
  function updateFileFromRawText(id, rawText) {
    const fileIdx = filesRef.current.findIndex(f => f.id === id);
    if (fileIdx === -1) return;

    const file = filesRef.current[fileIdx];
    const { lines, lineCodes, lineNumbers, cueDefs, actionDefs } = parseAndExpand(rawText);
    const pointer = Math.min(file.pointer, Math.max(0, lines.length - 1));

    const newFiles = [...filesRef.current];
    newFiles[fileIdx] = { ...file, lines, lineCodes, lineNumbers, cueDefs, actionDefs, rawText, pointer };
    setFiles(newFiles);
    saveFilesToStorage(newFiles);
  }

  /**
   * Re-run {{name[N]}} block expansion for a file whose raw text has NOT
   * changed (only a variable resolved) — used by FileContext's reactive
   * re-expand-pending effect. Unlike updateFileFromRawText's raw index
   * clamp (correct for user edits, where the array naturally grows/shrinks
   * under the pointer), this remaps the pointer by raw source line number
   * so a block materializing into a different number of virtual lines can
   * never silently move the pointer onto unrelated content — see
   * docs/plans/plan_live_variables.md §3. Also passes the file's current
   * state as `previous` so any already-materialized sibling block is reused
   * verbatim instead of being silently reflowed by this reparse.
   */
  function refreshVarBlocks(id) {
    const fileIdx = filesRef.current.findIndex(f => f.id === id);
    if (fileIdx === -1) return;

    const file = filesRef.current[fileIdx];
    const targetRaw = file.lineNumbers?.[file.pointer];
    const { lines, lineCodes, lineNumbers, cueDefs, actionDefs } = parseAndExpand(file.rawText, {
      lines: file.lines, lineCodes: file.lineCodes, lineNumbers: file.lineNumbers,
    });
    const pointer = targetRaw != null
      ? Math.min(findLineIndexForRaw(lineNumbers, targetRaw), Math.max(0, lines.length - 1))
      : Math.min(file.pointer, Math.max(0, lines.length - 1));

    const newFiles = [...filesRef.current];
    newFiles[fileIdx] = { ...file, lines, lineCodes, lineNumbers, cueDefs, actionDefs, pointer };
    setFiles(newFiles);
    saveFilesToStorage(newFiles);
  }

  /**
   * Create a new empty file with the given name, make it active, and enter raw edit mode.
   * @param {string} name
   */
  function createEmptyFile(name) {
    const id = newId();
    const entry = { id, name, lines: [], lineCodes: [], lineNumbers: [], pointer: 0, rawText: '' };
    const newFiles = [...filesRef.current, entry];
    setFiles(newFiles);
    setActiveId(id);
    saveFilesToStorage(newFiles);
    cbs.current.onActiveChanged?.({ fileId: id, file: entry });
    cbs.current.onFileLoaded?.(entry);
    setRawEditMode(true);
    return entry;
  }

  /**
   * Load a file from raw text content and add it to the store.
   * Does NOT change the active file (caller is responsible).
   * @param {string} name
   * @param {string} rawText
   * @returns {{ id, name, lines, lineCodes, lineNumbers, pointer, rawText }}
   */
  function loadFileFromText(name, rawText) {
    const { lines, lineCodes, lineNumbers, cueDefs, actionDefs } = parseAndExpand(rawText);
    const id = newId();
    const entry = { id, name, lines, lineCodes, lineNumbers, cueDefs, actionDefs, pointer: 0, rawText };
    const newFiles = [...filesRef.current, entry];
    setFiles(newFiles);
    saveFilesToStorage(newFiles);
    cbs.current.onFileLoaded?.(entry);
    return entry;
  }

  const activeFile = files.find(f => f.id === activeId) ?? null;

  return {
    files,
    activeId,
    activeFile,
    lastSentLine,
    setLastSentLine,
    rawEditMode,
    setRawEditMode,
    rawEditValue,
    setRawEditValue,
    loadFile,
    loadFileFromText,
    removeFile,
    setActive,
    cycleActive,
    setPointer,
    advancePointer,
    clearPointers,
    updateFileFromRawText,
    refreshVarBlocks,
    createEmptyFile,
  };
}
