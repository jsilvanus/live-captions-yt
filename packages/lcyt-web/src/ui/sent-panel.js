import * as sentLog from '../sent-log.js';

export function createSentPanel(container) {
  const el = document.createElement('div');
  el.className = 'sent-panel';
  el.innerHTML = `
    <div class="sent-panel__header">Sent Captions</div>
    <ul class="sent-list" id="sent-list"></ul>
  `;

  const list = el.querySelector('#sent-list');

  function formatTime(isoString) {
    try {
      return new Date(isoString).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      });
    } catch {
      return '—';
    }
  }

  function render() {
    const entries = sentLog.getAll();

    if (entries.length === 0) {
      list.innerHTML = '<li class="sent-panel__empty">No captions sent yet</li>';
      return;
    }

    list.innerHTML = '';
    const visible = entries.slice(0, 500);
    visible.forEach((entry, i) => {
      // Batch grouping: entries with the same requestId as the previous entry
      // are continuations — they show no seq or ticks (those appear on the first/top item only)
      const prevEntry = i > 0 ? visible[i - 1] : null;
      const isBatchContinuation = prevEntry && entry.requestId && entry.requestId === prevEntry.requestId;

      const li = document.createElement('li');

      if (isBatchContinuation) {
        li.className = `sent-item sent-item--continuation${entry.pending ? ' sent-item--pending' : entry.error ? ' sent-item--error' : ''}`;
        li.innerHTML = `
          <span class="sent-item__seq"></span>
          <span class="sent-item__ticks"></span>
          <span class="sent-item__time">${formatTime(entry.timestamp)}</span>
          <span class="sent-item__text" title="${entry.text.replace(/"/g, '&quot;')}">${entry.text}</span>
        `;
      } else {
        const seqLabel = entry.pending ? '?' : entry.error ? '✕' : `#${entry.sequence}`;
        const ticksLabel = entry.pending ? '✓' : entry.error ? '✗' : '✓✓';
        const ticksClass = entry.pending ? 'sent-item__ticks--pending'
          : entry.error ? 'sent-item__ticks--error'
          : 'sent-item__ticks--confirmed';

        li.className = `sent-item${entry.pending ? ' sent-item--pending' : entry.error ? ' sent-item--error' : ''}`;
        li.innerHTML = `
          <span class="sent-item__seq">${seqLabel}</span>
          <span class="sent-item__ticks ${ticksClass}">${ticksLabel}</span>
          <span class="sent-item__time">${formatTime(entry.timestamp)}</span>
          <span class="sent-item__text" title="${entry.text.replace(/"/g, '&quot;')}">${entry.text}</span>
        `;
      }

      list.appendChild(li);
    });

    list.scrollTop = 0;
  }

  window.addEventListener('lcyt:sent-updated', render);

  container.appendChild(el);
  render();

  return { element: el };
}
