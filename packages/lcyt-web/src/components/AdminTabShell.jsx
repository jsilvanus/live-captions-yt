import { useLocation } from 'wouter';

// Matches the Claude Design mockup's Admin tab bar exactly (Site Features,
// Teams, Projects, Users — in this order). Audit Log and AI Models have no
// counterpart there; they keep their routes/components but are no longer
// part of this visible tab bar (still reachable by direct URL — see
// HIDDEN.md), same convention as every other page removed from sidebar nav.
const TABS = [
  { id: 'site-features', label: 'Site Features', path: '/admin/site-features' },
  { id: 'teams',         label: 'Teams',         path: '/admin/teams' },
  { id: 'projects',      label: 'Projects',      path: '/admin/projects' },
  { id: 'users',         label: 'Users',         path: '/admin/users' },
];

/**
 * AdminTabShell — thin tab bar wrapping the Admin*Page components. Each
 * Admin*Page renders its own content as `children`, wrapped in this shell so
 * all four tabs are always visible and navigable.
 */
export function AdminTabShell({ active, children }) {
  const [, navigate] = useLocation();

  return (
    <div className="admin-tab-shell">
      <div className="settings-modal__tabs admin-tab-shell__tabs">
        {TABS.map(tab => (
          <button
            key={tab.id}
            className={`settings-tab${active === tab.id ? ' settings-tab--active' : ''}`}
            onClick={() => navigate(tab.path)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="admin-tab-shell__body">
        {children}
      </div>
    </div>
  );
}
