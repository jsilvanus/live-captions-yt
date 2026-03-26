import { useState } from 'react';
import { useLang } from '../../contexts/LangContext.jsx';

/**
 * RelaySlotRow — single RTMP relay slot editor.
 * Data shape: { slot, targetType, youtubeKey, genericUrl, genericName, captionMode, scale, fps, videoBitrate, audioBitrate }
 *
 * Props:
 *   entry: object
 *   onChange: (updated) => void
 *   onRemove: () => void
 *   runningSlots?: number[]
 */
export function RelaySlotRow({ entry, onChange, onRemove, runningSlots = [] }) {
  const { t } = useLang();
  const [showAdvanced, setShowAdvanced] = useState(
    Boolean(entry.scale || entry.fps != null || entry.videoBitrate || entry.audioBitrate || entry.captionMode === 'cea708')
  );
  const isRunning = runningSlots.includes(entry.slot);

  return (
    <div style={{ border: '1px solid var(--color-border)', borderRadius: 4, padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
      {/* Main row */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <label className="settings-checkbox" style={{ marginBottom: 0 }}>
          <input
            type="checkbox"
            checked={!!entry.active}
            onChange={e => onChange({ ...entry, active: e.target.checked })}
          />
        </label>
        <select
          className="settings-field__input"
          value={entry.targetType}
          onChange={e => onChange({ ...entry, targetType: e.target.value })}
          style={{ width: 'auto' }}
        >
          <option value="youtube">YouTube</option>
          <option value="generic">{t('settings.relay.generic')}</option>
        </select>
        {entry.targetType === 'youtube' ? (
          <input
            className="settings-field__input"
            type="password"
            placeholder="xxxx-xxxx-xxxx-xxxx-xxxx"
            autoComplete="off"
            value={entry.youtubeKey || ''}
            onChange={e => onChange({ ...entry, youtubeKey: e.target.value })}
            style={{ flex: 1 }}
          />
        ) : (
          <input
            className="settings-field__input"
            type="text"
            placeholder={t('settings.relay.rtmpFullPathPlaceholder')}
            autoComplete="off"
            value={entry.genericUrl || ''}
            onChange={e => onChange({ ...entry, genericUrl: e.target.value })}
            style={{ flex: 1 }}
          />
        )}
        <button
          type="button"
          className="btn btn--secondary btn--sm"
          onClick={() => setShowAdvanced(v => !v)}
          title={t('settings.relay.slotAdvanced')}
          style={{ flexShrink: 0, fontSize: '0.75em' }}
        >⚙</button>
        <button
          type="button"
          className="btn btn--secondary btn--sm"
          onClick={onRemove}
          title={t('settings.relay.removeRelay')}
          style={{ flexShrink: 0 }}
        >✕</button>
      </div>

      {/* URL hint */}
      {entry.targetType === 'youtube' && (entry.youtubeKey || '').trim() && (
        <span className="settings-field__hint">
          → rtmp://a.rtmp.youtube.com/live2/{(entry.youtubeKey || '').trim()}
        </span>
      )}

      {/* Running badge */}
      {isRunning && (
        <span style={{ fontSize: 11, color: '#e44', fontWeight: 600 }}>🔴 {t('settings.relay.live')}</span>
      )}

      {/* Advanced options */}
      {showAdvanced && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 10px', borderTop: '1px solid var(--color-border)', paddingTop: 6, marginTop: 2 }}>
          {/* Caption mode */}
          <div style={{ gridColumn: '1 / -1' }}>
            <label className="settings-field__label" style={{ fontSize: '0.8em', marginBottom: 2 }}>{t('settings.relay.slotCaptionMode')}</label>
            <select
              className="settings-field__input"
              value={entry.captionMode || 'http'}
              onChange={e => onChange({ ...entry, captionMode: e.target.value })}
              style={{ width: '100%' }}
            >
              <option value="http">{t('settings.relay.slotCaptionModeHttp')}</option>
              <option value="cea708">{t('settings.relay.slotCaptionModeCea708')}</option>
            </select>
          </div>
          {/* Scale */}
          <div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.8em', marginBottom: 2 }}>
              <input
                type="checkbox"
                checked={!entry.scale}
                onChange={e => { if (e.target.checked) onChange({ ...entry, scale: '' }); }}
              />
              {t('settings.relay.useOriginal')} — {t('settings.relay.slotScale')}
            </label>
            <input
              className="settings-field__input"
              type="text"
              placeholder={t('settings.relay.slotScalePlaceholder')}
              value={entry.scale || ''}
              onChange={e => onChange({ ...entry, scale: e.target.value })}
              style={!entry.scale ? { opacity: 0.55 } : {}}
            />
          </div>
          {/* FPS */}
          <div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.8em', marginBottom: 2 }}>
              <input
                type="checkbox"
                checked={entry.fps == null}
                onChange={e => { if (e.target.checked) onChange({ ...entry, fps: null }); }}
              />
              {t('settings.relay.useOriginal')} — {t('settings.relay.slotFps')}
            </label>
            <input
              className="settings-field__input"
              type="number"
              min="1" max="120"
              placeholder={t('settings.relay.slotFpsPlaceholder')}
              value={entry.fps ?? ''}
              onChange={e => { const v = parseInt(e.target.value, 10); onChange({ ...entry, fps: Number.isFinite(v) ? v : null }); }}
              style={entry.fps == null ? { opacity: 0.55 } : {}}
            />
          </div>
          {/* Video bitrate */}
          <div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.8em', marginBottom: 2 }}>
              <input
                type="checkbox"
                checked={!entry.videoBitrate}
                onChange={e => { if (e.target.checked) onChange({ ...entry, videoBitrate: '' }); }}
              />
              {t('settings.relay.useOriginal')} — {t('settings.relay.slotVideoBitrate')}
            </label>
            <input
              className="settings-field__input"
              type="text"
              placeholder={t('settings.relay.slotVideoBitratePlaceholder')}
              value={entry.videoBitrate || ''}
              onChange={e => onChange({ ...entry, videoBitrate: e.target.value })}
              style={!entry.videoBitrate ? { opacity: 0.55 } : {}}
            />
          </div>
          {/* Audio bitrate */}
          <div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.8em', marginBottom: 2 }}>
              <input
                type="checkbox"
                checked={!entry.audioBitrate}
                onChange={e => { if (e.target.checked) onChange({ ...entry, audioBitrate: '' }); }}
              />
              {t('settings.relay.useOriginal')} — {t('settings.relay.slotAudioBitrate')}
            </label>
            <input
              className="settings-field__input"
              type="text"
              placeholder={t('settings.relay.slotAudioBitratePlaceholder')}
              value={entry.audioBitrate || ''}
              onChange={e => onChange({ ...entry, audioBitrate: e.target.value })}
              style={!entry.audioBitrate ? { opacity: 0.55 } : {}}
            />
          </div>
        </div>
      )}
    </div>
  );
}
