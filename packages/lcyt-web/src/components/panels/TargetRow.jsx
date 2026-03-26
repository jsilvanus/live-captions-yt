import { useState } from 'react';

/**
 * TargetRow — single caption target editor.
 *
 * Props:
 *   target: { id, type, streamKey?, viewerKey?, url?, headers?, enabled }
 *   onChange: (target) => void
 *   onRemove: () => void
 */
export function TargetRow({ target, onChange, onRemove }) {
  const [urlError, setUrlError] = useState('');
  const [headersError, setHeadersError] = useState('');

  function validateUrl(val) {
    if (!val) return 'URL is required';
    try {
      const u = new URL(val);
      if (u.protocol !== 'https:' && u.protocol !== 'http:') return 'Must start with http:// or https://';
      return '';
    } catch {
      return 'Invalid URL';
    }
  }

  function validateHeaders(val) {
    if (!val || !val.trim()) return '';
    try { JSON.parse(val); return ''; }
    catch { return 'Must be valid JSON'; }
  }

  const TYPE_LABELS = { youtube: 'YouTube', viewer: 'Viewer', generic: 'Generic HTTP' };

  return (
    <div style={{
      border: '1px solid var(--color-border)',
      borderRadius: 6,
      padding: '10px 12px',
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
      background: 'var(--color-surface)',
    }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          <input
            type="checkbox"
            checked={!!target.enabled}
            onChange={e => onChange({ ...target, enabled: e.target.checked })}
          />
        </label>

        <span style={{
          fontSize: 11,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          color: 'var(--color-text-muted)',
          flexShrink: 0,
          minWidth: 70,
        }}>
          {TYPE_LABELS[target.type] || target.type}
        </span>

        {target.type === 'youtube' && (
          <input
            className="settings-field__input"
            type="password"
            placeholder="xxxx-xxxx-xxxx-xxxx-xxxx"
            autoComplete="off"
            value={target.streamKey || ''}
            onChange={e => onChange({ ...target, streamKey: e.target.value })}
            style={{ flex: 1 }}
          />
        )}

        {target.type === 'viewer' && (
          <input
            className="settings-field__input"
            type="text"
            placeholder="e.g. my-event-2026"
            value={target.viewerKey || ''}
            onChange={e => onChange({ ...target, viewerKey: e.target.value })}
            style={{ flex: 1 }}
          />
        )}

        {target.type === 'generic' && (
          <input
            className="settings-field__input"
            type="text"
            placeholder="https://example.com/captions"
            value={target.url || ''}
            onChange={e => {
              setUrlError(validateUrl(e.target.value));
              onChange({ ...target, url: e.target.value });
            }}
            style={{ flex: 1 }}
          />
        )}

        <button
          type="button"
          className="btn btn--secondary btn--sm"
          onClick={onRemove}
          title="Remove target"
          style={{ flexShrink: 0 }}
        >✕</button>
      </div>

      {target.type === 'generic' && urlError && (
        <span style={{ fontSize: 12, color: 'var(--color-error, #e53)' }}>{urlError}</span>
      )}

      {target.type === 'generic' && (
        <div>
          <label className="settings-field__label" style={{ fontSize: '0.8em' }}>Extra headers (JSON)</label>
          <textarea
            className="settings-field__input"
            rows={2}
            placeholder='{"X-Token": "secret"}'
            value={target.headers || ''}
            onChange={e => {
              setHeadersError(validateHeaders(e.target.value));
              onChange({ ...target, headers: e.target.value });
            }}
            style={{ width: '100%', resize: 'vertical', fontFamily: 'monospace', fontSize: 12 }}
          />
          {headersError && (
            <span style={{ fontSize: 12, color: 'var(--color-error, #e53)' }}>{headersError}</span>
          )}
        </div>
      )}
    </div>
  );
}
