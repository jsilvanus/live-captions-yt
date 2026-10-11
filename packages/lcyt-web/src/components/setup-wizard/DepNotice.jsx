import { useSetupT } from '../../lib/useSetupT.js';

/**
 * DepNotice — accent banner listing auto-enabled dependency codes.
 *
 * Props:
 *   codes: string[]
 *   onDismiss: () => void
 */
export function DepNotice({ codes, onDismiss }) {
  const t = useSetupT();
  if (!codes || codes.length === 0) return null;

  const labels = codes.map(c => t(`feature.${c}`)).join(', ');

  return (
    <div className="wizard-dep-notice">
      <span>{t('alsoEnabled', { labels })}</span>
      <button
        type="button"
        className="btn btn--ghost btn--sm"
        onClick={onDismiss}
        title={t('dismiss')}
        style={{ padding: '2px 6px', flexShrink: 0 }}
      >✕</button>
    </div>
  );
}
