import { useEffect, useState } from 'react';
import { useSessionContext } from '../contexts/SessionContext';
import { useToastContext } from '../contexts/ToastContext';
import { StatsModal } from './StatsModal';

export function PrivacyModal({ isOpen, onClose, requireAcceptance = false, onAccept }) {
  const session = useSessionContext();
  const { showToast } = useToastContext();

  const [view, setView] = useState('main'); // 'main' | 'deleteConfirm'
  const [deleting, setDeleting] = useState(false);

  const [statsOpen, setStatsOpen] = useState(false);
  const [statsData, setStatsData] = useState(null);
  const [statsLoading, setStatsLoading] = useState(false);

  const [contactLoading, setContactLoading] = useState(false);
  const [contactData, setContactData] = useState(null); // null | object | 'not-configured'

  // Countdown timer (10s) for first-visit acceptance
  const [countdown, setCountdown] = useState(0);
  const canClose = !requireAcceptance || countdown <= 0;

  // Reset state when modal is opened/closed
  useEffect(() => {
    if (isOpen) {
      setCountdown(requireAcceptance ? 10 : 0);
    } else {
      setView('main');
      setDeleting(false);
      setStatsOpen(false);
      setStatsData(null);
      setContactData(null);
    }
  }, [isOpen, requireAcceptance]);

  // Tick countdown
  useEffect(() => {
    if (!isOpen || !requireAcceptance || countdown <= 0) return;
    const id = setTimeout(() => setCountdown(c => c - 1), 1000);
    return () => clearTimeout(id);
  }, [isOpen, requireAcceptance, countdown]);

  // Close on Escape (blocked during countdown in acceptance mode)
  useEffect(() => {
    if (!isOpen) return;
    function onKeyDown(e) {
      if (e.key === 'Escape') {
        if (!canClose) return;
        if (statsOpen) { setStatsOpen(false); return; }
        if (view === 'deleteConfirm') { setView('main'); return; }
        requireAcceptance ? onAccept?.() : onClose();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose, onAccept, view, statsOpen, canClose, requireAcceptance]);

  function handleBackdropClick() {
    if (!canClose) return;
    if (view === 'deleteConfirm') { setView('main'); return; }
    requireAcceptance ? onAccept?.() : onClose();
  }

  if (!isOpen) return null;

  async function handleStats() {
    setStatsLoading(true);
    try {
      const data = await session.getStats();
      setStatsData(data);
      setStatsOpen(true);
    } catch (err) {
      showToast(err.message || 'Failed to load stats', 'error');
    } finally {
      setStatsLoading(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await session.eraseSelf();
      showToast('Your data has been erased', 'success');
      onClose();
    } catch (err) {
      showToast(err.message || 'Erasure failed', 'error');
      setDeleting(false);
    }
  }

  async function handleContact() {
    setContactLoading(true);
    try {
      const res = await fetch(`${session.backendUrl}/contact`);
      if (res.status === 404) { setContactData('not-configured'); return; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setContactData(await res.json());
    } catch (err) {
      showToast(err.message || 'Failed to load contact info', 'error');
    } finally {
      setContactLoading(false);
    }
  }

  const isFreeTier = statsData
    ? (statsData.usage?.dailyLimit !== null || statsData.usage?.lifetimeLimit !== null)
    : false;

  return (
    <>
      <div className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="privacy-title">
        <div className="settings-modal__backdrop" onClick={handleBackdropClick} />
        <div className="settings-modal__box">

          <div className="settings-modal__header">
            <span className="settings-modal__title" id="privacy-title">Privacy &amp; Terms &amp; Data</span>
            {!requireAcceptance && (
              <button className="settings-modal__close" onClick={onClose} aria-label="Close">✕</button>
            )}
          </div>

          {requireAcceptance && (
            <div className={`privacy-acceptance-banner${canClose ? ' privacy-acceptance-banner--ready' : ''}`}>
              {countdown > 0
                ? <>Please read the policy below. You may close this in <strong>{countdown}</strong> second{countdown !== 1 ? 's' : ''}.</>
                : 'You may now close and accept data processing.'
              }
            </div>
          )}

          {view === 'main' && (
            <div className="settings-modal__body privacy-body">

              <section className="privacy-section">
                <h3 className="privacy-heading">What this app does</h3>
                <p><strong>lcyt-web</strong> is a browser-based tool that forwards caption text to YouTube Live via a relay backend. <strong>Caption text is not stored</strong> — it is processed in memory of the relay and sent immediately to YouTube.</p>
              </section>

              <section className="privacy-section">
                <h3 className="privacy-heading">Disclaimer</h3>
                <p>This service is provided <strong>as-is, without any warranty</strong>, express or implied. The operator of the backend instance you are connected to accepts no liability for any direct, indirect, or consequential damages arising from your use of this service, including but not limited to data loss, service interruptions, or errors in caption delivery.</p>
              </section>


              <section className="privacy-section">
                <h3 className="privacy-heading">Data stored by the relay backend</h3>
                <p>The backend you connect to stores anonymous usage statistics. It also stores the following data associated with your API key:</p>
                <ul className="privacy-list">
                  <li><strong>API key record</strong> — owner name, email address (if provided), key creation date, expiry date, and cumulative caption counts.</li>
                  <li><strong>Session records</strong> — origin domain, session start/end times, duration, and counts of captions sent and failed. Caption text is not included.</li>
                  <li><strong>Error logs</strong> — error codes and messages when caption delivery to YouTube fails.</li>
                  <li><strong>Auth event logs</strong> — timestamps and origin domain when authentication fails or a usage limit is exceeded.</li>
                  <li><strong>Anonymous usage statistics</strong> — aggregate caption and session counts per origin domain and time bucket (hour/day). No caption text, no user identifiers.</li>
                </ul>
                <p>The <strong>data controller</strong> is whoever operates the backend instance you are connected to. Contact them for data requests. Use the <strong>Contact operator</strong> button at the bottom to query their contact details.</p>
              </section>

              <section className="privacy-section">
                <h3 className="privacy-heading">Data stored in your browser</h3>
                <p>The following is stored in your browser's <code>localStorage</code> and never leaves your device unless you connect to a backend:</p>
                <ul className="privacy-list">
                  <li>Backend URL, API key, and YouTube stream key (for auto-connect)</li>
                  <li>Preferences: theme, batch interval, transcription offset</li>
                  <li>Speech-to-text configuration (language, model, punctuation settings)</li>
                  <li>Google Cloud service account credentials (only if cloud STT is enabled)</li>
                </ul>
                <p>Clear your browser's site data at any time to remove all locally stored information.</p>
              </section>

              <section className="privacy-section">
                <h3 className="privacy-heading">Third-party services</h3>
                <ul className="privacy-list">
                  <li><strong>YouTube Live</strong> — caption text and timestamps are sent to YouTube's caption ingestion API. Google's privacy policy applies.</li>
                  <li><strong>Web Speech API</strong> (browser built-in, optional) — if enabled, audio is processed by your browser's speech recognition engine. On Chrome and Edge this is handled by Google's servers. No audio data passes through the relay backend. Google's privacy policy applies.</li>
                  <li><strong>Google Cloud Speech-to-Text</strong> (optional) — if enabled, audio is sent directly from your browser to Google for transcription using your own service account. Credentials are saved only in your memory. Google's privacy policy applies.</li>
                </ul>
              </section>

              <section className="privacy-section">
                <h3 className="privacy-heading">Your rights</h3>
                <p>Depending on your jurisdiction (e.g. GDPR, CCPA), you may have rights to access, correct, export, or delete your data.</p>
                {session.connected ? (
                  <p>Use the <strong>Stats</strong> and <strong>Delete my data</strong> buttons below to exercise your rights directly.</p>
                ) : (
                  <ul className="privacy-list">
                    <li><strong>Access &amp; export</strong> — connect to your backend and use the Stats button in this dialog to retrieve all records associated with your key.</li>
                    <li><strong>Deletion</strong> — connect and use the Delete button, or ask your backend operator to delete your API key. This removes all associated session, error, and usage records.</li>
                  </ul>
                )}
              </section>

              {contactData && contactData !== 'not-configured' && (
                <section className="privacy-section">
                  <h3 className="privacy-heading">Operator contact</h3>
                  <p><strong>{contactData.name}</strong></p>
                  <p><a href={`mailto:${contactData.email}`}>{contactData.email}</a></p>
                  {contactData.phone && <p>{contactData.phone}</p>}
                  {contactData.website && <p><a href={contactData.website} target="_blank" rel="noopener noreferrer">{contactData.website}</a></p>}
                </section>
              )}
              {contactData === 'not-configured' && (
                <section className="privacy-section">
                  <div className="privacy-notice privacy-notice--info">The backend operator has not published contact details.</div>
                </section>
              )}

            </div>
          )}

          {view === 'deleteConfirm' && (
            <div className="settings-modal__body privacy-body">
              <section className="privacy-section">
                <h3 className="privacy-heading privacy-heading--danger">Delete your data</h3>
                <p>This will permanently erase the following from the backend:</p>
                <ul className="privacy-list">
                  <li>Your owner name and API key (key will be revoked)</li>
                  <li>All session records</li>
                  <li>All caption error logs</li>
                  <li>All auth event logs</li>
                  <li>All usage statistics linked to the API key</li>
                </ul>

                {isFreeTier && statsData?.email && (
                  <div className="privacy-notice privacy-notice--info">
                    <strong>Email retained:</strong> Your email address (<code>{statsData.email}</code>) will be kept
                    {statsData?.expires ? ` until ${new Date(statsData.expires).toLocaleDateString()}` : ' until the key expiry date'}
                    {' '}to prevent multiple free-tier sign-ups from the same address (legitimate interest). It will not be used for any other purpose.
                  </div>
                )}

                <p style={{ marginTop: 8 }}>Your browser's saved credentials will also be cleared. <strong>This cannot be undone.</strong></p>
              </section>
            </div>
          )}

          <div className="settings-modal__footer">
            {view === 'main' && (
              <div className="settings-modal__actions">
                {session.connected && (
                  <>
                    <button
                      className="btn btn--secondary btn--sm"
                      onClick={handleStats}
                      disabled={statsLoading}
                    >
                      {statsLoading ? 'Loading…' : 'Stats'}
                    </button>
                    <button
                      className="btn btn--danger btn--sm"
                      onClick={() => setView('deleteConfirm')}
                    >
                      Delete my data
                    </button>
                    <button
                      className="btn btn--secondary btn--sm"
                      onClick={handleContact}
                      disabled={contactLoading}
                    >
                      {contactLoading ? 'Loading…' : 'Contact operator'}
                    </button>
                  </>
                )}
                {requireAcceptance ? (
                  <button
                    className="btn btn--primary"
                    onClick={onAccept}
                    disabled={!canClose}
                    style={{ marginLeft: 'auto' }}
                    title={canClose ? undefined : `Available in ${countdown}s`}
                  >
                    {canClose
                      ? 'Close and accept data processing'
                      : `Close and accept (${countdown}s)`}
                  </button>
                ) : (
                  <button className="btn btn--secondary" onClick={onClose} style={{ marginLeft: 'auto' }}>Close</button>
                )}
              </div>
            )}

            {view === 'deleteConfirm' && (
              <div className="settings-modal__actions">
                <button
                  className="btn btn--danger"
                  onClick={handleDelete}
                  disabled={deleting}
                >
                  {deleting ? 'Erasing…' : 'Confirm — delete everything'}
                </button>
                <button className="btn btn--secondary" onClick={() => setView('main')} disabled={deleting}>
                  Cancel
                </button>
              </div>
            )}
          </div>

        </div>
      </div>

      <StatsModal
        isOpen={statsOpen}
        onClose={() => setStatsOpen(false)}
        stats={statsData}
      />
    </>
  );
}
