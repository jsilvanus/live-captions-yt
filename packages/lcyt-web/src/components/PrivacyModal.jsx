import { useEffect } from 'react';

export function PrivacyModal({ isOpen, onClose }) {
  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    function onKeyDown(e) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="privacy-title">
      <div className="settings-modal__backdrop" onClick={onClose} />
      <div className="settings-modal__box">

        <div className="settings-modal__header">
          <span className="settings-modal__title" id="privacy-title">Privacy &amp; Data</span>
          <button className="settings-modal__close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="settings-modal__body privacy-body">

          <section className="privacy-section">
            <h3 className="privacy-heading">What this app does</h3>
            <p>lcyt-web is a browser-based tool that forwards caption text to YouTube Live via a relay backend. <strong>Caption text is not stored</strong> — it is processed in memory and sent immediately to YouTube.</p>
          </section>

          <section className="privacy-section">
            <h3 className="privacy-heading">Data stored by the relay backend</h3>
            <p>The backend you connect to stores the following data associated with your API key:</p>
            <ul className="privacy-list">
              <li><strong>API key record</strong> — owner name, email address (if provided), key creation date, expiry date, and cumulative caption counts.</li>
              <li><strong>Session records</strong> — origin domain, session start/end times, duration, and counts of captions sent and failed. Caption text is not included.</li>
              <li><strong>Error logs</strong> — error codes and messages when caption delivery to YouTube fails.</li>
              <li><strong>Auth event logs</strong> — timestamps and origin domain when authentication fails or a usage limit is exceeded.</li>
            </ul>
            <p>The <strong>data controller</strong> is whoever operates the backend instance you are connected to. Contact them for data requests.</p>
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
              <li><strong>Google Cloud Speech-to-Text</strong> (optional) — if enabled, audio is sent to Google for transcription. Google's privacy policy applies.</li>
            </ul>
          </section>

          <section className="privacy-section">
            <h3 className="privacy-heading">Your rights</h3>
            <p>Depending on your jurisdiction (e.g. GDPR, CCPA), you may have rights to access, correct, export, or delete your data. To exercise these rights:</p>
            <ul className="privacy-list">
              <li><strong>Access &amp; export</strong> — call <code>GET /stats</code> on your backend with your session token to retrieve all records associated with your key.</li>
              <li><strong>Deletion</strong> — ask your backend operator to delete your API key. This removes all associated session, error, and usage records.</li>
            </ul>
          </section>

        </div>

        <div className="settings-modal__footer">
          <div className="settings-modal__actions">
            <button className="btn btn--secondary" onClick={onClose}>Close</button>
          </div>
        </div>

      </div>
    </div>
  );
}
