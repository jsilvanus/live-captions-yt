import { WizardProgress } from './WizardProgress.jsx';
import { useSetupT } from '../../lib/useSetupT.js';

/**
 * WizardShell — card container with progress bar, title, nav, and error box.
 *
 * Props:
 *   title: string
 *   steps: StepDescriptor[]
 *   stepIndex: number
 *   isConfigStep: boolean      — true = show Skip link
 *   onBack: () => void
 *   onNext: () => void
 *   onSkip: () => void
 *   onFinish: () => void
 *   saving: boolean
 *   saveError: string | null
 *   nextDisabled: boolean
 *   isLastStep: boolean
 *   children: ReactNode
 */
export function WizardShell({
  title,
  steps,
  stepIndex,
  isConfigStep,
  onBack,
  onNext,
  onSkip,
  onFinish,
  saving,
  saveError,
  nextDisabled,
  isLastStep,
  children,
}) {
  const t = useSetupT();
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'center',
      padding: '32px 16px 64px',
      background: 'var(--color-bg)',
    }}>
      <div style={{
        width: '100%',
        maxWidth: 620,
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 12,
        padding: '28px 32px',
        display: 'flex',
        flexDirection: 'column',
        gap: 20,
      }}>
        {/* Progress */}
        <WizardProgress steps={steps} currentIndex={stepIndex} />

        {/* Title */}
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600, color: 'var(--color-text)' }}>
          {title}
        </h2>

        {/* Step content */}
        <div>
          {children}
        </div>

        {/* Error */}
        {saveError && (
          <p style={{ fontSize: 13, color: 'var(--color-error, #e53)', margin: 0 }}>
            {saveError}
          </p>
        )}

        {/* Navigation row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
          <button
            type="button"
            className="btn btn--secondary"
            onClick={onBack}
            disabled={stepIndex === 0 || saving}
          >
            {t('back')}
          </button>

          {isConfigStep && (
            <button
              type="button"
              className="btn btn--ghost"
              onClick={onSkip}
              disabled={saving}
            >
              {t('skip')}
            </button>
          )}

          <span style={{ flex: 1 }} />

          {isLastStep ? (
            <button
              type="button"
              className="btn btn--primary"
              onClick={onFinish}
              disabled={saving}
            >
              {saving ? t('saving') : t('finish')}
            </button>
          ) : (
            <button
              type="button"
              className="btn btn--primary"
              onClick={onNext}
              disabled={nextDisabled || saving}
            >
              {t('next')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
