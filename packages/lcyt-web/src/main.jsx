import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/reset.css';
import './styles/layout.css';
import './styles/components.css';
import { App } from './App';
import { SpeechCapturePage } from './components/SpeechCapturePage';

const path = window.location.pathname;

if (path.startsWith('/mcp/')) {
  const sessionId = path.split('/')[2];
  createRoot(document.getElementById('app')).render(
    <StrictMode>
      <SpeechCapturePage sessionId={sessionId} />
    </StrictMode>
  );
} else {
  createRoot(document.getElementById('app')).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}
