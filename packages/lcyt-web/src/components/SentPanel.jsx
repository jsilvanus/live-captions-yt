import { useState } from 'react';
import { useSentLogContext } from '../contexts/SentLogContext';
import { formatTime } from '../lib/formatting';

function getGlobeTitle(entry) {
  const others = Object.entries(entry.otherTranslations || {});
  if (others.length === 0) return 'Sent with translations';
  return others.map(([lang, t]) => `${lang}: ${t}`).join('\n');
}

function SentItemText({ entry }) {
  if (entry.captionTranslationText) {
    return (
      <span className="sent-item__text-block">
        <span className="sent-item__text sent-item__text--translation" title={entry.captionTranslationText}>
          {entry.captionTranslationText}
        </span>
        <span
          className={`sent-item__text sent-item__text--original${entry.showOriginal ? '' : ' sent-item__text--original-small'}`}
          title={entry.text}
        >
          {entry.text}
        </span>
      </span>
    );
  }
  return <span className="sent-item__text" title={entry.text}>{entry.text}</span>;
}

function SentItem({ entry, isBatchContinuation }) {

  if (isBatchContinuation) {
    const cls = `sent-item sent-item--continuation${entry.pending ? ' sent-item--pending' : entry.error ? ' sent-item--error' : ''}`;
    const ticksLabel = entry.pending ? '✓' : entry.error ? '✗' : '✓✓';
    const ticksCls = entry.pending ? 'sent-item__ticks--pending'
      : entry.error ? 'sent-item__ticks--error'
      : 'sent-item__ticks--confirmed';
    return (
      <li className={cls}>
        <span className="sent-item__seq" />
        {entry.hasTranslations && <span className="sent-item__globe" title={getGlobeTitle(entry)}>🌐</span>}
        <span className={`sent-item__ticks ${ticksCls}`}>{ticksLabel}</span>
        <span className="sent-item__time">{formatTime(entry.timestamp)}</span>
        <SentItemText entry={entry} />
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
      {entry.hasTranslations && <span className="sent-item__globe" title={getGlobeTitle(entry)}>🌐</span>}
      <span className={`sent-item__ticks ${ticksCls}`}>{ticksLabel}</span>
      <span className="sent-item__time">{formatTime(entry.timestamp)}</span>
      <SentItemText entry={entry} />
    </li>
  );
}

export function SentPanel() {
  const { entries, clear } = useSentLogContext();
  const [wordWrap, setWordWrap] = useState(() => {
    try { return localStorage.getItem('lcyt:sent-panel-wrap') === '1'; } catch { return false; }
  });

  function toggleWordWrap(e) {
    const v = e.target.checked;
    setWordWrap(v);
    try { localStorage.setItem('lcyt:sent-panel-wrap', v ? '1' : '0'); } catch {}
  }

  const visible = entries.slice(0, 500);

  return (
    <div className="sent-panel">
      <div className="sent-panel__header">
        <span>Sent Captions</span>
        <label className="sent-panel__wrap-toggle">
          <input type="checkbox" checked={wordWrap} onChange={toggleWordWrap} />
          <span>Wrap</span>
        </label>
        <button
          className="sent-panel__clear-btn"
          title="Clear sent captions log"
          onClick={() => { if (entries.length === 0 || confirm('Clear all sent captions from this log?')) clear(); }}
          aria-label="Clear sent log"
        >✕ Clear</button>
      </div>
      <ul className={`sent-list${wordWrap ? ' sent-list--wordwrap' : ''}`}>
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
