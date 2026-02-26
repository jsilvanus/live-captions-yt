import { useSentLogContext } from '../contexts/SentLogContext';

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

function SentItem({ entry, isBatchContinuation }) {
  const escapedText = entry.text.replace(/"/g, '&quot;');

  if (isBatchContinuation) {
    const cls = `sent-item sent-item--continuation${entry.pending ? ' sent-item--pending' : entry.error ? ' sent-item--error' : ''}`;
    return (
      <li className={cls}>
        <span className="sent-item__seq" />
        <span className="sent-item__ticks" />
        <span className="sent-item__time">{formatTime(entry.timestamp)}</span>
        <span className="sent-item__text" title={entry.text}>{entry.text}</span>
      </li>
    );
  }

  const seqLabel = entry.pending ? '?' : entry.error ? '✕' : `#${entry.sequence}`;
  const ticksLabel = entry.pending ? '✓' : entry.error ? '✗' : '✓✓';
  const ticksCls = entry.pending ? 'sent-item__ticks--pending'
    : entry.error ? 'sent-item__ticks--error'
    : 'sent-item__ticks--confirmed';
  const cls = `sent-item${entry.pending ? ' sent-item--pending' : entry.error ? ' sent-item--error' : ''}`;

  return (
    <li className={cls}>
      <span className="sent-item__seq">{seqLabel}</span>
      <span className={`sent-item__ticks ${ticksCls}`}>{ticksLabel}</span>
      <span className="sent-item__time">{formatTime(entry.timestamp)}</span>
      <span className="sent-item__text" title={entry.text}>{entry.text}</span>
    </li>
  );
}

export function SentPanel() {
  const { entries } = useSentLogContext();
  const visible = entries.slice(0, 500);

  return (
    <div className="sent-panel">
      <div className="sent-panel__header">Sent Captions</div>
      <ul className="sent-list">
        {visible.length === 0 ? (
          <li className="sent-panel__empty">No captions sent yet</li>
        ) : (
          visible.map((entry, i) => {
            const prev = i > 0 ? visible[i - 1] : null;
            const isBatchContinuation = !!(prev && entry.requestId && entry.requestId === prev.requestId);
            return (
              <SentItem key={`${entry.requestId}-${i}`} entry={entry} isBatchContinuation={isBatchContinuation} />
            );
          })
        )}
      </ul>
    </div>
  );
}
