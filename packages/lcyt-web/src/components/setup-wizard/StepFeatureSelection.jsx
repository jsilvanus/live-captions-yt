import { DepNotice } from './DepNotice.jsx';
import { FeaturePicker } from '../FeaturePicker.jsx';

/**
 * StepFeatureSelection — feature toggle grid with dependency notices.
 *
 * Props:
 *   value: Set<string>
 *   onChange: (Set<string>) => void
 *   depNotices: string[]
 *   onDismissNotices: () => void
 */
export function StepFeatureSelection({ value, onChange, depNotices, onDismissNotices }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <DepNotice codes={depNotices} onDismiss={onDismissNotices} />
      <FeaturePicker value={value} onChange={onChange} />
    </div>
  );
}
