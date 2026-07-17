import { StrictMode, lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { Router, Route, Switch, Redirect } from 'wouter';
import { migrateStorageKeys } from './lib/storageKeys.js';
import 'shared-styles';
import './styles/reset.css';
import './styles/layout.css';
import './styles/sidebar.css';
import './styles/components.css';
import { AppLayout, App } from './App';
import { AppProviders } from './contexts/AppProviders';
import { AudioProvider } from './contexts/AudioContext';
import { SidebarLayout } from './components/SidebarLayout';
import { AudioPage } from './components/AudioPage';
import { RootRoute } from './components/RootRoute.jsx';

// --- Lazy-loaded pages (heavy or path-gated) ----------------------------------

// After a new deploy, a stale tab can still reference a JS chunk hash that no
// longer exists on the server, so the dynamic import 404s. Reload once to pick
// up the current index.html/asset manifest instead of leaving a broken page.
function lazyImport(loader) {
  return lazy(() =>
    loader().catch((err) => {
      const isChunkLoadError = /dynamically imported module|importing a module script failed/i.test(err?.message || '');
      if (isChunkLoadError) {
        const key = 'lcyt.chunkReloadAt';
        const last = Number(sessionStorage.getItem(key) || 0);
        if (Date.now() - last > 10000) {
          sessionStorage.setItem(key, String(Date.now()));
          window.location.reload();
          return new Promise(() => {}); // hold rendering while the reload happens
        }
      }
      throw err;
    })
  );
}

// Sidebar routes
const SettingsPage           = lazyImport(() => import('./components/SettingsPage').then(m => ({ default: m.SettingsPage })));
const ProjectsPage           = lazyImport(() => import('./components/ProjectsPage').then(m => ({ default: m.ProjectsPage })));
const ProjectSettingsPage    = lazyImport(() => import('./components/ProjectSettingsPage').then(m => ({ default: m.ProjectSettingsPage })));
const SetupWizardPage        = lazyImport(() => import('./components/setup-wizard/index.js').then(m => ({ default: m.SetupWizardPage })));
const SetupHubPage           = lazyImport(() => import('./components/setup-hub/SetupHubPage.jsx').then(m => ({ default: m.SetupHubPage })));
const SetupStandalonePage    = lazyImport(() => import('./components/setup-hub/SetupStandalonePage.jsx').then(m => ({ default: m.SetupStandalonePage })));
const TeamPage                = lazyImport(() => import('./components/TeamPage').then(m => ({ default: m.TeamPage })));
const AssetsPage              = lazyImport(() => import('./components/AssetsPage').then(m => ({ default: m.AssetsPage })));
const BroadcastsManager       = lazyImport(() => import('./components/BroadcastsManager').then(m => ({ default: m.BroadcastsManager })));
const StoredVideosManager     = lazyImport(() => import('./components/StoredVideosManager').then(m => ({ default: m.StoredVideosManager })));
const AccountPage            = lazyImport(() => import('./components/AccountPage').then(m => ({ default: m.AccountPage })));
const BroadcastPage          = lazyImport(() => import('./components/BroadcastPage').then(m => ({ default: m.BroadcastPage })));
const DskEditorPage          = lazyImport(() => import('./components/DskEditorPage').then(m => ({ default: m.DskEditorPage })));
const DskViewportsPage       = lazyImport(() => import('./components/DskViewportsPage').then(m => ({ default: m.DskViewportsPage })));
const ProductionOperatorPage = lazyImport(() => import('./components/ProductionOperatorPage').then(m => ({ default: m.ProductionOperatorPage })));
const ProductionCamerasPage  = lazyImport(() => import('./components/ProductionCamerasPage').then(m => ({ default: m.ProductionCamerasPage })));
const ProductionMixersPage   = lazyImport(() => import('./components/ProductionMixersPage').then(m => ({ default: m.ProductionMixersPage })));
const ProductionBridgesPage  = lazyImport(() => import('./components/ProductionBridgesPage').then(m => ({ default: m.ProductionBridgesPage })));
const ProductionDevicesPage  = lazyImport(() => import('./components/ProductionDevicesPage').then(m => ({ default: m.ProductionDevicesPage })));
const ProductionVisualPage   = lazyImport(() => import('./components/ProductionVisualPage').then(m => ({ default: m.ProductionVisualPage })));
const PlannerPage            = lazyImport(() => import('./components/PlannerPage').then(m => ({ default: m.PlannerPage })));
const TranslationsPage       = lazyImport(() => import('./components/TranslationsPage').then(m => ({ default: m.TranslationsPage })));
const AiSettingsPage         = lazyImport(() => import('./components/AiSettingsPage').then(m => ({ default: m.AiSettingsPage })));
const AdminUsersPage         = lazyImport(() => import('./components/AdminUsersPage').then(m => ({ default: m.AdminUsersPage })));
const AdminUserDetailPage    = lazyImport(() => import('./components/AdminUserDetailPage').then(m => ({ default: m.AdminUserDetailPage })));
const AdminProjectsPage      = lazyImport(() => import('./components/AdminProjectsPage').then(m => ({ default: m.AdminProjectsPage })));
const AdminProjectDetailPage = lazyImport(() => import('./components/AdminProjectDetailPage').then(m => ({ default: m.AdminProjectDetailPage })));
const AdminAuditLogPage      = lazyImport(() => import('./components/AdminAuditLogPage').then(m => ({ default: m.AdminAuditLogPage })));
const AdminMetricsPage       = lazyImport(() => import('./components/AdminMetricsPage').then(m => ({ default: m.AdminMetricsPage })));
const AdminAiModelsPage      = lazyImport(() => import('./components/AdminAiModelsPage.jsx').then(m => ({ default: m.AdminAiModelsPage })));
const AdminSiteFeaturesPage  = lazyImport(() => import('./components/AdminSiteFeaturesPage').then(m => ({ default: m.AdminSiteFeaturesPage })));
const AdminTeamsPage         = lazyImport(() => import('./components/AdminTeamsPage').then(m => ({ default: m.AdminTeamsPage })));

// Standalone / path-gated pages
const SpeechCapturePage      = lazyImport(() => import('./components/SpeechCapturePage').then(m => ({ default: m.SpeechCapturePage })));
const DskPage                = lazyImport(() => import('./components/DskPage').then(m => ({ default: m.DskPage })));
const DskControlPage         = lazyImport(() => import('./components/DskControlPage').then(m => ({ default: m.DskControlPage })));
const ViewerPage             = lazyImport(() => import('./components/ViewerPage').then(m => ({ default: m.ViewerPage })));
const LoginPage              = lazyImport(() => import('./components/LoginPage').then(m => ({ default: m.LoginPage })));
const RegisterPage           = lazyImport(() => import('./components/RegisterPage').then(m => ({ default: m.RegisterPage })));
const DeviceLoginPage        = lazyImport(() => import('./components/DeviceLoginPage').then(m => ({ default: m.DeviceLoginPage })));
const CameraStreamPage       = lazyImport(() => import('./components/CameraStreamPage').then(m => ({ default: m.CameraStreamPage })));
const LcytMixerPage          = lazyImport(() => import('./components/LcytMixerPage').then(m => ({ default: m.LcytMixerPage })));
const EmbedAudioPage         = lazyImport(() => import('./components/EmbedAudioPage').then(m => ({ default: m.EmbedAudioPage })));
const EmbedInputPage         = lazyImport(() => import('./components/EmbedInputPage').then(m => ({ default: m.EmbedInputPage })));
const EmbedSentLogPage       = lazyImport(() => import('./components/EmbedSentLogPage').then(m => ({ default: m.EmbedSentLogPage })));
const EmbedFileDropPage      = lazyImport(() => import('./components/EmbedFileDropPage').then(m => ({ default: m.EmbedFileDropPage })));
const EmbedFilesPage         = lazyImport(() => import('./components/EmbedFilesPage').then(m => ({ default: m.EmbedFilesPage })));
const EmbedSettingsPage      = lazyImport(() => import('./components/EmbedSettingsPage').then(m => ({ default: m.EmbedSettingsPage })));
const EmbedRtmpPage          = lazyImport(() => import('./components/EmbedRtmpPage').then(m => ({ default: m.EmbedRtmpPage })));
const EmbedViewerPage        = lazyImport(() => import('./components/EmbedViewerPage').then(m => ({ default: m.EmbedViewerPage })));

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
            <Route path="/" component={RootRoute} />
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
            <Route path="/production/visual" component={ProductionVisualPage} />
            <Route path="/production" component={ProductionOperatorPage} />
            <Route path="/planner" component={PlannerPage} />
            <Route path="/translations" component={TranslationsPage} />
            <Route path="/ai" component={AiSettingsPage} />
            <Route path="/admin/users/:id" component={AdminUserDetailPage} />
            <Route path="/admin/users" component={AdminUsersPage} />
            <Route path="/admin/projects/:key" component={AdminProjectDetailPage} />
            <Route path="/admin/projects" component={AdminProjectsPage} />
            <Route path="/admin/audit-log" component={AdminAuditLogPage} />
            <Route path="/admin/metrics" component={AdminMetricsPage} />
            <Route path="/admin/ai-models" component={AdminAiModelsPage} />
            <Route path="/admin/site-features" component={AdminSiteFeaturesPage} />
            <Route path="/admin/teams" component={AdminTeamsPage} />
            <Route path="/projects" component={ProjectsPage} />
            <Route path="/projects/:key" component={ProjectSettingsPage} />
            <Route path="/assets" component={AssetsPage} />
            <Route path="/broadcasts" component={BroadcastsManager} />
            <Route path="/videos" component={StoredVideosManager} />
            <Route path="/team" component={TeamPage} />
            <Route path="/setup" component={SetupHubPage} />
            <Route path="/setup/wizard" component={SetupWizardPage} />
            <Route path="/setup/:card/page" component={SetupStandalonePage} />
            <Route path="/setup/:card" component={SetupHubPage} />
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
