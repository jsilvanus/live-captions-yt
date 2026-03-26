/**
 * WizardProgress — segmented progress bar for the wizard.
 *
 * Props:
 *   steps: { id, title }[]
 *   currentIndex: number
 */
export function WizardProgress({ steps, currentIndex }) {
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
        Step {currentIndex + 1} of {steps.length} — {steps[currentIndex]?.title}
      </p>
    </div>
  );
}
