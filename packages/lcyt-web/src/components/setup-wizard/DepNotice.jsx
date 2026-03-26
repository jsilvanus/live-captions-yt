import { FEATURE_LABELS } from './lib/constants.js';

/**
 * DepNotice — accent banner listing auto-enabled dependency codes.
 *
 * Props:
 *   codes: string[]
 *   onDismiss: () => void
 */
export function DepNotice({ codes, onDismiss }) {
  if (!codes || codes.length === 0) return null;

  const labels = codes.map(c => FEATURE_LABELS[c] || c).join(', ');

  return (
    <div className="wizard-dep-notice">
      <span>Also enabled: <strong>{labels}</strong>. Required by your selections.</span>
      <button
        type="button"
        className="btn btn--ghost btn--sm"
        onClick={onDismiss}
        title="Dismiss"
        style={{ padding: '2px 6px', flexShrink: 0 }}
      >✕</button>
    </div>
  );
}
