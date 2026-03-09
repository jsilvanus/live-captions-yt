/**
 * EmbedInputPage — text input bar + sent captions log widget for iframe embedding.
 *
 * Rendered when lcyt-web is opened at /embed/input
 *
 * URL params:
 *   ?server=https://api.example.com   Backend URL
 *   &apikey=YOUR_KEY                  LCYT API key
 *   &theme=dark|light                 UI theme (default: dark)
 *
 * Contains the full session (connects to backend), so captions typed here are delivered
 * to YouTube. Also broadcasts caption texts and the session token via BroadcastChannel
 * ('lcyt-embed') so a sibling EmbedSentLogPage iframe can display the delivery log.
 *
 * Host page usage:
 *   <iframe
 *     src="https://your-lcyt-host/embed/input?server=...&apikey=..."
 *     style="width:100%; height:300px; border:none;">
 *   </iframe>
 */

import { useEffect } from 'react';
import { AppProviders } from '../contexts/AppProviders';
import { InputBar } from './InputBar';
import { SentPanel } from './SentPanel';

export function EmbedInputPage() {
  const params     = new URLSearchParams(window.location.search);
  const backendUrl = params.get('server') || 'https://api.lcyt.fi';
  const apiKey     = params.get('apikey') || '';
  const theme      = params.get('theme')  || 'dark';

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, []);

  return (
    <AppProviders
      initConfig={{ backendUrl, apiKey }}
      autoConnect={!!apiKey}
      embed
    >
      <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
          <SentPanel />
        </div>
        <InputBar />
      </div>
    </AppProviders>
  );
}
