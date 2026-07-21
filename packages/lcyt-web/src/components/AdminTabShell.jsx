import { useLocation } from 'wouter';

// Base order (Site Features, Teams, Projects, Users) matches the Claude
// Design mockup's Admin tab bar. Metrics and Audit Log were added by
// plan_metering_audit (§2 decision 9: admin sub-navigation, not standalone
// sidebar items). AI Models keeps its route but stays out of the visible bar
// (reachable by direct URL — see HIDDEN.md).
const TABS = [
  { id: 'site-features', label: 'Site Features', path: '/admin/site-features' },
  { id: 'teams',         label: 'Teams',         path: '/admin/teams' },
  { id: 'projects',      label: 'Projects',      path: '/admin/projects' },
  { id: 'users',         label: 'Users',         path: '/admin/users' },
  { id: 'metrics',       label: 'Metrics',       path: '/admin/metrics' },
  { id: 'audit-log',     label: 'Audit Log',     path: '/admin/audit-log' },
  { id: 'server-settings', label: 'Server',      path: '/admin/server-settings' },
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
