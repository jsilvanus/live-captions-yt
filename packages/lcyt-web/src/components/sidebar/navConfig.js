export const NAV_ITEMS = [
  { id: 'dashboard',    icon: '🏠', label: 'Dashboard',    path: '/',              exact: true },
  { id: 'captions',     icon: '✏️',  label: 'Captions',     path: '/captions' },
  { id: 'audio',        icon: '🎤', label: 'Audio',         path: '/audio' },
  { id: 'translations', icon: '🌐', label: 'Translations',  path: '/translations' },
  { id: 'broadcast',    icon: '📡', label: 'Broadcast',     path: '/broadcast',     feature: 'rtmp' },
  { id: 'planner',      icon: '📋', label: 'Planner',       path: '/planner' },
];

export const NAV_GROUPS = [
  {
    id: 'graphics',
    icon: '🖼️',
    label: 'Graphics',
    feature: 'graphics',
    items: [
      { id: 'dsk-editor',    label: 'Editor',    path: '/graphics/editor' },
      { id: 'dsk-control',   label: 'Control',   path: '/graphics/control' },
      { id: 'dsk-viewports', label: 'Viewports', path: '/graphics/viewports' },
    ],
  },
  {
    id: 'production',
    icon: '🎬',
    label: 'Production',
    feature: 'production',
    items: [
      { id: 'prod-operator', label: 'Operator', path: '/production', exact: true },
      { id: 'prod-visual',   label: 'Visual',   path: '/production/visual' },
      { id: 'prod-devices',  label: 'Devices',  path: '/production/devices' },
    ],
  },
  {
    id: 'admin',
    icon: '🛡️',
    label: 'Admin',
    feature: 'admin',
    items: [
      { id: 'admin-users',     label: 'Users',     path: '/admin/users' },
      { id: 'admin-projects',  label: 'Projects',  path: '/admin/projects' },
      { id: 'admin-audit-log', label: 'Audit Log', path: '/admin/audit-log' },
    ],
  },
];

export const NAV_BOTTOM = [
  { id: 'ai',       icon: '🤖', label: 'AI',       path: '/ai',       feature: 'ai' },
  { id: 'projects', icon: '📁', label: 'Projects', path: '/projects', feature: 'login' },
  { id: 'account',  icon: '👤', label: 'Account',  path: '/account',  feature: 'login' },
  { id: 'setup',    icon: '🧙', label: 'Setup',    path: '/setup' },
  { id: 'settings', icon: '⚙️',  label: 'Settings', path: '/settings' },
];
