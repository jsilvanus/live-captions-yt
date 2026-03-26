import { TargetRow } from './TargetRow.jsx';

/**
 * TargetsPanel — list of caption targets with add/remove controls.
 *
 * Props:
 *   targets: object[]
 *   onChange: (targets) => void
 */
export function TargetsPanel({ targets = [], onChange }) {
  function updateTarget(index, updated) {
    const next = targets.map((t, i) => i === index ? updated : t);
    onChange(next);
  }

  function removeTarget(index) {
    onChange(targets.filter((_, i) => i !== index));
  }

  function addTarget(type) {
    const next = [...targets, {
      id: crypto.randomUUID(),
      type,
      enabled: true,
      ...(type === 'youtube' ? { streamKey: '' } :
          type === 'viewer'  ? { viewerKey: '' } :
                               { url: '', headers: '' }),
    }];
    onChange(next);
  }

  const noValidTarget = !targets.some(t => {
    if (!t.enabled) return false;
    if (t.type === 'youtube') return !!(t.streamKey || '').trim();
    if (t.type === 'viewer')  return !!(t.viewerKey || '').trim();
    if (t.type === 'generic') return !!(t.url || '').trim();
    return false;
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {targets.length === 0 && (
        <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: 0 }}>
          No targets yet. Add one below.
        </p>
      )}

      {targets.map((target, i) => (
        <TargetRow
          key={target.id}
          target={target}
          onChange={updated => updateTarget(i, updated)}
          onRemove={() => removeTarget(i)}
        />
      ))}

      {targets.length > 0 && noValidTarget && (
        <p style={{ fontSize: 12, color: 'var(--color-error, #e53)', margin: 0 }}>
          At least one enabled target needs a key or URL filled in.
        </p>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
        <button type="button" className="btn btn--secondary btn--sm" onClick={() => addTarget('youtube')}>
          + YouTube
        </button>
        <button type="button" className="btn btn--secondary btn--sm" onClick={() => addTarget('viewer')}>
          + Viewer
        </button>
        <button type="button" className="btn btn--secondary btn--sm" onClick={() => addTarget('generic')}>
          + Generic
        </button>
      </div>
    </div>
  );
}

/**
 * Returns true when at least one enabled target has a valid key/URL.
 */
export function targetsHasValid(targets) {
  return (targets || []).some(t => {
    if (!t.enabled) return false;
    if (t.type === 'youtube') return !!(t.streamKey || '').trim();
    if (t.type === 'viewer')  return !!(t.viewerKey || '').trim();
    if (t.type === 'generic') return !!(t.url || '').trim();
    return false;
  });
}
