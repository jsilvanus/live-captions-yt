import { useSetupT } from '../../lib/useSetupT.js';

/** Localized title of a step descriptor (falls back to its English title). */
export function stepTitle(t, step) {
  return step?.titleKey ? t(step.titleKey) : (step?.title || '');
}

/**
 * WizardProgress — segmented progress bar for the wizard.
 *
 * Props:
 *   steps: { id, title }[]
 *   currentIndex: number
 */
export function WizardProgress({ steps, currentIndex }) {
  const t = useSetupT();
  if (!steps || steps.length === 0) return null;

  return (
    <div>
      <div className="wizard-progress">
        {steps.map((_, i) => (
          <div
            key={i}
            className={`wizard-progress__seg${i <= currentIndex ? ' wizard-progress__seg--done' : ''}`}
          />
        ))}
      </div>
      <p style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: '4px 0 0' }}>
        {t('stepOf', { n: currentIndex + 1, total: steps.length, title: stepTitle(t, steps[currentIndex]) })}
      </p>
    </div>
  );
}
