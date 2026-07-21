import { lazy, Suspense } from 'react';
import { Redirect } from 'wouter';
import { useSessionContext } from '../contexts/SessionContext';
import { hasProjectSessionConfig } from '../lib/projectSession.js';
import { OnboardingBanner } from './OnboardingBanner.jsx';

// Mirrors main.jsx's lazyImport() chunk-reload-on-stale-deploy behavior,
// duplicated locally (rather than imported from main.jsx) so this module has
// no dependency on the entry file's bootstrap side effects.
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
          return new Promise(() => {});
        }
      }
      throw err;
    })
  );
}

const ProjectSettingsPage = lazyImport(() => import('./ProjectSettingsPage.jsx').then(m => ({ default: m.ProjectSettingsPage })));
const LiveTab             = lazyImport(() => import('./broadcast/LiveTab.jsx').then(m => ({ default: m.LiveTab })));

/**
 * RootRoute — resolves what `/` shows (see
 * docs/plans/plan_dashboard_console_redesign.md "Routing model"):
 *   - An active project (connected OR persisted)   → that project's summary view
 *     (ProjectSettingsPage, implicit key, Summary tab by default).
 *   - No active project + `login` feature → redirect to /projects (pick one).
 *   - No active project + no `login` feature (minimal-mode backend, or
 *     backend features not yet resolved) → the Live operate console
 *     directly, since there's no multi-project concept to summarize.
 */
export function RootRoute() {
  const { connected, apiKey, projectId, backendFeatures, getPersistedConfig } = useSessionContext();
  const persistedCfg = getPersistedConfig();
  const hasPersistedProject = hasProjectSessionConfig(persistedCfg);

  // Check both session state and persisted config for credentials
  const hasCredentials = (apiKey || projectId) || (persistedCfg?.apiKey || persistedCfg?.projectId);

  // Show project summary if connected OR if a project is persisted (auto-connect pending).
  if ((connected || hasPersistedProject) && hasCredentials) {
    return (
      <Suspense fallback={null}>
        <OnboardingBanner />
        <ProjectSettingsPage implicitKey />
      </Suspense>
    );
  }
  if (backendFeatures && backendFeatures.includes('login')) {
    return <Redirect to="/projects" />;
  }
  return (
    <Suspense fallback={null}>
      <LiveTab />
    </Suspense>
  );
}
