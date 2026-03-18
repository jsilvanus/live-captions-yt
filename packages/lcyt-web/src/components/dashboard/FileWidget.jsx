import { useState, useEffect } from 'react';
import { useFileContext } from '../../contexts/FileContext';

function getStoredFileId(widgetId) {
  try { return localStorage.getItem(`lcyt.dashboard.file.${widgetId}`) || null; } catch { return null; }
}
function setStoredFileId(widgetId, fileId) {
  try {
    if (fileId) localStorage.setItem(`lcyt.dashboard.file.${widgetId}`, fileId);
    else localStorage.removeItem(`lcyt.dashboard.file.${widgetId}`);
  } catch {}
}

export function FileWidget({ id, size }) {
  const { files, setPointer, advancePointer } = useFileContext();
  const [selectedId, setSelectedId] = useState(() => getStoredFileId(id));

  // Resolve the active file: prefer selected, fall back to first
  const active = (selectedId && files.find(f => f.id === selectedId))
    || files[0]
    || null;

  // Keep localStorage in sync
  useEffect(() => {
    setStoredFileId(id, active?.id ?? null);
  }, [id, active?.id]);

  function handleSelectChange(e) {
    const fid = e.target.value;
    setSelectedId(fid);
    setStoredFileId(id, fid);
  }

  if (!active) {
    return <div className="db-widget db-empty-note">No file loaded. Load a file from the Captions page.</div>;
  }

  const pointer = active.pointer ?? 0;
  const lines = active.lines ?? [];

  if (size === 'small') {
    const current = lines[pointer] ?? '';
    const prev = lines[pointer - 1] ?? '';
    const next = lines[pointer + 1] ?? '';
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
          <div className="db-file-line db-file-line--current">▶ {current}</div>
          {next && <div className="db-file-line db-file-line--next">{next}</div>}
        </div>
      </div>
    );
  }

  const start = Math.max(0, pointer - 3);
  const end = Math.min(lines.length, pointer + 4);
  const visibleLines = lines.slice(start, end).map((line, i) => ({
    line,
    index: start + i,
    isCurrent: start + i === pointer,
  }));

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
      </div>
      <div className="db-file-lines">
        {visibleLines.map(({ line, index, isCurrent }) => (
          <div
            key={index}
            className={`db-file-line${isCurrent ? ' db-file-line--current' : ''}`}
          >
            {isCurrent ? '▶ ' : '   '}{line || <span className="db-widget__muted">(empty)</span>}
          </div>
        ))}
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
