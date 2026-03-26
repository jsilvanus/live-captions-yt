import { useState } from 'react';

/**
 * RelaySlotRow — accordion row for a single RTMP relay slot.
 *
 * Props:
 *   slot: { slot, active, type, ytKey, genericUrl, genericName, captionMode, scale, fps, videoBitrate, audioBitrate }
 *   onChange: (slot) => void
 *   defaultExpanded?: boolean
 */
export function RelaySlotRow({ slot, onChange, defaultExpanded = false }) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <div style={{
      border: '1px solid var(--color-border)',
      borderRadius: 6,
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 12px',
        background: 'var(--color-surface)',
      }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          <input
            type="checkbox"
            checked={!!slot.active}
            onChange={e => onChange({ ...slot, active: e.target.checked })}
          />
        </label>

        <span style={{ fontWeight: 500, fontSize: 13, color: 'var(--color-text)' }}>
          Slot {slot.slot}
        </span>

        <select
          className="settings-field__input"
          value={slot.type || 'youtube'}
          onChange={e => onChange({ ...slot, type: e.target.value })}
          style={{ width: 'auto', fontSize: 12 }}
        >
          <option value="youtube">YouTube</option>
          <option value="generic">Generic RTMP</option>
        </select>

        {(slot.type || 'youtube') === 'youtube' ? (
          <input
            className="settings-field__input"
            type="password"
            placeholder="xxxx-xxxx-xxxx-xxxx-xxxx"
            autoComplete="off"
            value={slot.ytKey || ''}
            onChange={e => onChange({ ...slot, ytKey: e.target.value })}
            style={{ flex: 1, fontSize: 12 }}
          />
        ) : (
          <input
            className="settings-field__input"
            type="text"
            placeholder="rtmp://…/live/key"
            value={slot.genericUrl || ''}
            onChange={e => onChange({ ...slot, genericUrl: e.target.value })}
            style={{ flex: 1, fontSize: 12 }}
          />
        )}

        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={() => setExpanded(v => !v)}
          title="Advanced options"
          style={{ flexShrink: 0, fontSize: '0.75em' }}
        >⚙</button>
      </div>

      {/* Advanced options */}
      {expanded && (
        <div style={{
          padding: '10px 12px',
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '8px 12px',
          borderTop: '1px solid var(--color-border)',
          background: 'color-mix(in srgb, var(--color-surface) 60%, transparent)',
        }}>
          {(slot.type || 'youtube') === 'generic' && (
            <div style={{ gridColumn: '1 / -1' }}>
              <label className="settings-field__label" style={{ fontSize: '0.8em' }}>Stream name / key (optional)</label>
              <input
                className="settings-field__input"
                type="text"
                value={slot.genericName || ''}
                onChange={e => onChange({ ...slot, genericName: e.target.value })}
                style={{ width: '100%' }}
              />
            </div>
          )}

          <div style={{ gridColumn: '1 / -1' }}>
            <label className="settings-field__label" style={{ fontSize: '0.8em' }}>Caption mode</label>
            <select
              className="settings-field__input"
              value={slot.captionMode || 'http'}
              onChange={e => onChange({ ...slot, captionMode: e.target.value })}
              style={{ width: '100%' }}
            >
              <option value="http">HTTP (default)</option>
              <option value="cea708">CEA-608/708</option>
            </select>
          </div>

          <div>
            <label className="settings-field__label" style={{ fontSize: '0.8em' }}>Scale (e.g. 1280x720)</label>
            <input
              className="settings-field__input"
              type="text"
              placeholder="original"
              value={slot.scale || ''}
              onChange={e => onChange({ ...slot, scale: e.target.value })}
              style={{ width: '100%' }}
            />
          </div>

          <div>
            <label className="settings-field__label" style={{ fontSize: '0.8em' }}>FPS</label>
            <input
              className="settings-field__input"
              type="number"
              placeholder="original"
              min={1}
              max={120}
              value={slot.fps ?? ''}
              onChange={e => onChange({ ...slot, fps: e.target.value ? parseInt(e.target.value, 10) : null })}
              style={{ width: '100%' }}
            />
          </div>

          <div>
            <label className="settings-field__label" style={{ fontSize: '0.8em' }}>Video bitrate (kbps)</label>
            <input
              className="settings-field__input"
              type="text"
              placeholder="original"
              value={slot.videoBitrate || ''}
              onChange={e => onChange({ ...slot, videoBitrate: e.target.value })}
              style={{ width: '100%' }}
            />
          </div>

          <div>
            <label className="settings-field__label" style={{ fontSize: '0.8em' }}>Audio bitrate (kbps)</label>
            <input
              className="settings-field__input"
              type="text"
              placeholder="original"
              value={slot.audioBitrate || ''}
              onChange={e => onChange({ ...slot, audioBitrate: e.target.value })}
              style={{ width: '100%' }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
