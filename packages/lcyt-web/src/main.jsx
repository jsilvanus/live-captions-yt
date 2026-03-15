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
import { EmbedRtmpPage } from './components/EmbedRtmpPage';
import { DskPage } from './components/DskPage';
import { DskEditorPage } from './components/DskEditorPage';
import { DskControlPage } from './components/DskControlPage';
import { EmbedViewerPage } from './components/EmbedViewerPage';
import { ViewerPage } from './components/ViewerPage';
import { ProductionCamerasPage } from './components/ProductionCamerasPage';
import { ProductionMixersPage } from './components/ProductionMixersPage';
import { ProductionBridgesPage } from './components/ProductionBridgesPage';
import { ProductionOperatorPage } from './components/ProductionOperatorPage';
import { LoginPage } from './components/LoginPage';
import { RegisterPage } from './components/RegisterPage';
import { ProjectsPage } from './components/ProjectsPage';

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
  if (path.startsWith('/embed/rtmp'))     return <EmbedRtmpPage />;
  if (path.startsWith('/dsk-editor'))     return <DskEditorPage />;
  if (path.startsWith('/dsk-control/'))   return <DskControlPage />;
  if (path.startsWith('/dsk/'))           return <DskPage />;
  if (path.startsWith('/embed/viewer'))   return <EmbedViewerPage />;
  if (path.startsWith('/view/'))                    return <ViewerPage />;
  if (path.startsWith('/production/cameras'))       return <ProductionCamerasPage />;
  if (path.startsWith('/production/mixers'))        return <ProductionMixersPage />;
  if (path.startsWith('/production/bridges'))       return <ProductionBridgesPage />;
  if (path.startsWith('/production'))               return <ProductionOperatorPage />;
  if (path.startsWith('/login'))                    return <LoginPage />;
  if (path.startsWith('/register'))                 return <RegisterPage />;
  if (path.startsWith('/projects'))                 return <ProjectsPage />;
  return <App />;
}

createRoot(document.getElementById('app')).render(
  <StrictMode>
    {getPage()}
  </StrictMode>
);
