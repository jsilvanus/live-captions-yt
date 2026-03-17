import { useState } from 'react';
import { useSessionContext } from '../../contexts/SessionContext';

export function InputWidget({ size }) {
  const { connected, send } = useSessionContext();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  async function handleSend(e) {
    e.preventDefault();
    if (!text.trim() || !connected) return;
    setSending(true);
    try { await send(text.trim()); setText(''); } catch {}
    setSending(false);
  }

  if (size === 'small') {
    return (
      <form className="db-widget db-widget--input-sm" onSubmit={handleSend}>
        <input
          className="db-input"
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder={connected ? 'Caption…' : 'Not connected'}
          disabled={!connected || sending}
        />
        <button type="submit" className="btn btn--primary btn--sm" disabled={!connected || !text.trim() || sending}>
          {sending ? '…' : '▶'}
        </button>
      </form>
    );
  }

  return (
    <form className="db-widget" onSubmit={handleSend}>
      <textarea
        className="db-textarea"
        rows={3}
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder={connected ? 'Type a caption and press Send…' : 'Connect first to send captions'}
        disabled={!connected || sending}
        onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { handleSend(e); } }}
      />
      <div className="db-row" style={{ marginTop: 8, justifyContent: 'flex-end' }}>
        <span className="db-widget__muted" style={{ flex: 1, fontSize: 11 }}>Ctrl+Enter to send</span>
        <button type="submit" className="btn btn--primary" disabled={!connected || !text.trim() || sending}>
          {sending ? 'Sending…' : 'Send'}
        </button>
      </div>
    </form>
  );
}
