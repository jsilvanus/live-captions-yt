import { useSessionContext } from '../contexts/SessionContext';
import { useUserAuth } from '../hooks/useUserAuth';
import { AdminKeyGate } from './AdminKeyGate.jsx';
import { AdminTabShell } from './AdminTabShell.jsx';

/**
 * AdminTeamsPage — `/admin/teams`. Visible-but-stub tab, consistent with the
 * user-facing /team placeholder (see TeamPage.jsx and Decision 5 in
 * docs/plans/plan_dashboard_console_redesign.md): no org/team data model
 * exists in the backend, so there is nothing for an admin view to manage
 * yet. No cross-project aggregation logic is built here.
 */
export function AdminTeamsPage() {
  const session = useSessionContext();
  const backendUrl = session.backendUrl;
  const { user } = useUserAuth();

  return (
    <AdminKeyGate backendUrl={backendUrl} userIsAdmin={!!user?.isAdmin}>
      <AdminTabShell active="teams">
        <div className="stub-page">
          <div className="stub-page__icon">👥</div>
          <div className="stub-page__title">Org/team administration is coming soon</div>
          <p className="stub-page__desc">
            There is no organization/team data model in the backend today —
            all membership is per-project. Manage project membership from
            Admin → Projects → a project's detail page in the meantime.
          </p>
        </div>
      </AdminTabShell>
    </AdminKeyGate>
  );
}
