import { useState, useRef, useEffect } from 'react';
import { parseFileContent } from '../lib/fileUtils';

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
 */
export function useFileStore({
  onFileLoaded,
  onFileRemoved,
  onActiveChanged,
  onPointerChanged,
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
        const { lines, lineCodes, lineNumbers } = parseFileContent(item.rawText);
        const id = newId();
        const savedPointer = pointers[item.name] ?? 0;
        const pointer = Math.min(savedPointer, Math.max(0, lines.length - 1));
        entries.push({ id, name: item.name, lines, lineCodes, lineNumbers, pointer, rawText: item.rawText });
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
        const { lines, lineCodes, lineNumbers } = parseFileContent(rawText);

        const id = newId();
        const pointers = loadPointers();
        const savedPointer = pointers[file.name] ?? 0;
        const pointer = Math.min(savedPointer, Math.max(0, lines.length - 1));

        const entry = { id, name: file.name, lines, lineCodes, lineNumbers, pointer, rawText };
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
    const { lines, lineCodes, lineNumbers } = parseFileContent(rawText);
    const pointer = Math.min(file.pointer, Math.max(0, lines.length - 1));

    const newFiles = [...filesRef.current];
    newFiles[fileIdx] = { ...file, lines, lineCodes, lineNumbers, rawText, pointer };
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
    removeFile,
    setActive,
    cycleActive,
    setPointer,
    advancePointer,
    clearPointers,
    updateFileFromRawText,
    createEmptyFile,
  };
}
