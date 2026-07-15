// Icon set matches the Claude Design mockup (project 9919ac53, Sidebar.dc.html):
// 16x16 viewBox, stroke-based line icons, currentColor so they follow the
// item's text color (dim / active / hover) instead of carrying their own fill.

const SetupIcon = () => (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
    <rect x="1" y="6" width="4" height="4" rx="1" stroke="currentColor" strokeWidth="1.3" />
    <rect x="11" y="6" width="4" height="4" rx="1" stroke="currentColor" strokeWidth="1.3" />
    <rect x="6" y="3.5" width="4" height="9" rx="1" stroke="currentColor" strokeWidth="1.3" />
    <path d="M5 8H6M10 8H11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
  </svg>
);

const AssetsIcon = () => (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
    <path d="M8 2L14 5.5L8 9L2 5.5L8 2Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    <path d="M2 8.5L8 12L14 8.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const PlannerIcon = () => (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
    <path d="M2 4h12M2 8h8M2 12h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </svg>
);

const GraphicsIcon = () => (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
    <path d="M8 2L14 5L8 8L2 5L8 2Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    <path d="M2 8L8 11L14 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M2 11L8 14L14 11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" opacity="0.45" />
  </svg>
);

const BroadcastIcon = () => (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
    <circle cx="8" cy="9" r="1.5" fill="currentColor" />
    <path d="M5.5 7C5.5 7 4.5 7.8 4.5 9C4.5 10.2 5.5 11 5.5 11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    <path d="M10.5 7C10.5 7 11.5 7.8 11.5 9C11.5 10.2 10.5 11 10.5 11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    <path d="M3 4.5C3 4.5 1.5 6 1.5 9C1.5 12 3 13.5 3 13.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" opacity="0.45" />
    <path d="M13 4.5C13 4.5 14.5 6 14.5 9C14.5 12 13 13.5 13 13.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" opacity="0.45" />
    <line x1="8" y1="7.5" x2="8" y2="3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
  </svg>
);

const TeamIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <rect x="2" y="5" width="12" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
    <path d="M5.5 5V3.5A1.5 1.5 0 0 1 7 2h2a1.5 1.5 0 0 1 1.5 1.5V5" stroke="currentColor" strokeWidth="1.4" />
    <rect x="6" y="8.5" width="4" height="3" rx="0.5" fill="currentColor" opacity="0.65" />
  </svg>
);

const AdminIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <path d="M8 1.5L2 4V8C2 11.31 4.67 14.19 8 15C11.33 14.19 14 11.31 14 8V4L8 1.5Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    <path d="M5.5 8L7 9.5L10.5 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const AccountIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <circle cx="8" cy="5.5" r="2.5" stroke="currentColor" strokeWidth="1.4" />
    <path d="M2.5 14C2.5 11.24 5 9 8 9C11 9 13.5 11.24 13.5 14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </svg>
);

const ProjectIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <rect x="2" y="3" width="12" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
    <path d="M2 6H14M5 3V6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    <circle cx="6" cy="9.5" r="1.5" fill="currentColor" />
    <path d="M10 9.5H12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
  </svg>
);

const ProjectsIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <rect x="1" y="1" width="6" height="6" rx="1.5" fill="currentColor" />
    <rect x="9" y="1" width="6" height="6" rx="1.5" fill="currentColor" />
    <rect x="1" y="9" width="6" height="6" rx="1.5" fill="currentColor" />
    <rect x="9" y="9" width="6" height="6" rx="1.5" fill="currentColor" />
  </svg>
);

// Export ProjectIcon for use in Sidebar when a project is active
export { ProjectIcon };

// Order mirrors the Claude Design mockup's project nav (Setup, Assets,
// Planner, Graphics, Production) — see HIDDEN.md at the repo root for pages
// that were dropped from this list because they have no design counterpart
// yet.
export const NAV_ITEMS = [
  { id: 'setup',     icon: <SetupIcon />,     label: 'Setup',     path: '/setup' },
  { id: 'assets',    icon: <AssetsIcon />,    label: 'Assets',    path: '/assets',         feature: 'login' },
  { id: 'planner',   icon: <PlannerIcon />,   label: 'Planner',   path: '/planner' },
  { id: 'graphics',  icon: <GraphicsIcon />,  label: 'Graphics',  path: '/graphics/editor', feature: 'graphics' },
  { id: 'production', icon: <BroadcastIcon />, label: 'Production', path: '/production' },
];

// No sidebar groups remain — Graphics and Admin collapsed to single items
// (see HIDDEN.md), and Production was dropped entirely.
export const NAV_GROUPS = [];

// Bottom cluster order mirrors the mockup's Org → Admin → Profile stack,
// with Projects (the mockup's separate "no project selected" nav) placed
// above them.
export const NAV_BOTTOM = [
  { id: 'projects', icon: <ProjectsIcon />, label: 'Projects', path: '/projects',    feature: 'login' },
  { id: 'team',     icon: <TeamIcon />,     label: 'Team',     path: '/team',        feature: 'login' },
  { id: 'admin',    icon: <AdminIcon />,    label: 'Admin',    path: '/admin/users', feature: 'admin' },
  { id: 'account',  icon: <AccountIcon />,  label: 'Account',  path: '/account',     feature: 'login' },
];
