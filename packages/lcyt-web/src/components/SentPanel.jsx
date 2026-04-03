import { useState, useRef, useEffect, useCallback } from 'react';
import { useSentLogContext } from '../contexts/SentLogContext';
import { formatTime } from '../lib/formatting';

const ITEM_HEIGHT = 28; // px — approximate height of one sent-item row
const VIRTUAL_THRESHOLD = 100; // enable windowing above this many entries
const OVERSCAN = 10; // extra rows to render above/below visible area

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

  // Virtual scrolling state
  const scrollRef = useRef(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [clientHeight, setClientHeight] = useState(400);

  const useVirtual = entries.length > VIRTUAL_THRESHOLD;

  const onScroll = useCallback(() => {
    if (scrollRef.current) {
      setScrollTop(scrollRef.current.scrollTop);
      setClientHeight(scrollRef.current.clientHeight);
    }
  }, []);

  // Update clientHeight on resize
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    setClientHeight(el.clientHeight);
    if (!window.ResizeObserver) return;
    const ro = new ResizeObserver(() => setClientHeight(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Auto-scroll to top when new entries arrive (newest first) and user is near top
  useEffect(() => {
    const el = scrollRef.current;
    if (el && el.scrollTop < 60) el.scrollTop = 0;
  }, [entries.length]);

  function toggleWordWrap(e) {
    const v = e.target.checked;
    setWordWrap(v);
    try { localStorage.setItem('lcyt:sent-panel-wrap', v ? '1' : '0'); } catch {}
  }

  // Compute visible slice for virtual mode
  let visibleEntries;
  let paddingTop = 0;
  let paddingBottom = 0;

  if (useVirtual) {
    const totalHeight = entries.length * ITEM_HEIGHT;
    const startIndex = Math.max(0, Math.floor(scrollTop / ITEM_HEIGHT) - OVERSCAN);
    const visibleCount = Math.ceil(clientHeight / ITEM_HEIGHT) + OVERSCAN * 2;
    const endIndex = Math.min(entries.length, startIndex + visibleCount);

    visibleEntries = entries.slice(startIndex, endIndex);
    paddingTop = startIndex * ITEM_HEIGHT;
    paddingBottom = Math.max(0, totalHeight - endIndex * ITEM_HEIGHT);
  } else {
    visibleEntries = entries;
  }

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
      <ul
        ref={scrollRef}
        className={`sent-list${wordWrap ? ' sent-list--wordwrap' : ''}`}
        onScroll={useVirtual ? onScroll : undefined}
        style={useVirtual ? { overflowY: 'auto', position: 'relative' } : undefined}
        aria-label="Sent captions list"
      >
        {useVirtual && paddingTop > 0 && (
          <li aria-hidden="true" style={{ height: paddingTop, listStyle: 'none' }} />
        )}
        {visibleEntries.length === 0 ? (
          <li className="sent-panel__empty">No captions sent yet</li>
        ) : (
          visibleEntries.map((entry, i) => {
            const globalIdx = useVirtual
              ? Math.max(0, Math.floor(scrollTop / ITEM_HEIGHT) - OVERSCAN) + i
              : i;
            const prev = globalIdx > 0 ? entries[globalIdx - 1] : null;
            const isBatchContinuation = !!(prev && entry.requestId && entry.requestId === prev.requestId);
            return (
              <SentItem key={`${entry.requestId}-${globalIdx}`} entry={entry} isBatchContinuation={isBatchContinuation} />
            );
          })
        )}
        {useVirtual && paddingBottom > 0 && (
          <li aria-hidden="true" style={{ height: paddingBottom, listStyle: 'none' }} />
        )}
      </ul>
    </div>
  );
}
