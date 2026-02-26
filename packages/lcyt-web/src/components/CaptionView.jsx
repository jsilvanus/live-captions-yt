import { useRef, useEffect } from 'react';
import { useFileContext } from '../contexts/FileContext';

const VIRTUAL_THRESHOLD = 500;
const VIRTUAL_BUFFER = 50;

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function CaptionView({ onLineSend }) {
  const { activeFile, setPointer, lastSentLine, setLastSentLine } = useFileContext();
  const containerRef = useRef(null);

  // Scroll active line into view when pointer changes
  useEffect(() => {
    if (!containerRef.current) return;
    const activeEl = containerRef.current.querySelector('.caption-line--active');
    if (activeEl) {
      const elRect = activeEl.getBoundingClientRect();
      const containerRect = containerRef.current.getBoundingClientRect();
      const isVisible = elRect.top >= containerRect.top && elRect.bottom <= containerRect.bottom;
      if (!isVisible) {
        activeEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    }
  });

  // Clear flash animation after 1500ms
  useEffect(() => {
    if (!lastSentLine) return;
    const timer = setTimeout(() => setLastSentLine(null), 1500);
    return () => clearTimeout(timer);
  }, [lastSentLine, setLastSentLine]);

  if (!activeFile) {
    return (
      <div className="caption-view" ref={containerRef}>
        <ul className="caption-lines">
          <div className="caption-view__empty">No file loaded. Drop a .txt file to begin.</div>
        </ul>
      </div>
    );
  }

  const { lines, pointer, id: fileId } = activeFile;

  if (lines.length === 0) {
    return (
      <div className="caption-view" ref={containerRef}>
        <ul className="caption-lines">
          <div className="caption-view__empty">No caption lines found in this file.</div>
        </ul>
      </div>
    );
  }

  const useVirtual = lines.length > VIRTUAL_THRESHOLD;
  const start = useVirtual ? Math.max(0, pointer - VIRTUAL_BUFFER) : 0;
  const end = useVirtual ? Math.min(lines.length, pointer + VIRTUAL_BUFFER + 1) : lines.length;

  const visibleLines = [];
  for (let i = start; i < end; i++) {
    const isActive = i === pointer;
    const isSent = lastSentLine?.fileId === fileId && lastSentLine?.lineIndex === i;
    const isHeading = lines[i].startsWith('#');

    let cls = 'caption-line';
    if (isActive) cls += ' caption-line--active';
    if (isSent) cls += ' caption-line--sent';
    if (isHeading) cls += ' caption-line--heading';

    const displayText = isHeading
      ? escapeHtml(lines[i].replace(/^#+\s*/, ''))
      : escapeHtml(lines[i]);

    visibleLines.push(
      <li
        key={i}
        className={cls}
        data-index={i}
        onClick={() => setPointer(fileId, i)}
        onDoubleClick={!isHeading ? () => onLineSend?.(lines[i], fileId, i) : undefined}
      >
        <span className="caption-line__gutter">{isActive ? '►' : ''}</span>
        <span
          className="caption-line__text"
          dangerouslySetInnerHTML={{ __html: displayText }}
        />
      </li>
    );
  }

  const atEof = pointer >= lines.length - 1;

  return (
    <div className="caption-view" ref={containerRef} tabIndex={0} style={{ outline: 'none' }}>
      <ul className="caption-lines">
        {visibleLines}
      </ul>
      {atEof && <div className="caption-view__eof">End of file</div>}
    </div>
  );
}
