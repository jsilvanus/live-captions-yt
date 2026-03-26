import { FEATURE_LABELS } from './lib/constants.js';
import { ReviewSummary } from '../panels/ReviewSummary.jsx';

/**
 * StepReview — summary view of all selected features and config steps.
 *
 * Props:
 *   steps: StepDescriptor[]
 *   selectedFeatures: Set<string>
 *   localSettings: object
 *   configs: Record<string, object>
 *   onEditStep: (idx: number) => void
 */
export function StepReview({ steps, selectedFeatures, localSettings, configs, onEditStep }) {
  const configSteps = steps.filter(s => s.id !== 'features' && s.id !== 'review');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Feature badges */}
      <div>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 600 }}>Selected features</h3>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {[...selectedFeatures].map(code => (
            <span
              key={code}
              style={{
                fontSize: 12,
                padding: '3px 8px',
                borderRadius: 10,
                background: 'color-mix(in srgb, var(--color-accent) 12%, transparent)',
                color: 'var(--color-accent)',
                border: '1px solid color-mix(in srgb, var(--color-accent) 30%, transparent)',
              }}
            >
              {FEATURE_LABELS[code] || code}
            </span>
          ))}
          {selectedFeatures.size === 0 && (
            <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>None selected</span>
          )}
        </div>
      </div>

      {/* Config step cards */}
      {configSteps.length > 0 && (
        <div>
          <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 600 }}>Configuration</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {configSteps.map((step, configIdx) => {
              const stepIdx = steps.findIndex(s => s.id === step.id);
              return (
                <div
                  key={step.id}
                  style={{
                    border: '1px solid var(--color-border)',
                    borderRadius: 8,
                    padding: '12px 14px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontWeight: 600, fontSize: 13, flex: 1 }}>{step.title}</span>
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() => onEditStep(stepIdx)}
                    >
                      Edit
                    </button>
                  </div>
                  <ReviewSummary
                    step={step}
                    localSettings={localSettings}
                    configs={configs}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
