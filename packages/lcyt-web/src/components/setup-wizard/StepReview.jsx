import { FEATURE_LABELS } from './lib/constants.js';
import { ReviewSummary } from '../panels/ReviewSummary.jsx';
import { resolveIntent, describeFlow } from './lib/capabilities.js';
import { PREREQUISITE_TEXT, PREREQUISITE_GROUPS } from './lib/wizardText.js';

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
export function StepReview({ steps, selectedFeatures, intents, answers, localSettings, configs, onEditStep }) {
  const configSteps = steps.filter(s => !['intent', 'questions', 'features', 'review'].includes(s.id));
  const hasIntents = !!intents && intents.size > 0;
  const prerequisites = hasIntents ? resolveIntent(intents, answers || {}).prerequisites : [];
  const flow = describeFlow(selectedFeatures);

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

      {/* Production flow */}
      {hasIntents && flow.length > 0 && (
        <div data-testid="review-flow">
          <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 600 }}>Your production flow</h3>
          <ol style={{ margin: 0, paddingLeft: 20, fontSize: 13, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {flow.map(line => <li key={line}>{line}</li>)}
          </ol>
        </div>
      )}

      {/* What turning features on does not do: prerequisites */}
      {prerequisites.length > 0 && (
        <div data-testid="review-prerequisites">
          <h3 style={{ margin: '0 0 6px', fontSize: 14, fontWeight: 600 }}>What else you need</h3>
          <p style={{ margin: '0 0 10px', fontSize: 12, color: 'var(--color-text-muted)' }}>
            Enabling a feature does not set up the equipment or accounts behind it.
          </p>
          {PREREQUISITE_GROUPS.map(g => {
            const items = prerequisites.filter(p => p.kind === g.kind);
            if (items.length === 0) return null;
            return (
              <div key={g.kind} style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 600 }}>{g.title}</div>
                <ul style={{ margin: '4px 0 0', paddingLeft: 20, fontSize: 13 }}>
                  {items.map(p => (
                    <li key={p.id}>
                      {PREREQUISITE_TEXT[p.id] || p.id}{' '}
                      <a href={p.link}>Open</a>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}

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
