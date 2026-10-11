import { INTENTS } from './lib/capabilities.js';
import { useSetupT } from '../../lib/useSetupT.js';

/**
 * IntentStep — "What are you producing?" Multi-select cards.
 *
 * Props:
 *   intents: Set<string>
 *   onChange: (Set<string>) => void
 */
export function IntentStep({ intents, onChange }) {
  const t = useSetupT();
  function toggle(id) {
    const next = new Set(intents);
    if (next.has(id)) next.delete(id); else next.add(id);
    onChange(next);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)' }}>
        {t('intentHint')}
      </p>
      {INTENTS.map(id => {
        const on = intents.has(id);
        return (
          <button
            key={id}
            type="button"
            role="checkbox"
            aria-checked={on}
            data-testid={`intent-${id}`}
            onClick={() => toggle(id)}
            style={{
              textAlign: 'left',
              padding: '12px 14px',
              borderRadius: 8,
              cursor: 'pointer',
              color: 'var(--color-text)',
              background: on ? 'color-mix(in srgb, var(--color-accent) 12%, transparent)' : 'transparent',
              border: `1px solid ${on ? 'var(--color-accent)' : 'var(--color-border)'}`,
            }}
          >
            <div style={{ fontWeight: 600, fontSize: 14 }}>{on ? '✓ ' : ''}{t(`intent.${id}.title`)}</div>
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>{t(`intent.${id}.desc`)}</div>
          </button>
        );
      })}
    </div>
  );
}
