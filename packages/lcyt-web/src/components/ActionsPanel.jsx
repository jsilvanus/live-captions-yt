import { useState } from 'react';
import { FloatingPanel } from './FloatingPanel';
import { useSessionContext } from '../contexts/SessionContext';
import { useToastContext } from '../contexts/ToastContext';
import { useLang } from '../contexts/LangContext';

export function ActionsPanel({ onClose }) {
  const session = useSessionContext();
  const { showToast } = useToastContext();
  const { t } = useLang();

  const [customSequence, setCustomSequence] = useState(0);
  const [hbResult, setHbResult] = useState(null);
  const [syncResult, setSyncResult] = useState(null);

  async function handleSync() {
    if (!session.connected) { showToast(t('settings.actions.notConnected'), 'warning'); return; }
    try {
      const data = await session.sync();
      setSyncResult(`${data.syncOffset}ms`);
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function handleHeartbeat() {
    if (!session.connected) { showToast(t('settings.actions.notConnected'), 'warning'); return; }
    try {
      const data = await session.heartbeat();
      setHbResult(`${data.roundTripTime}ms`);
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function handleResetSequence() {
    if (!session.connected) { showToast(t('settings.actions.notConnected'), 'warning'); return; }
    try {
      await session.updateSequence(0);
      showToast(t('settings.actions.sequenceReset'), 'success');
    } catch (err) {
      showToast(err.message || t('settings.actions.sequenceSetError'), 'error');
    }
  }

  async function handleSetSequence() {
    if (!session.connected) { showToast(t('settings.actions.notConnected'), 'warning'); return; }
    try {
      await session.updateSequence(customSequence);
      showToast(`${t('settings.actions.setSequence')}: ${customSequence}`, 'success');
    } catch (err) {
      showToast(err.message || t('settings.actions.sequenceSetError'), 'error');
    }
  }

  function handleClearConfig() {
    session.clearPersistedConfig();
    showToast(t('settings.connection.configCleared'), 'info');
  }

  return (
    <FloatingPanel title={t('statusBar.actions')} onClose={onClose}>
      <div className="settings-modal__actions">
        <button className="btn btn--secondary btn--sm" onClick={handleSync}>{t('settings.actions.syncNow')}</button>
        <button className="btn btn--secondary btn--sm" onClick={handleHeartbeat}>{t('settings.actions.heartbeat')}</button>
        <button className="btn btn--secondary btn--sm" onClick={handleResetSequence}>{t('settings.actions.resetSequence')}</button>
      </div>
      {hbResult && (
        <div className="settings-status-row">
          <span className="settings-status-row__label">{t('settings.actions.roundTrip')}</span>
          <span className="settings-status-row__value">{hbResult}</span>
        </div>
      )}
      {syncResult && (
        <div className="settings-status-row">
          <span className="settings-status-row__label">{t('settings.actions.syncOffset')}</span>
          <span className="settings-status-row__value">{syncResult}</span>
        </div>
      )}
      <div className="settings-field">
        <label className="settings-field__label">{t('settings.actions.setSequence')}</label>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type="number"
            className="settings-field__input"
            style={{ width: 90 }}
            min="0"
            value={customSequence}
            onChange={e => setCustomSequence(Math.max(0, parseInt(e.target.value, 10) || 0))}
          />
          <button className="btn btn--secondary btn--sm" onClick={handleSetSequence}>{t('settings.actions.setSequenceBtn')}</button>
        </div>
      </div>
      <hr style={{ borderColor: 'var(--color-border)', margin: '8px 0' }} />
      <button className="btn btn--danger btn--sm" onClick={handleClearConfig}>{t('settings.actions.clearConfig')}</button>
    </FloatingPanel>
  );
}
