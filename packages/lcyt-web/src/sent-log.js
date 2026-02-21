const MAX_ENTRIES = 500;

let entries = [];  // newest-first

function emit(name, detail = {}) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

export function add({ sequence, text }) {
  const entry = {
    sequence,
    text,
    timestamp: new Date().toISOString(),
  };

  entries.unshift(entry);

  if (entries.length > MAX_ENTRIES) {
    entries.length = MAX_ENTRIES;
  }

  emit('lcyt:sent-updated', { entry, total: entries.length });
}

export function getAll() {
  return [...entries];
}

export function clear() {
  entries = [];
  emit('lcyt:sent-updated', { entry: null, total: 0 });
}
