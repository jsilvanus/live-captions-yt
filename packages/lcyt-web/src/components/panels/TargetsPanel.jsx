import { TargetRow } from './TargetRow.jsx';
import { useLang } from '../../contexts/LangContext.jsx';

/**
 * TargetsPanel — list of caption targets.
 * Data shape: { id, enabled, type, streamKey?, viewerKey?, url?, headers?, format?, iconId?, noBatch? }[]
 *
 * Props:
 *   targets: object[]
 *   onChange: (targets) => void   // called on every change (live save)
 *   backendUrl?: string
 *   icons?: { id, filename }[]
 *   connected?: boolean
 */
export function TargetsPanel({ targets = [], onChange, backendUrl = '', icons = [], connected = false }) {
  const { t } = useLang();

  function updateTarget(id, updated) {
    onChange(targets.map(r => r.id === id ? updated : r));
  }

  function removeTarget(id) {
    onChange(targets.filter(r => r.id !== id));
  }

  function addTarget() {
    onChange([...targets, { id: crypto.randomUUID(), enabled: true, type: 'youtube', streamKey: '' }]);
  }

  return (
    <div className="settings-field">
      {targets.length === 0 && (
        <span className="settings-field__hint">{t('settings.targets.noTargets')}</span>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {targets.map(entry => (
          <TargetRow
            key={entry.id}
            entry={entry}
            onChange={updated => updateTarget(entry.id, updated)}
            onRemove={() => removeTarget(entry.id)}
            backendUrl={backendUrl}
            icons={icons}
          />
        ))}
      </div>
      <button type="button" className="btn btn--secondary btn--sm" onClick={addTarget} style={{ marginTop: 8 }}>
        + {t('settings.targets.addTarget')}
      </button>
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
