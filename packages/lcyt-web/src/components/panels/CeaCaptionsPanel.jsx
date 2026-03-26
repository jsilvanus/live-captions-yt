/**
 * CeaCaptionsPanel — CEA-608/708 delay configuration.
 *
 * Props:
 *   config: { delay_ms: number }
 *   onChange: (config) => void
 */
export function CeaCaptionsPanel({ config = {}, onChange }) {
  const delayMs = config.delay_ms ?? 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <label className="settings-field__label">Video delay offset (ms)</label>
        <input
          className="settings-field__input"
          type="number"
          min={0}
          max={30000}
          step={100}
          value={delayMs}
          onChange={e => onChange({ ...config, delay_ms: parseInt(e.target.value, 10) || 0 })}
          style={{ width: 160 }}
        />
        <p className="settings-field__hint" style={{ marginTop: 4 }}>
          Set this to the downstream encoder latency so CEA-608/708 timestamps align with the delayed video.
        </p>
      </div>
    </div>
  );
}
