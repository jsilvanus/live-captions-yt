import { useState, useMemo } from 'react';
import { useLang } from '../contexts/LangContext';
import { useEscapeKey } from '../hooks/useEscapeKey';

import { normalizeLines } from '../lib/normalizeLines.js';

const MIN_LINE_LENGTH = 20;
const MAX_LINE_LENGTH = 120;

export { normalizeLines };

export function NormalizeLinesModal({ fileName, rawLines, onConfirm, onSkip }) {
  const { t } = useLang();
  const [maxLen, setMaxLen] = useState(DEFAULT_MAX_LEN);

  const normalized = useMemo(() => normalizeLines(rawLines, maxLen), [rawLines, maxLen]);
  const preview = normalized.slice(0, 5);
  const hasMore = normalized.length > 5;

  useEscapeKey(onSkip);

  function handleConfirm() {
    onConfirm(normalized);
  }

  function handleMaxLenChange(e) {
    const v = parseInt(e.target.value, 10);
    if (!isNaN(v)) setMaxLen(Math.max(MIN_LINE_LENGTH, Math.min(MAX_LINE_LENGTH, v)));
  }

  return (
    <div className="settings-modal" role="dialog" aria-modal="true">
      <div className="settings-modal__backdrop" onClick={onSkip} />
      <div className="settings-modal__box">
        <div className="settings-modal__header">
          <span className="settings-modal__title">{t('normalizeModal.title')}</span>
          <button className="settings-modal__close" onClick={onSkip} title="Close (Esc)">✕</button>
        </div>
        <div className="settings-modal__body">
          <div className="settings-panel settings-panel--active">
            <p style={{ fontSize: 13, color: 'var(--color-text-dim)', margin: 0 }}>
              <strong style={{ color: 'var(--color-text)' }}>{fileName}</strong>
              {' — '}
              {t('normalizeModal.hint')}
            </p>
            <div className="settings-field">
              <label className="settings-field__label">{t('normalizeModal.maxLen')}</label>
              <input
                type="number"
                className="settings-field__input"
                value={maxLen}
                min={MIN_LINE_LENGTH}
                max={MAX_LINE_LENGTH}
                onChange={handleMaxLenChange}
              />
              <span className="settings-field__hint">{t('normalizeModal.maxLenHint')}</span>
            </div>
            {preview.length > 0 && (
              <div className="settings-field">
                <label className="settings-field__label">{t('normalizeModal.preview')}</label>
                <div style={{
                  background: 'var(--color-bg)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 6,
                  padding: '8px 10px',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 12,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 2,
                }}>
                  {preview.map((line, i) => (
                    <div key={i} style={{ color: 'var(--color-text)', whiteSpace: 'pre' }}>{line}</div>
                  ))}
                  {hasMore && <div style={{ color: 'var(--color-text-dim)' }}>…</div>}
                </div>
                <span className="settings-field__hint">
                  {normalized.length} {t('normalizeModal.linesCount')}
                </span>
              </div>
            )}
          </div>
        </div>
        <div className="settings-modal__footer">
          <div className="settings-modal__actions">
            <button className="btn btn--secondary" onClick={onSkip} style={{ flex: 1 }}>
              {t('normalizeModal.skip')}
            </button>
            <button className="btn btn--primary" onClick={handleConfirm} style={{ flex: 1 }}>
              {t('normalizeModal.confirm')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
