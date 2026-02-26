import { useState, useRef } from 'react';

const POINTERS_KEY = 'lcyt-pointers';

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

  // ─── File loading ────────────────────────────────────────

  function loadFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = (e) => {
        const lines = e.target.result
          .split('\n')
          .map(l => l.trim())
          .filter(l => l.length > 0);

        const id = crypto.randomUUID();
        const pointers = loadPointers();
        const savedPointer = pointers[file.name] ?? 0;
        const pointer = Math.min(savedPointer, Math.max(0, lines.length - 1));

        const entry = { id, name: file.name, lines, pointer };
        const newFiles = [...filesRef.current, entry];
        setFiles(newFiles);

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

  const activeFile = files.find(f => f.id === activeId) ?? null;

  return {
    files,
    activeId,
    activeFile,
    lastSentLine,
    setLastSentLine,
    loadFile,
    removeFile,
    setActive,
    cycleActive,
    setPointer,
    advancePointer,
    clearPointers,
  };
}
