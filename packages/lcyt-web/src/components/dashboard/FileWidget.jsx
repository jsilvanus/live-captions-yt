import { useState, useEffect, useRef } from 'react';
import { useFileContext } from '../../contexts/FileContext';
import { useSessionContext } from '../../contexts/SessionContext';

function getStoredFileId(widgetId) {
  try { return localStorage.getItem(`lcyt.dashboard.file.${widgetId}`) || null; } catch { return null; }
}
function setStoredFileId(widgetId, fileId) {
  try {
    if (fileId) localStorage.setItem(`lcyt.dashboard.file.${widgetId}`, fileId);
    else localStorage.removeItem(`lcyt.dashboard.file.${widgetId}`);
  } catch {}
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const CODE_LABEL_MAP = {
  lang: 'lang', section: 'section', speaker: 'speaker',
  lyrics: 'lyrics', 'no-translate': 'no-tr',
};

function MetacodeBadges({ codes }) {
  if (!codes) return null;
  const badges = [];
  for (const [key, val] of Object.entries(codes)) {
    if (key === 'emptySend' || key === 'emptySendLabel') continue;
    const label = CODE_LABEL_MAP[key] ?? key;
    const text = val === true ? label : `${label}:${val}`;
    badges.push(
      <span key={key} className="db-file-line__code-badge">{text}</span>
    );
  }
  return badges.length > 0 ? <span className="db-file-line__codes">{badges}</span> : null;
}

export function FileWidget({ id, size }) {
  const { files, setPointer, advancePointer } = useFileContext();
  const { connected, send } = useSessionContext();
  const [selectedId, setSelectedId] = useState(() => getStoredFileId(id));
  const [sending, setSending] = useState(false);
  const [showCodes, setShowCodes] = useState(false);
  const listRef = useRef(null);

  // Resolve the active file: prefer selected, fall back to first
  const active = (selectedId && files.find(f => f.id === selectedId))
    || files[0]
    || null;

  // Keep localStorage in sync
  useEffect(() => {
    setStoredFileId(id, active?.id ?? null);
  }, [id, active?.id]);

  // Scroll active line into view (large view)
  useEffect(() => {
    if (!listRef.current) return;
    const activeEl = listRef.current.querySelector('.db-file-line--current');
    if (activeEl) {
      const elRect = activeEl.getBoundingClientRect();
      const containerRect = listRef.current.getBoundingClientRect();
      const isVisible = elRect.top >= containerRect.top && elRect.bottom <= containerRect.bottom;
      if (!isVisible) activeEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  });

  function handleSelectChange(e) {
    const fid = e.target.value;
    setSelectedId(fid);
    setStoredFileId(id, fid);
  }

  async function handleLineSend(line) {
    if (!connected || sending || !line.trim()) return;
    setSending(true);
    try { await send(line.trim()); } catch {}
    setSending(false);
  }

  if (!active) {
    return <div className="db-widget db-empty-note">No file loaded. Load a file from the Captions page.</div>;
  }

  const pointer = active.pointer ?? 0;
  const lines = active.lines ?? [];
  const lineCodes = active.lineCodes;
  const lineNumbers = active.lineNumbers;

  if (size === 'small') {
    const current = lines[pointer] ?? '';
    const prev = lines[pointer - 1] ?? '';
    const next = lines[pointer + 1] ?? '';
    const isHeading = current.startsWith('#');
    const codes = lineCodes?.[pointer];
    const isEmptySend = !!codes?.emptySend;
    return (
      <div className="db-widget db-widget--file-sm">
        {files.length > 1 && (
          <select className="db-file-select" value={active.id} onChange={handleSelectChange}>
            {files.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        )}
        {files.length <= 1 && <div className="db-file-name">{active.name}</div>}
        <div className="db-file-lines">
          {prev && <div className="db-file-line db-file-line--prev">{prev}</div>}
          <div
            className={`db-file-line db-file-line--current${isHeading ? ' db-file-line--heading' : ''}${isEmptySend ? ' db-file-line--empty-send' : ''}`}
            onDoubleClick={!isHeading && !isEmptySend ? () => handleLineSend(current) : undefined}
            title={!isHeading && !isEmptySend ? 'Double-click to send' : undefined}
          >
            ▶ {isEmptySend ? <span className="db-file-line__empty-label">⊘ send codes</span> : current}
          </div>
          {next && <div className="db-file-line db-file-line--next">{next}</div>}
        </div>
      </div>
    );
  }

  return (
    <div className="db-widget">
      <div className="db-file-header">
        {files.length > 1 ? (
          <select className="db-file-select" value={active.id} onChange={handleSelectChange}>
            {files.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        ) : (
          <div className="db-file-name">{active.name}</div>
        )}
        <span className="db-widget__muted" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
          L{pointer + 1}/{lines.length}
        </span>
        <label className="db-file-codes-toggle" title="Show metacodes">
          <input
            type="checkbox"
            checked={showCodes}
            onChange={e => setShowCodes(e.target.checked)}
            style={{ marginRight: 3 }}
          />
          <span style={{ fontSize: 10, whiteSpace: 'nowrap' }}>codes</span>
        </label>
        <button
          className="btn btn--ghost btn--xs"
          onClick={() => listRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
          title="Scroll to beginning"
          style={{ fontSize: 11, padding: '1px 5px' }}
        >
          ⇈
        </button>
      </div>
      <div className="db-file-lines db-file-lines--scroll" ref={listRef}>
        {lines.map((line, index) => {
          const isCurrent = index === pointer;
          const codes = lineCodes?.[index];
          const isEmptySend = !!codes?.emptySend;
          const isHeading = line.startsWith('#');
          const lineNum = lineNumbers?.[index] ?? (index + 1);
          const cls = [
            'db-file-line',
            isCurrent ? 'db-file-line--current' : '',
            isHeading ? 'db-file-line--heading' : '',
            isEmptySend ? 'db-file-line--empty-send' : '',
          ].filter(Boolean).join(' ');
          const displayText = isHeading ? line.replace(/^#+\s*/, '') : line;
          return (
            <div
              key={index}
              className={cls}
              onClick={() => setPointer(active.id, index)}
              onDoubleClick={!isHeading && !isEmptySend ? () => handleLineSend(line) : undefined}
              title={!isHeading && !isEmptySend ? 'Double-click to send' : undefined}
            >
              <span className="db-file-line__linenum">{lineNum}</span>
              <span className="db-file-line__gutter">{isCurrent ? '►' : ''}</span>
              {isEmptySend
                ? <span className="db-file-line__empty-label">{codes?.emptySendLabel ?? '⊘ send codes'}</span>
                : <span
                    className="db-file-line__text"
                    dangerouslySetInnerHTML={{ __html: escapeHtml(displayText) }}
                  />
              }
              {showCodes && <MetacodeBadges codes={codes} />}
            </div>
          );
        })}
      </div>
      <div className="db-row" style={{ marginTop: 8, gap: 6 }}>
        <button
          className="btn btn--secondary btn--sm"
          onClick={() => setPointer(active.id, pointer - 1)}
          disabled={pointer <= 0}
          title="Previous line"
        >
          ▲
        </button>
        <button
          className="btn btn--secondary btn--sm"
          onClick={() => advancePointer(active.id)}
          disabled={pointer >= lines.length - 1}
          title="Next line"
          style={{ flex: 1 }}
        >
          ↓ Advance
        </button>
      </div>
    </div>
  );
}

