import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/reset.css';
import './styles/layout.css';
import './styles/components.css';
import { App } from './App';
import { SpeechCapturePage } from './components/SpeechCapturePage';
import { EmbedAudioPage } from './components/EmbedAudioPage';
import { EmbedInputPage } from './components/EmbedInputPage';
import { EmbedSentLogPage } from './components/EmbedSentLogPage';
import { EmbedFileDropPage } from './components/EmbedFileDropPage';
import { EmbedFilesPage } from './components/EmbedFilesPage';
import { EmbedSettingsPage } from './components/EmbedSettingsPage';

const path = window.location.pathname;

function getPage() {
  if (path.startsWith('/mcp/')) {
    const sessionId = path.split('/')[2];
    return <SpeechCapturePage sessionId={sessionId} />;
  }
  if (path.startsWith('/embed/audio'))     return <EmbedAudioPage />;
  if (path.startsWith('/embed/input'))     return <EmbedInputPage />;
  if (path.startsWith('/embed/sentlog'))   return <EmbedSentLogPage />;
  if (path.startsWith('/embed/file-drop')) return <EmbedFileDropPage />;
  if (path.startsWith('/embed/files'))     return <EmbedFilesPage />;
  if (path.startsWith('/embed/settings')) return <EmbedSettingsPage />;
  return <App />;
}

createRoot(document.getElementById('app')).render(
  <StrictMode>
    {getPage()}
  </StrictMode>
);
