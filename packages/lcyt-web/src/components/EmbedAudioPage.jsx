/**
 * EmbedAudioPage — standalone microphone/speech capture widget for iframe embedding.
 *
 * Rendered when lcyt-web is opened at /embed/audio
 *
 * URL params:
 *   ?server=https://api.example.com   Backend URL
 *   &apikey=YOUR_KEY                  LCYT API key
 *   &theme=dark|light                 UI theme (default: dark)
 *
 * On connect, broadcasts { type: 'lcyt:session', token, backendUrl } via BroadcastChannel
 * ('lcyt-embed') so a sibling EmbedSentLogPage iframe on the same host page can subscribe
 * to caption delivery results independently.
 *
 * Host page usage:
 *   <iframe
 *     src="https://your-lcyt-host/embed/audio?server=...&apikey=..."
 *     allow="microphone"
 *     style="width:100%; height:200px; border:none;">
 *   </iframe>
 */

import { useEffect, useRef } from 'react';
import { AppProviders } from '../contexts/AppProviders';
import { AudioPanel } from './AudioPanel';

export function EmbedAudioPage() {
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
        <AudioPanel visible />
      </div>
    </AppProviders>
  );
}
