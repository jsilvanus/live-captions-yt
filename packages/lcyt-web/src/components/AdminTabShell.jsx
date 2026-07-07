import { useLocation } from 'wouter';

const TABS = [
  { id: 'users',         label: 'Users',         path: '/admin/users' },
  { id: 'projects',      label: 'Projects',      path: '/admin/projects' },
  { id: 'audit-log',     label: 'Audit Log',     path: '/admin/audit-log' },
  { id: 'ai-models',     label: 'AI Models',     path: '/admin/ai-models' },
  { id: 'site-features', label: 'Site Features', path: '/admin/site-features', stub: true },
  { id: 'teams',         label: 'Teams',         path: '/admin/teams',         stub: true },
];

/**
 * AdminTabShell — thin tab bar wrapping the existing admin pages
 * (Users/Projects/Audit Log) plus two new visible-but-stub tabs
 * (Site Features/Teams — no corresponding backend concept exists).
 *
 * Each Admin*Page component renders its own content as `children`, wrapped
 * in this shell so all five tabs are always visible and navigable.
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
            title={tab.stub ? 'Coming soon' : undefined}
          >
            {tab.label}
            {tab.stub && <span className="admin-tab-shell__soon">soon</span>}
          </button>
        ))}
      </div>
      <div className="admin-tab-shell__body">
        {children}
      </div>
    </div>
  );
}
