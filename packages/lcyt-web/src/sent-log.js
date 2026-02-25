const MAX_ENTRIES = 500;

let entries = [];  // newest-first

function emit(name, detail = {}) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

export function add({ requestId, sequence, text, pending = false }) {
  const entry = {
    requestId,
    sequence,
    text,
    timestamp: new Date().toISOString(),
    pending,
    error: false,
  };

  entries.unshift(entry);

  if (entries.length > MAX_ENTRIES) {
    entries.length = MAX_ENTRIES;
  }

  emit('lcyt:sent-updated', { entry, total: entries.length });
}

export function confirm(requestId, { sequence, serverTimestamp } = {}) {
  const entry = entries.find(e => e.requestId === requestId);
  if (!entry) return;
  entry.pending = false;
  entry.sequence = sequence;
  entry.serverTimestamp = serverTimestamp;
  emit('lcyt:sent-updated', { entry, total: entries.length });
}

export function markError(requestId) {
  const entry = entries.find(e => e.requestId === requestId);
  if (!entry) return;
  entry.pending = false;
  entry.error = true;
  emit('lcyt:sent-updated', { entry, total: entries.length });
}

export function getAll() {
  return [...entries];
}

export function clear() {
  entries = [];
  emit('lcyt:sent-updated', { entry: null, total: 0 });
}
