import { useSentLogContext } from '../../contexts/SentLogContext';

export function SentLogWidget({ size }) {
  const { entries } = useSentLogContext();
  const limit = size === 'small' ? 5 : 15;
  const recent = entries.slice(0, limit);

  if (recent.length === 0) {
    return <div className="db-widget db-empty-note">No captions sent yet.</div>;
  }

  return (
    <div className="db-widget db-widget--sent-log">
      {recent.map(entry => (
        <div key={entry.requestId} className="db-sent-entry">
          <span className="db-sent-entry__status">
            {entry.pending ? '⏳' : entry.error ? '✗' : '✓'}
          </span>
          <span className={`db-sent-entry__text${entry.error ? ' db-sent-entry__text--error' : ''}`}>
            {entry.text}
          </span>
        </div>
      ))}
    </div>
  );
}
