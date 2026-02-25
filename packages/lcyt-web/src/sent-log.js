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
  // Update all entries with this requestId (handles batch sends)
  const matching = entries.filter(e => e.requestId === requestId);
  if (!matching.length) return;
  matching.forEach(e => {
    e.pending = false;
    e.sequence = sequence;
    e.serverTimestamp = serverTimestamp;
  });
  emit('lcyt:sent-updated', { total: entries.length });
}

export function markError(requestId) {
  // Update all entries with this requestId (handles batch sends)
  const matching = entries.filter(e => e.requestId === requestId);
  if (!matching.length) return;
  matching.forEach(e => {
    e.pending = false;
    e.error = true;
  });
  emit('lcyt:sent-updated', { total: entries.length });
}

export function updateRequestId(oldId, newId) {
  entries.forEach(e => {
    if (e.requestId === oldId) e.requestId = newId;
  });
  emit('lcyt:sent-updated', { total: entries.length });
}

export function getAll() {
  return [...entries];
}

export function clear() {
  entries = [];
  emit('lcyt:sent-updated', { entry: null, total: 0 });
}
