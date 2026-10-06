import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSessionContext } from '../contexts/SessionContext';
import { useProjectRequired } from '../hooks/useProjectRequired';
import { SetupCard } from './setup-hub/SetupCard.jsx';

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
}

function buildTree(items = []) {
  const root = { type: 'dir', name: '', path: '', dirs: new Map(), files: [] };
  for (const item of items) {
    const key = String(item?.key || '').trim();
    if (!key) continue;
    const segments = key.split('/').filter(Boolean);
    let node = root;
    for (let i = 0; i < segments.length; i += 1) {
      const segment = segments[i];
      const atLeaf = i === segments.length - 1;
      const nextPath = node.path ? `${node.path}/${segment}` : segment;
      if (atLeaf) {
        node.files.push({
          type: 'file',
          name: segment,
          path: nextPath,
          size: Number(item?.size ?? 0),
          lastModified: item?.lastModified || null,
        });
      } else {
        if (!node.dirs.has(segment)) {
          node.dirs.set(segment, { type: 'dir', name: segment, path: nextPath, dirs: new Map(), files: [] });
        }
        node = node.dirs.get(segment);
      }
    }
  }
  return root;
}

function TreeNode({ node, depth = 0, expanded, onToggle }) {
  const dirs = [...node.dirs.values()].sort((a, b) => a.name.localeCompare(b.name));
  const files = [...node.files].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div>
      {dirs.map((dir) => {
        const isOpen = expanded.has(dir.path);
        return (
          <div key={dir.path}>
            <button
              type="button"
              onClick={() => onToggle(dir.path)}
              aria-expanded={isOpen}
              style={{
                border: 'none',
                background: 'transparent',
                color: 'var(--color-text)',
                cursor: 'pointer',
                padding: '2px 0',
                marginLeft: depth * 16,
                fontSize: 13,
              }}
            >
              {isOpen ? '▾' : '▸'} 📁 {dir.name}
            </button>
            {isOpen ? <TreeNode node={dir} depth={depth + 1} expanded={expanded} onToggle={onToggle} /> : null}
          </div>
        );
      })}
      {files.map((file) => (
        <div
          key={file.path}
          style={{
            marginLeft: (depth + 1) * 16,
            padding: '2px 0',
            display: 'flex',
            gap: 8,
            alignItems: 'baseline',
            fontSize: 12,
          }}
        >
          <span style={{ color: 'var(--color-text)' }}>📄 {file.name}</span>
          <span style={{ color: 'var(--color-text-muted)' }}>{formatBytes(file.size)}</span>
          <span style={{ color: 'var(--color-text-muted)' }}>{formatDate(file.lastModified)}</span>
        </div>
      ))}
    </div>
  );
}

export function StorageLibraryPage() {
  useProjectRequired();
  const session = useSessionContext();
  const connected = session?.connected;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [library, setLibrary] = useState({ areas: [], totals: { objectCount: 0, totalBytes: 0 }, generatedAt: null, limitPerArea: 0 });
  const [expanded, setExpanded] = useState(new Set());

  const load = useCallback(async () => {
    if (!connected || !session?.listStorageLibrary) {
      setLibrary({ areas: [], totals: { objectCount: 0, totalBytes: 0 }, generatedAt: null, limitPerArea: 0 });
      setError('');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const data = await session.listStorageLibrary({ limit: 2000 });
      const areas = Array.isArray(data?.areas) ? data.areas : [];
      setLibrary({
        areas,
        totals: data?.totals || { objectCount: 0, totalBytes: 0 },
        generatedAt: data?.generatedAt || null,
        limitPerArea: Number(data?.limitPerArea || 0),
      });
      const defaults = new Set();
      for (const area of areas) {
        for (const item of area.items || []) {
          const key = String(item?.key || '');
          const segments = key.split('/').filter(Boolean);
          let path = '';
          for (let i = 0; i < Math.min(segments.length - 1, 2); i += 1) {
            path = path ? `${path}/${segments[i]}` : segments[i];
            defaults.add(path);
          }
        }
      }
      setExpanded(defaults);
    } catch (err) {
      setError(err?.message || 'Failed to load storage library');
    } finally {
      setLoading(false);
    }
  }, [connected, session]);

  useEffect(() => {
    load();
  }, [load]);

  const areaCards = useMemo(() => library.areas.map((area) => ({
    ...area,
    tree: buildTree(area.items || []),
  })), [library.areas]);

  const toggle = useCallback((path) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  return (
    <div className="setup-hub-page">
      <div className="setup-hub-page__header" style={{ alignItems: 'center' }}>
        <h1 className="setup-hub-page__title">Storage Library</h1>
        <button type="button" className="btn btn--ghost btn--sm" onClick={load} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
      <p className="setup-hub-page__desc">
        Files currently present in project storage (caption files, graphics, icons, thumbnails, recordings).
      </p>
      <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 16 }}>
        {library.totals.objectCount} object{library.totals.objectCount === 1 ? '' : 's'} · {formatBytes(library.totals.totalBytes)} · Updated {formatDate(library.generatedAt)}
      </p>
      {error ? <p className="setup-card__empty">{error}</p> : null}
      {!connected ? <p className="setup-card__empty">Connect to a project to view storage library.</p> : null}
      {connected && !loading && areaCards.length === 0 ? <p className="setup-card__empty">No files found.</p> : null}
      {connected && areaCards.length > 0 ? (
        <div className="setup-hub-page__grid">
          {areaCards.map((area) => (
            <SetupCard
              key={area.id}
              id={`library-${area.id}`}
              color="teal"
              title={area.label || area.id}
              description={`${area.objectCount} object${area.objectCount === 1 ? '' : 's'} · ${formatBytes(area.totalBytes)} · ${area.backendType || 'storage'}`}
              status={area.truncated ? 'partial' : 'ready'}
              statusLabel={area.truncated ? `Showing first ${library.limitPerArea}` : 'Complete'}
            >
              {area.items?.length > 0 ? (
                <TreeNode node={area.tree} expanded={expanded} onToggle={toggle} />
              ) : (
                <p className="setup-card__empty">No files in this area.</p>
              )}
            </SetupCard>
          ))}
        </div>
      ) : null}
    </div>
  );
}
