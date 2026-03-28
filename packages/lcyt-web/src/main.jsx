import { StrictMode, lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { Router, Route, Switch, Redirect } from 'wouter';
import { migrateStorageKeys } from './lib/storageKeys.js';
import './styles/reset.css';
import './styles/layout.css';
import './styles/sidebar.css';
import './styles/components.css';
import { AppLayout, App } from './App';
import { AppProviders } from './contexts/AppProviders';
import { AudioProvider } from './contexts/AudioContext';
import { SidebarLayout } from './components/SidebarLayout';
import { AudioPage } from './components/AudioPage';

// --- Lazy-loaded pages (heavy or path-gated) ----------------------------------

// Sidebar routes
const DashboardPage          = lazy(() => import('./components/DashboardPage').then(m => ({ default: m.DashboardPage })));
const SettingsPage           = lazy(() => import('./components/SettingsPage').then(m => ({ default: m.SettingsPage })));
const ProjectsPage           = lazy(() => import('./components/ProjectsPage').then(m => ({ default: m.ProjectsPage })));
const SetupWizardPage        = lazy(() => import('./components/setup-wizard/index.js').then(m => ({ default: m.SetupWizardPage })));
const AccountPage            = lazy(() => import('./components/AccountPage').then(m => ({ default: m.AccountPage })));
const BroadcastPage          = lazy(() => import('./components/BroadcastPage').then(m => ({ default: m.BroadcastPage })));
const DskEditorPage          = lazy(() => import('./components/DskEditorPage').then(m => ({ default: m.DskEditorPage })));
const DskViewportsPage       = lazy(() => import('./components/DskViewportsPage').then(m => ({ default: m.DskViewportsPage })));
const ProductionOperatorPage = lazy(() => import('./components/ProductionOperatorPage').then(m => ({ default: m.ProductionOperatorPage })));
const ProductionCamerasPage  = lazy(() => import('./components/ProductionCamerasPage').then(m => ({ default: m.ProductionCamerasPage })));
const ProductionMixersPage   = lazy(() => import('./components/ProductionMixersPage').then(m => ({ default: m.ProductionMixersPage })));
const ProductionBridgesPage  = lazy(() => import('./components/ProductionBridgesPage').then(m => ({ default: m.ProductionBridgesPage })));
const ProductionDevicesPage  = lazy(() => import('./components/ProductionDevicesPage').then(m => ({ default: m.ProductionDevicesPage })));
const PlannerPage            = lazy(() => import('./components/PlannerPage').then(m => ({ default: m.PlannerPage })));
const TranslationsPage       = lazy(() => import('./components/TranslationsPage').then(m => ({ default: m.TranslationsPage })));
const AiSettingsPage         = lazy(() => import('./components/AiSettingsPage').then(m => ({ default: m.AiSettingsPage })));

// Standalone / path-gated pages
const SpeechCapturePage      = lazy(() => import('./components/SpeechCapturePage').then(m => ({ default: m.SpeechCapturePage })));
const DskPage                = lazy(() => import('./components/DskPage').then(m => ({ default: m.DskPage })));
const DskControlPage         = lazy(() => import('./components/DskControlPage').then(m => ({ default: m.DskControlPage })));
const ViewerPage             = lazy(() => import('./components/ViewerPage').then(m => ({ default: m.ViewerPage })));
const LoginPage              = lazy(() => import('./components/LoginPage').then(m => ({ default: m.LoginPage })));
const RegisterPage           = lazy(() => import('./components/RegisterPage').then(m => ({ default: m.RegisterPage })));
const DeviceLoginPage        = lazy(() => import('./components/DeviceLoginPage').then(m => ({ default: m.DeviceLoginPage })));
const CameraStreamPage       = lazy(() => import('./components/CameraStreamPage').then(m => ({ default: m.CameraStreamPage })));
const LcytMixerPage          = lazy(() => import('./components/LcytMixerPage').then(m => ({ default: m.LcytMixerPage })));
const EmbedAudioPage         = lazy(() => import('./components/EmbedAudioPage').then(m => ({ default: m.EmbedAudioPage })));
const EmbedInputPage         = lazy(() => import('./components/EmbedInputPage').then(m => ({ default: m.EmbedInputPage })));
const EmbedSentLogPage       = lazy(() => import('./components/EmbedSentLogPage').then(m => ({ default: m.EmbedSentLogPage })));
const EmbedFileDropPage      = lazy(() => import('./components/EmbedFileDropPage').then(m => ({ default: m.EmbedFileDropPage })));
const EmbedFilesPage         = lazy(() => import('./components/EmbedFilesPage').then(m => ({ default: m.EmbedFilesPage })));
const EmbedSettingsPage      = lazy(() => import('./components/EmbedSettingsPage').then(m => ({ default: m.EmbedSettingsPage })));
const EmbedRtmpPage          = lazy(() => import('./components/EmbedRtmpPage').then(m => ({ default: m.EmbedRtmpPage })));
const EmbedViewerPage        = lazy(() => import('./components/EmbedViewerPage').then(m => ({ default: m.EmbedViewerPage })));

const path = window.location.pathname;

// --- Auth gate (synchronous localStorage check) --------------------------------

function AuthGate({ children }) {
  const hasAuth = (() => {
    try {
      // Mode 1: User login (backend with login feature)
      const raw = localStorage.getItem('lcyt-user');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.token && parsed?.backendUrl) return true;
      }
      // Mode 2: Minimal backend (no login feature — session config + features)
      const featuresRaw = localStorage.getItem('lcyt.backend.features');
      if (featuresRaw) {
        const features = JSON.parse(featuresRaw);
        if (Array.isArray(features) && !features.includes('login')) {
          const cfg = JSON.parse(localStorage.getItem('lcyt.session.config') || '{}');
          if (cfg.backendUrl && cfg.apiKey) return true;
        }
      }
      return false;
    } catch {
      return false;
    }
  })();
  if (!hasAuth) {
    window.location.replace('/login');
    return null;
  }
  return children;
}

// --- Standalone pages (no sidebar, no shared session context) -----------------

function isStandalonePath(p) {
  return (
    p.startsWith('/mcp/') ||
    p.startsWith('/embed/') ||
    p.startsWith('/dsk/') ||
    p.startsWith('/dsk-control/') ||
    p.startsWith('/view/') ||
    p.startsWith('/login') ||
    p.startsWith('/register') ||
    p.startsWith('/device-login') ||
    p.startsWith('/legacy') ||
    p.startsWith('/production/camera/') ||
    p.startsWith('/production/lcyt-mixer/')
  );
}

function getStandalonePage() {
  let page;
  if (path.startsWith('/mcp/')) {
    const sessionId = path.split('/')[2];
    page = <SpeechCapturePage sessionId={sessionId} />;
  } else if (path.startsWith('/embed/audio'))     page = <EmbedAudioPage />;
  else if (path.startsWith('/embed/input'))        page = <EmbedInputPage />;
  else if (path.startsWith('/embed/sentlog'))      page = <EmbedSentLogPage />;
  else if (path.startsWith('/embed/file-drop'))    page = <EmbedFileDropPage />;
  else if (path.startsWith('/embed/files'))        page = <EmbedFilesPage />;
  else if (path.startsWith('/embed/settings'))     page = <EmbedSettingsPage />;
  else if (path.startsWith('/embed/rtmp'))         page = <EmbedRtmpPage />;
  else if (path.startsWith('/embed/viewer'))       page = <EmbedViewerPage />;
  else if (path.startsWith('/dsk-control/'))       page = <DskControlPage />;
  else if (path.startsWith('/dsk/'))               page = <DskPage />;
  else if (path.startsWith('/view/'))                    page = <ViewerPage />;
  else if (path.startsWith('/login'))                    page = <LoginPage />;
  else if (path.startsWith('/register'))                 page = <RegisterPage />;
  else if (path.startsWith('/device-login'))             page = <DeviceLoginPage />;
  else if (path.startsWith('/production/camera/'))       page = <CameraStreamPage />;
  else if (path.startsWith('/production/lcyt-mixer/'))   page = <LcytMixerPage />;
  else if (path.startsWith('/legacy'))                   page = <App />;
  else page = <SidebarApp />;
  return <Suspense fallback={null}>{page}</Suspense>;
}

// --- Stub page for routes not yet fully implemented ---------------------------

function StubPage({ icon, title, description }) {
  return (
    <div className="stub-page">
      <div className="stub-page__icon">{icon}</div>
      <div className="stub-page__title">{title}</div>
      <p className="stub-page__desc">{description || 'This page is coming soon.'}</p>
    </div>
  );
}

// --- Main sidebar app ---------------------------------------------------------

function SidebarApp() {
  return (
    <AppProviders>
      <AudioProvider>
      <Router>
        <SidebarLayout>
          <Suspense fallback={null}>
          <Switch>
            <Route path="/" component={DashboardPage} />
            <Route path="/captions">{() => <AppLayout standalone={false} />}</Route>
            <Route path="/audio" component={AudioPage} />
            <Route path="/broadcast" component={BroadcastPage} />
            <Route path="/graphics/editor" component={DskEditorPage} />
            <Route path="/graphics/control" component={DskControlPage} />
            <Route path="/graphics/viewports" component={DskViewportsPage} />
            <Route path="/production/cameras" component={ProductionCamerasPage} />
            <Route path="/production/mixers" component={ProductionMixersPage} />
            <Route path="/production/bridges" component={ProductionBridgesPage} />
            <Route path="/production/devices" component={ProductionDevicesPage} />
            <Route path="/production" component={ProductionOperatorPage} />
            <Route path="/planner" component={PlannerPage} />
            <Route path="/translations" component={TranslationsPage} />
            <Route path="/ai" component={AiSettingsPage} />
            <Route path="/projects" component={ProjectsPage} />
            <Route path="/setup" component={SetupWizardPage} />
            <Route path="/account" component={AccountPage} />
            <Route path="/settings" component={SettingsPage} />
            {/* Legacy URL aliases */}
            <Route path="/dsk-editor"><Redirect to="/graphics/editor" /></Route>
            <Route path="/dsk-viewports"><Redirect to="/graphics/viewports" /></Route>
            {/* Fallback */}
            <Route><Redirect to="/" /></Route>
          </Switch>
          </Suspense>
        </SidebarLayout>
      </Router>
      </AudioProvider>
    </AppProviders>
  );
}

// --- Entry point --------------------------------------------------------------

migrateStorageKeys();

const root = isStandalonePath(path)
  ? getStandalonePage()
  : <AuthGate><SidebarApp /></AuthGate>;

createRoot(document.getElementById('app')).render(
  <StrictMode>
    {root}
  </StrictMode>
);
