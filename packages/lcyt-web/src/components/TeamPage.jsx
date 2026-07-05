/**
 * TeamPage — `/team`. A deliberate single-screen placeholder, not a real
 * feature (see docs/plans/plan_dashboard_console_redesign.md, Decision 5).
 *
 * There is no organization/team data model in the backend today — all
 * membership is per-project (`project_members`). Real team/org functionality
 * (an org identity spanning multiple projects, shared membership/roles,
 * org-wide defaults) is planned as its own future feature; building a
 * throwaway cross-project membership aggregation now would be wasted work
 * once that lands. This page intentionally has no tabs and no aggregation
 * logic — just an explanation and a link to today's way to manage
 * collaborators (the per-project Team tab in ProjectSettingsPage).
 */
import { useSessionContext } from '../contexts/SessionContext';

export function TeamPage() {
  const { connected } = useSessionContext();

  return (
    <div className="stub-page">
      <div className="stub-page__icon">👥</div>
      <div className="stub-page__title">Team management is coming soon</div>
      <p className="stub-page__desc">
        We're planning a proper organization/team layer: an identity that
        spans multiple projects, shared membership and roles, and org-wide
        defaults. Today, every project manages its own members
        independently.
      </p>
      <p className="stub-page__desc">
        In the meantime, manage collaborators from{' '}
        <a href={connected ? '/' : '/projects'}>
          your project's Team tab
        </a>.
      </p>
    </div>
  );
}
