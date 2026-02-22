const POINTERS_KEY = 'lcyt-pointers';

let files = [];   // Array<{ id, name, lines, pointer }>
let activeId = null;

// ─── Persistence ─────────────────────────────────────────

function loadPointers() {
  try {
    const raw = localStorage.getItem(POINTERS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function savePointer(name, index) {
  try {
    const map = loadPointers();
    map[name] = index;
    localStorage.setItem(POINTERS_KEY, JSON.stringify(map));
  } catch {
    // ignore quota errors
  }
}

export function clearPointers() {
  localStorage.removeItem(POINTERS_KEY);
}

// ─── Events ──────────────────────────────────────────────

function emit(name, detail = {}) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

// ─── File loading ─────────────────────────────────────────

export function loadFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      const text = e.target.result;
      const lines = text
        .split('\n')
        .map(l => l.trim())
        .filter(l => l.length > 0);

      const id = crypto.randomUUID();
      const pointers = loadPointers();
      const savedPointer = pointers[file.name] ?? 0;
      const pointer = Math.min(savedPointer, Math.max(0, lines.length - 1));

      const entry = { id, name: file.name, lines, pointer };
      files.push(entry);

      if (!activeId) {
        activeId = id;
        emit('lcyt:active-changed', { id });
      }

      emit('lcyt:files-changed', { files: getAll() });
      resolve(entry);
    };

    reader.onerror = () => reject(new Error(`Failed to read file: ${file.name}`));
    reader.readAsText(file);
  });
}

// ─── Query ────────────────────────────────────────────────

export function getAll() {
  return files.map(f => ({ ...f }));
}

export function getActive() {
  if (!activeId) return null;
  const f = files.find(f => f.id === activeId);
  return f ? { ...f } : null;
}

export function getById(id) {
  const f = files.find(f => f.id === id);
  return f ? { ...f } : null;
}

// ─── Active management ────────────────────────────────────

export function setActive(id) {
  if (!files.find(f => f.id === id)) return;
  activeId = id;
  emit('lcyt:active-changed', { id });
}

export function cycleActive() {
  if (files.length <= 1) return;
  const idx = files.findIndex(f => f.id === activeId);
  const nextIdx = (idx + 1) % files.length;
  activeId = files[nextIdx].id;
  emit('lcyt:active-changed', { id: activeId });
}

// ─── Pointer management ───────────────────────────────────

export function setPointer(id, index) {
  const f = files.find(f => f.id === id);
  if (!f) return;

  const clamped = Math.max(0, Math.min(index, f.lines.length - 1));
  f.pointer = clamped;
  savePointer(f.name, clamped);

  emit('lcyt:pointer-changed', { id, pointer: clamped });
}

export function advancePointer(id) {
  const f = files.find(f => f.id === id);
  if (!f) return;

  // Clamp at last line (don't wrap)
  const next = Math.min(f.pointer + 1, f.lines.length - 1);
  f.pointer = next;
  savePointer(f.name, next);

  emit('lcyt:pointer-changed', { id, pointer: next });
}

// ─── Remove ───────────────────────────────────────────────

export function removeFile(id) {
  const idx = files.findIndex(f => f.id === id);
  if (idx === -1) return;

  files.splice(idx, 1);

  if (activeId === id) {
    if (files.length === 0) {
      activeId = null;
    } else {
      // Activate adjacent file
      activeId = files[Math.min(idx, files.length - 1)].id;
    }
    emit('lcyt:active-changed', { id: activeId });
  }

  emit('lcyt:files-changed', { files: getAll() });
}
