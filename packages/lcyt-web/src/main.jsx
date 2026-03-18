import { StrictMode, lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { Router, Route, Switch, Redirect } from 'wouter';
import { migrateStorageKeys } from './lib/storageKeys.js';
import './styles/reset.css';
import './styles/layout.css';
import './styles/sidebar.css';
import './styles/components.css';
import { AppLayout } from './App';
import { AppProviders } from './contexts/AppProviders';
import { SidebarLayout } from './components/SidebarLayout';
import { DashboardPage } from './components/DashboardPage';
import { AudioPage } from './components/AudioPage';
import { SettingsPage } from './components/SettingsPage';
import { EmbedAudioPage } from './components/EmbedAudioPage';
import { EmbedInputPage } from './components/EmbedInputPage';
import { EmbedSentLogPage } from './components/EmbedSentLogPage';
import { EmbedFileDropPage } from './components/EmbedFileDropPage';
import { EmbedFilesPage } from './components/EmbedFilesPage';
import { EmbedSettingsPage } from './components/EmbedSettingsPage';
import { EmbedRtmpPage } from './components/EmbedRtmpPage';
import { EmbedViewerPage } from './components/EmbedViewerPage';
import { LoginPage } from './components/LoginPage';
import { RegisterPage } from './components/RegisterPage';
import { ProjectsPage } from './components/ProjectsPage';
import { AccountPage } from './components/AccountPage';

// ─── Lazy-loaded pages (heavy or path-gated) ──────────────────────────────────

const BroadcastPage        = lazy(() => import('./components/BroadcastPage').then(m => ({ default: m.BroadcastPage })));
const DskEditorPage        = lazy(() => import('./components/DskEditorPage').then(m => ({ default: m.DskEditorPage })));
const DskViewportsPage     = lazy(() => import('./components/DskViewportsPage').then(m => ({ default: m.DskViewportsPage })));
const ProductionOperatorPage = lazy(() => import('./components/ProductionOperatorPage').then(m => ({ default: m.ProductionOperatorPage })));
const ProductionCamerasPage  = lazy(() => import('./components/ProductionCamerasPage').then(m => ({ default: m.ProductionCamerasPage })));
const ProductionMixersPage   = lazy(() => import('./components/ProductionMixersPage').then(m => ({ default: m.ProductionMixersPage })));
const ProductionBridgesPage  = lazy(() => import('./components/ProductionBridgesPage').then(m => ({ default: m.ProductionBridgesPage })));
const PlannerPage          = lazy(() => import('./components/PlannerPage').then(m => ({ default: m.PlannerPage })));
const SpeechCapturePage    = lazy(() => import('./components/SpeechCapturePage').then(m => ({ default: m.SpeechCapturePage })));
const DskPage              = lazy(() => import('./components/DskPage').then(m => ({ default: m.DskPage })));
const DskControlPage       = lazy(() => import('./components/DskControlPage').then(m => ({ default: m.DskControlPage })));
const ViewerPage           = lazy(() => import('./components/ViewerPage').then(m => ({ default: m.ViewerPage })));

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
  let page;
  if (path.startsWith('/mcp/')) {
    const sessionId = path.split('/')[2];
    page = <SpeechCapturePage sessionId={sessionId} />;
  } else if (path.startsWith('/embed/audio'))     page = <EmbedAudioPage />;
  else if (path.startsWith('/embed/input'))     page = <EmbedInputPage />;
  else if (path.startsWith('/embed/sentlog'))   page = <EmbedSentLogPage />;
  else if (path.startsWith('/embed/file-drop')) page = <EmbedFileDropPage />;
  else if (path.startsWith('/embed/files'))     page = <EmbedFilesPage />;
  else if (path.startsWith('/embed/settings'))  page = <EmbedSettingsPage />;
  else if (path.startsWith('/embed/rtmp'))      page = <EmbedRtmpPage />;
  else if (path.startsWith('/embed/viewer'))    page = <EmbedViewerPage />;
  else if (path.startsWith('/dsk-control/'))    page = <DskControlPage />;
  else if (path.startsWith('/dsk/'))            page = <DskPage />;
  else if (path.startsWith('/view/'))           page = <ViewerPage />;
  else if (path.startsWith('/login'))           page = <LoginPage />;
  else if (path.startsWith('/register'))        page = <RegisterPage />;
  else page = <SidebarApp />;
  return <Suspense fallback={null}>{page}</Suspense>;
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
          <Suspense fallback={null}>
          <Switch>
            <Route path="/" component={DashboardPage} />
            <Route path="/captions" component={AppLayout} />
            <Route path="/audio" component={AudioPage} />
            <Route path="/broadcast" component={BroadcastPage} />
            <Route path="/graphics/editor" component={DskEditorPage} />
            <Route path="/graphics/control" component={DskControlPage} />
            <Route path="/graphics/viewports" component={DskViewportsPage} />
            <Route path="/production/cameras" component={ProductionCamerasPage} />
            <Route path="/production/mixers" component={ProductionMixersPage} />
            <Route path="/production/bridges" component={ProductionBridgesPage} />
            <Route path="/production" component={ProductionOperatorPage} />
            <Route path="/planner" component={PlannerPage} />
            <Route path="/projects" component={ProjectsPage} />
            <Route path="/account" component={AccountPage} />
            <Route path="/settings" component={SettingsPage} />
            {/* Legacy URL aliases — redirect to sidebar equivalents */}
            <Route path="/dsk-editor"><Redirect to="/graphics/editor" /></Route>
            <Route path="/dsk-viewports"><Redirect to="/graphics/viewports" /></Route>
            {/* Fallback */}
            <Route><Redirect to="/" /></Route>
          </Switch>
          </Suspense>
        </SidebarLayout>
      </Router>
    </AppProviders>
  );
}

// ─── Entry point ──────────────────────────────────────────────────────────────

migrateStorageKeys();

const root = isStandalonePath(path)
  ? getStandalonePage()
  : <SidebarApp />;

createRoot(document.getElementById('app')).render(
  <StrictMode>
    {root}
  </StrictMode>
);

