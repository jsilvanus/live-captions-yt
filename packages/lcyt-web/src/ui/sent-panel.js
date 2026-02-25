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

    // Rebuild — entries are already newest-first
    list.innerHTML = '';
    entries.slice(0, 500).forEach(entry => {
      const li = document.createElement('li');
      const seqLabel = entry.pending ? '…' : entry.error ? '✕' : `#${entry.sequence}`;
      li.className = `sent-item${entry.pending ? ' sent-item--pending' : entry.error ? ' sent-item--error' : ''}`;
      li.innerHTML = `
        <span class="sent-item__seq">${seqLabel}</span>
        <span class="sent-item__time">${formatTime(entry.timestamp)}</span>
        <span class="sent-item__text" title="${entry.text.replace(/"/g, '&quot;')}">${entry.text}</span>
      `;
      list.appendChild(li);
    });

    // Scroll to top (newest first is already at top)
    list.scrollTop = 0;
  }

  window.addEventListener('lcyt:sent-updated', render);

  container.appendChild(el);
  render();

  return { element: el };
}
