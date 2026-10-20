import { useState } from 'react';
import { useAudioContext } from '../contexts/AudioContext';
import { useCaptionContext } from '../contexts/CaptionContext';
import { useConnectionContext } from '../contexts/ConnectionContext';
import { useSentLogContext } from '../contexts/SentLogContext';
import { useLang } from '../contexts/LangContext';

const BLUE = '#1a6fd4';
const RED = '#cc0022';

/** Content of the floating listener window: STT button, delivered captions, caption input. */
export function MicWindowContent({ mode, onClose }) {
  const { t } = useLang();
  const { listening, toggle, interimText } = useAudioContext();
  const { send } = useCaptionContext();
  const { connected } = useConnectionContext();
  const sentLog = useSentLogContext();
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const entries = (sentLog?.entries || []).filter((e) => !e.error).slice(0, 30);

  async function submit() {
    const text = draft.trim();
    if (!text || sending || !connected) return;
    setSending(true);
    setError('');
    try {
      await send(text, Date.now());
      setDraft('');
    } catch (err) {
      setError(err?.message || t('micWindow.sendFailed'));
    } finally {
      setSending(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#111', color: '#ddd', fontSize: 13 }}>
      <div style={{ display: 'flex', gap: 8, padding: 8, alignItems: 'center', borderBottom: '1px solid #262626' }}>
        <button
          type="button"
          onClick={toggle}
          aria-pressed={listening}
          style={{ flex: 1, padding: '10px', borderRadius: 8, border: 'none', color: '#fff', fontWeight: 700, background: listening ? RED : BLUE, cursor: 'pointer' }}
        >
          {listening ? t('listenPane.stop') : t('listenPane.start')}
        </button>
        <button type="button" onClick={onClose} title={t('micWindow.close')} aria-label={t('micWindow.close')}
          style={{ padding: '8px 10px', borderRadius: 6, border: '1px solid #333', background: '#1c1c1c', color: '#bbb', cursor: 'pointer' }}>✕</button>
      </div>
      {interimText && <div style={{ padding: '6px 10px', fontStyle: 'italic', color: '#9ab' }}>{interimText}</div>}
      <div style={{ flex: 1, overflow: 'auto', padding: 8, display: 'flex', flexDirection: 'column', gap: 5 }} aria-label={t('micWindow.sent')}>
        {entries.length === 0 && <div style={{ color: '#777' }}>{t('micWindow.none')}</div>}
        {entries.map((e, i) => (
          <div key={e.requestId || i} style={{ padding: '6px 8px', borderRadius: 6, background: i === 0 ? '#16221a' : '#1a1a1a', border: `1px solid ${i === 0 ? '#255238' : '#262626'}` }}>
            <div style={{ fontSize: 10, color: e.pending ? '#c79a3a' : '#6a9' }}>{e.pending ? t('micWindow.pending') : `#${e.sequence ?? ''}`}</div>
            <div>{e.text}</div>
          </div>
        ))}
      </div>
      {error && <div style={{ padding: '0 8px', color: '#e66' }}>{error}</div>}
      <div style={{ display: 'flex', gap: 6, padding: 8, borderTop: '1px solid #262626' }}>
        <input
          type="text"
          value={draft}
          disabled={!connected}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
          placeholder={connected ? t('micWindow.placeholder') : t('micWindow.offline')}
          aria-label={t('micWindow.placeholder')}
          style={{ flex: 1, background: '#181818', border: '1px solid #333', borderRadius: 6, padding: '7px 9px', color: '#ddd' }}
        />
        <button type="button" onClick={submit} disabled={!connected || sending || !draft.trim()}
          style={{ padding: '0 12px', borderRadius: 6, border: 'none', background: BLUE, color: '#fff', opacity: (!connected || sending || !draft.trim()) ? 0.5 : 1, cursor: 'pointer' }}>
          {sending ? '…' : t('micWindow.send')}
        </button>
      </div>
      {mode === 'popup' && <div style={{ padding: '0 8px 6px', fontSize: 10, color: '#777' }}>{t('micWindow.popupNote')}</div>}
    </div>
  );
}
