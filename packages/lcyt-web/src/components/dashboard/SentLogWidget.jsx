import { useSentLogContext } from '../../contexts/SentLogContext';
import { formatTime } from '../../lib/formatting';

export function SentLogWidget({ size }) {
  const { entries } = useSentLogContext();
  const limit = size === 'small' ? 5 : 15;
  const recent = entries.slice(0, limit);

  if (recent.length === 0) {
    return <div className="db-widget db-empty-note">No captions sent yet.</div>;
  }

  return (
    <div className="db-widget db-widget--sent-log">
      {recent.map(entry => {
        const seqLabel = entry.pending ? '?' : entry.error ? '✕' : `#${entry.sequence}`;
        const ticksLabel = entry.pending ? '✓' : entry.error ? '✗' : '✓✓';
        const ticksCls = entry.pending ? 'sent-item__ticks--pending'
          : entry.error ? 'sent-item__ticks--error'
          : 'sent-item__ticks--confirmed';
        return (
          <div key={entry.requestId} className={`db-sent-entry${entry.error ? ' db-sent-entry--error' : ''}`}>
            <span className="db-sent-seq">{seqLabel}</span>
            <span className={`db-sent-ticks ${ticksCls}`}>{ticksLabel}</span>
            <span className="db-sent-time">{formatTime(entry.timestamp)}</span>
            <span className={`db-sent-entry__text${entry.error ? ' db-sent-entry__text--error' : ''}`}>
              {entry.text}
            </span>
          </div>
        );
      })}
    </div>
  );
}
