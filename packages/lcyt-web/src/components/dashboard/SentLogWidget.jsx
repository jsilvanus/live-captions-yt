import { useSentLogContext } from '../../contexts/SentLogContext';
import { formatTime } from '../../lib/formatting';

function getGlobeTitle(entry) {
  const others = Object.entries(entry.otherTranslations || {});
  if (others.length === 0) return 'Sent with translations';
  return others.map(([lang, t]) => `${lang}: ${t}`).join('\n');
}

function SentItemText({ entry }) {
  if (entry.captionTranslationText) {
    return (
      <span className="db-sent-entry__text-block">
        <span className="db-sent-entry__text db-sent-entry__text--translation" title={entry.captionTranslationText}>
          {entry.captionTranslationText}
        </span>
        <span
          className={`db-sent-entry__text db-sent-entry__text--original${entry.showOriginal ? '' : ' db-sent-entry__text--original-small'}`}
          title={entry.text}
        >
          {entry.text}
        </span>
      </span>
    );
  }
  return <span className={`db-sent-entry__text${entry.error ? ' db-sent-entry__text--error' : ''}`} title={entry.text}>{entry.text}</span>;
}

export function SentLogWidget({ size }) {
  const { entries, clear } = useSentLogContext();
  const limit = size === 'small' ? 5 : 50;
  const recent = entries.slice(0, limit);

  if (recent.length === 0) {
    return <div className="db-widget db-empty-note">No captions sent yet.</div>;
  }

  return (
    <div className="db-widget db-widget--sent-log">
      <div className="db-sent-log__toolbar">
        <button
          className="btn btn--ghost btn--xs"
          onClick={() => { if (entries.length === 0 || confirm('Clear all sent captions from this log?')) clear(); }}
          title="Clear sent log"
        >✕ Clear</button>
      </div>
      <ul className="db-sent-list">
        {recent.map((entry, i) => {
          const prev = i > 0 ? recent[i - 1] : null;
          const isBatchContinuation = !!(prev && entry.requestId && entry.requestId === prev.requestId);
          const seqLabel = entry.pending ? '?' : entry.error ? '✕' : `#${entry.sequence}`;
          const ticksLabel = entry.pending ? '✓' : entry.error ? '✗' : '✓✓';
          const ticksCls = entry.pending ? 'sent-item__ticks--pending'
            : entry.error ? 'sent-item__ticks--error'
            : 'sent-item__ticks--confirmed';
          const cls = `db-sent-entry${entry.error ? ' db-sent-entry--error' : ''}${isBatchContinuation ? ' db-sent-entry--continuation' : ''}`;
          return (
            <li key={`${entry.requestId}-${i}`} className={cls}>
              {!isBatchContinuation && <span className="db-sent-seq">{seqLabel}</span>}
              {isBatchContinuation && <span className="db-sent-seq" />}
              {entry.hasTranslations && <span className="db-sent-globe" title={getGlobeTitle(entry)}>🌐</span>}
              <span className={`db-sent-ticks ${ticksCls}`}>{ticksLabel}</span>
              <span className="db-sent-time">{formatTime(entry.timestamp)}</span>
              <SentItemText entry={entry} />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
