import { useSessionContext } from '../contexts/SessionContext';
import { useUserAuth } from '../hooks/useUserAuth';
import { AdminKeyGate } from './AdminKeyGate.jsx';
import { AdminTabShell } from './AdminTabShell.jsx';

/**
 * AdminSiteFeaturesPage — `/admin/site-features`. Visible-but-stub tab: there
 * is no global (cross-project) feature-flag concept in the backend today —
 * feature flags are always scoped to a project (`project_features`) or a
 * user (`user_features`). A site-wide flag system is a real gap, not
 * something to fake here.
 */
export function AdminSiteFeaturesPage() {
  const session = useSessionContext();
  const backendUrl = session.backendUrl;
  const { user } = useUserAuth();

  return (
    <AdminKeyGate backendUrl={backendUrl} userIsAdmin={!!user?.isAdmin}>
      <AdminTabShell active="site-features">
        <div className="stub-page">
          <div className="stub-page__icon">🚩</div>
          <div className="stub-page__title">Site-wide feature flags are coming soon</div>
          <p className="stub-page__desc">
            Today, feature flags are always scoped to a project or a user —
            there's no global, cross-project flag concept in the backend yet.
            Manage per-project features from a project's Features tab, or
            per-user entitlements from Admin → Users → a user's detail page.
          </p>
        </div>
      </AdminTabShell>
    </AdminKeyGate>
  );
}
