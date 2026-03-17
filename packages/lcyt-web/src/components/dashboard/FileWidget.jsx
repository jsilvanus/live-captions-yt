import { useFileContext } from '../../contexts/FileContext';

export function FileWidget({ size }) {
  const { files, activeId } = useFileContext();
  const active = files.find(f => f.id === activeId) || files[0] || null;

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
        <div className="db-file-name">{active.name}</div>
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
      <div className="db-file-name">
        {active.name}
        <span className="db-widget__muted" style={{ marginLeft: 8, fontWeight: 400 }}>
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
    </div>
  );
}
