import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Router, Route, Switch, Redirect } from 'wouter';
import './styles/reset.css';
import './styles/layout.css';
import './styles/sidebar.css';
import './styles/components.css';
import { AppLayout } from './App';
import { AppProviders } from './contexts/AppProviders';
import { SidebarLayout } from './components/SidebarLayout';
import { DashboardPage } from './components/DashboardPage';
import { AudioPage } from './components/AudioPage';
import { BroadcastPage } from './components/BroadcastPage';
import { SettingsPage } from './components/SettingsPage';
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
import { DskViewportsPage } from './components/DskViewportsPage';
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

// ─── Standalone pages (no sidebar, no shared session context) ─────────────────

function isStandalonePath(p) {
  return (
    p.startsWith('/mcp/') ||
    p.startsWith('/embed/') ||
    p.startsWith('/dsk/') ||
    p.startsWith('/dsk-control/') ||
    p.startsWith('/view/') ||
    p.startsWith('/login') ||
    p.startsWith('/register')
  );
}

function getStandalonePage() {
  if (path.startsWith('/mcp/')) {
    const sessionId = path.split('/')[2];
    return <SpeechCapturePage sessionId={sessionId} />;
  }
  if (path.startsWith('/embed/audio'))     return <EmbedAudioPage />;
  if (path.startsWith('/embed/input'))     return <EmbedInputPage />;
  if (path.startsWith('/embed/sentlog'))   return <EmbedSentLogPage />;
  if (path.startsWith('/embed/file-drop')) return <EmbedFileDropPage />;
  if (path.startsWith('/embed/files'))     return <EmbedFilesPage />;
  if (path.startsWith('/embed/settings'))  return <EmbedSettingsPage />;
  if (path.startsWith('/embed/rtmp'))      return <EmbedRtmpPage />;
  if (path.startsWith('/embed/viewer'))    return <EmbedViewerPage />;
  if (path.startsWith('/dsk-control/'))    return <DskControlPage />;
  if (path.startsWith('/dsk/'))            return <DskPage />;
  if (path.startsWith('/view/'))           return <ViewerPage />;
  if (path.startsWith('/login'))           return <LoginPage />;
  if (path.startsWith('/register'))        return <RegisterPage />;
  // Should not reach here since isStandalonePath guards the call
  return <SidebarApp />;
}

// ─── Stub page for routes not yet fully implemented ───────────────────────────

function StubPage({ icon, title, description }) {
  return (
    <div className="stub-page">
      <div className="stub-page__icon">{icon}</div>
      <div className="stub-page__title">{title}</div>
      <p className="stub-page__desc">{description || 'This page is coming soon.'}</p>
    </div>
  );
}

// ─── Main sidebar app ─────────────────────────────────────────────────────────

function SidebarApp() {
  return (
    <AppProviders>
      <Router>
        <SidebarLayout>
          <Switch>
            <Route path="/" component={DashboardPage} />
            <Route path="/captions" component={AppLayout} />
            <Route path="/audio" component={AudioPage} />
            <Route path="/broadcast" component={BroadcastPage} />
            <Route path="/graphics/editor" component={DskEditorPage} />
            <Route path="/graphics/control">
              <StubPage icon="🖼️" title="DSK Control" description="Access DSK Control via /dsk-control/:apikey. Full sidebar integration planned for a later phase." />
            </Route>
            <Route path="/graphics/viewports" component={DskViewportsPage} />
            <Route path="/production/cameras" component={ProductionCamerasPage} />
            <Route path="/production/mixers" component={ProductionMixersPage} />
            <Route path="/production/bridges" component={ProductionBridgesPage} />
            <Route path="/production" component={ProductionOperatorPage} />
            <Route path="/projects" component={ProjectsPage} />
            <Route path="/account">
              <StubPage icon="👤" title="Account" description="User profile and password management will live here in Phase 4." />
            </Route>
            <Route path="/settings" component={SettingsPage} />
            {/* Legacy URL aliases — redirect to sidebar equivalents */}
            <Route path="/dsk-editor"><Redirect to="/graphics/editor" /></Route>
            <Route path="/dsk-viewports"><Redirect to="/graphics/viewports" /></Route>
            {/* Fallback */}
            <Route><Redirect to="/" /></Route>
          </Switch>
        </SidebarLayout>
      </Router>
    </AppProviders>
  );
}

// ─── Entry point ──────────────────────────────────────────────────────────────

const root = isStandalonePath(path)
  ? getStandalonePage()
  : <SidebarApp />;

createRoot(document.getElementById('app')).render(
  <StrictMode>
    {root}
  </StrictMode>
);

