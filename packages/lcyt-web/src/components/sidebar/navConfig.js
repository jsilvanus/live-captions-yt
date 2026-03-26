export const NAV_ITEMS = [
  { id: 'dashboard',    icon: '🏠', label: 'Dashboard',    path: '/',              exact: true },
  { id: 'captions',     icon: '✏️',  label: 'Captions',     path: '/captions' },
  { id: 'audio',        icon: '🎤', label: 'Audio',         path: '/audio' },
  { id: 'translations', icon: '🌐', label: 'Translations',  path: '/translations' },
  { id: 'broadcast',    icon: '📡', label: 'Broadcast',     path: '/broadcast' },
  { id: 'planner',      icon: '📋', label: 'Planner',       path: '/planner' },
];

export const NAV_GROUPS = [
  {
    id: 'graphics',
    icon: '🖼️',
    label: 'Graphics',
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
    items: [
      { id: 'prod-operator', label: 'Operator', path: '/production' },
      { id: 'prod-devices',  label: 'Devices',  path: '/production/devices' },
    ],
  },
];

export const NAV_BOTTOM = [
  { id: 'projects', icon: '📁', label: 'Projects', path: '/projects' },
  { id: 'account',  icon: '👤', label: 'Account',  path: '/account' },
  { id: 'settings', icon: '⚙️',  label: 'Settings', path: '/settings' },
];
