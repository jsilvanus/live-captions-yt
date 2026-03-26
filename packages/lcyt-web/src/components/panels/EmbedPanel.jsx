/**
 * EmbedPanel — embed widget CORS origin configuration.
 *
 * Props:
 *   config: { cors: string }
 *   onChange: (config) => void
 */
export function EmbedPanel({ config = {}, onChange }) {
  const corsVal = config.cors ?? '*';

  // Display newline-separated; store comma-separated internally
  const displayVal = corsVal.split(',').map(s => s.trim()).join('\n');

  function handleChange(text) {
    const normalized = text
      .split('\n')
      .map(s => s.trim())
      .filter(Boolean)
      .join(',');
    onChange({ ...config, cors: normalized || '*' });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <label className="settings-field__label">Allowed origins (one per line)</label>
        <textarea
          className="settings-field__input"
          rows={4}
          value={displayVal}
          onChange={e => handleChange(e.target.value)}
          placeholder="*"
          style={{ width: '100%', resize: 'vertical', fontFamily: 'monospace', fontSize: 13 }}
        />
        <p className="settings-field__hint" style={{ marginTop: 4 }}>
          Use <code>*</code> to allow all origins. For production use, specify your domain(s).
        </p>
      </div>
    </div>
  );
}
