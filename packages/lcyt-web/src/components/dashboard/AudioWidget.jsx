import { useState, useEffect } from 'react';
import { useSessionContext } from '../../contexts/SessionContext';
import { KEYS } from '../../lib/storageKeys.js';

export function AudioWidget({ size }) {
  const { connected } = useSessionContext();
  const [recording, setRecording] = useState(false);
  const [utteranceEnd, setUtteranceEnd] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [interimText, setInterimText] = useState('');

  useEffect(() => {
    function onAudioState(e) {
      if (e.detail?.recording !== undefined) setRecording(e.detail.recording);
      if (e.detail?.utteranceEnd !== undefined) setUtteranceEnd(e.detail.utteranceEnd);
      if (e.detail?.pendingCount !== undefined) setPendingCount(e.detail.pendingCount);
      if (e.detail?.interimText !== undefined) setInterimText(e.detail.interimText);
    }
    const ueb = localStorage.getItem(KEYS.audio.utteranceEndButton);
    setUtteranceEnd(ueb === '1');
    window.addEventListener('lcyt:audio-state', onAudioState);
    return () => window.removeEventListener('lcyt:audio-state', onAudioState);
  }, []);

  if (size === 'small') {
    return (
      <div className="db-widget db-widget--audio-sm">
        <button
          className={`btn btn--sm ${recording ? 'btn--danger' : 'btn--primary'} db-mic-btn`}
          disabled={!connected}
          onClick={() => window.dispatchEvent(new CustomEvent('lcyt:audio-toggle'))}
        >
          {recording ? '■ Stop' : '🎤 Mic'}
        </button>
        {utteranceEnd && (
          <button
            className="btn btn--sm btn--secondary db-utter-btn"
            onClick={() => window.dispatchEvent(new CustomEvent('lcyt:audio-utterance-end'))}
            title="Send utterance"
          >
            ✂ {pendingCount > 0 && <span className="db-badge">{pendingCount}</span>}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="db-widget">
      <div className="db-row">
        <button
          className={`btn ${recording ? 'btn--danger' : 'btn--primary'}`}
          disabled={!connected}
          style={{ flex: 1 }}
          onClick={() => window.dispatchEvent(new CustomEvent('lcyt:audio-toggle'))}
        >
          {recording ? '■ Stop recording' : '🎤 Start recording'}
        </button>
      </div>
      {utteranceEnd && (
        <div className="db-row" style={{ marginTop: 8 }}>
          <button
            className="btn btn--secondary"
            style={{ flex: 1 }}
            onClick={() => window.dispatchEvent(new CustomEvent('lcyt:audio-utterance-end'))}
          >
            ✂ Send utterance {pendingCount > 0 && `(${pendingCount} pending)`}
          </button>
        </div>
      )}
      {recording && interimText && (
        <div className="db-interim-text">{interimText}</div>
      )}
      {!connected && <div className="db-empty-note">Connect first to use microphone.</div>}
    </div>
  );
}
