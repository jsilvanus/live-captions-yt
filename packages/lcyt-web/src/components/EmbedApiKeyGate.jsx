/**
 * EmbedApiKeyGate — renders a centered API key prompt when no key is available.
 *
 * Usage (render-prop pattern):
 *   <EmbedApiKeyGate initialKey={apiKey} backendUrl={backendUrl}>
 *     {(key) => <AppProviders initConfig={{ backendUrl, apiKey: key }} autoConnect embed>…</AppProviders>}
 *   </EmbedApiKeyGate>
 *
 * When `initialKey` is non-empty the children are rendered immediately (no prompt).
 * When it is empty a small overlay form is shown; on submit the children are rendered
 * with the entered key.
 */

import { useState } from 'react';

export function EmbedApiKeyGate({ initialKey, backendUrl, children }) {
  const [apiKey, setApiKey] = useState(initialKey);
  const [input,  setInput]  = useState('');
  const [error,  setError]  = useState('');

  if (apiKey) return children(apiKey);

  function handleSubmit(e) {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed) { setError('Please enter your API key.'); return; }
    setError('');
    setApiKey(trimmed);
  }

  return (
    <div style={overlayStyle}>
      <div style={cardStyle}>
        <p style={labelStyle}>Backend</p>
        <p style={serverStyle}>{backendUrl}</p>

        <form onSubmit={handleSubmit} style={{ width: '100%' }}>
          <label style={labelStyle} htmlFor="lcyt-apikey">API key</label>
          <input
            id="lcyt-apikey"
            type="text"
            autoComplete="off"
            spellCheck={false}
            placeholder="Paste your LCYT API key…"
            value={input}
            onChange={e => { setInput(e.target.value); setError(''); }}
            style={inputStyle}
            autoFocus
          />
          {error && <p style={errorStyle}>{error}</p>}
          <button type="submit" disabled={!input.trim()} style={btnStyle}>
            Connect
          </button>
        </form>
      </div>
    </div>
  );
}

const overlayStyle = {
  height:          '100vh',
  display:         'flex',
  alignItems:      'center',
  justifyContent:  'center',
  background:      'var(--color-bg, #111)',
  padding:         '16px',
  boxSizing:       'border-box',
};

const cardStyle = {
  width:        '100%',
  maxWidth:     '340px',
  background:   'var(--color-surface, #1e1e1e)',
  border:       '1px solid var(--color-border, #333)',
  borderRadius: '8px',
  padding:      '20px',
  display:      'flex',
  flexDirection: 'column',
  gap:          '8px',
};

const labelStyle = {
  margin:   0,
  fontSize: '11px',
  color:    'var(--color-text-dim, #888)',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
};

const serverStyle = {
  margin:       0,
  fontSize:     '12px',
  color:        'var(--color-text, #ddd)',
  wordBreak:    'break-all',
  marginBottom: '8px',
};

const inputStyle = {
  width:        '100%',
  boxSizing:    'border-box',
  padding:      '8px 10px',
  background:   'var(--color-bg, #111)',
  border:       '1px solid var(--color-border, #444)',
  borderRadius: '4px',
  color:        'var(--color-text, #eee)',
  fontSize:     '13px',
  outline:      'none',
  marginTop:    '4px',
};

const errorStyle = {
  margin:   '4px 0 0',
  fontSize: '12px',
  color:    'var(--color-error, #e57373)',
};

const btnStyle = {
  marginTop:    '12px',
  width:        '100%',
  padding:      '9px',
  background:   'var(--color-accent, #1976d2)',
  border:       'none',
  borderRadius: '4px',
  color:        '#fff',
  fontWeight:   600,
  fontSize:     '14px',
  cursor:       'pointer',
};
