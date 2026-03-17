import { useState, useEffect } from 'react';
import { useLocation, Link } from 'wouter';
import { useSessionContext } from '../contexts/SessionContext';
import { useToastContext } from '../contexts/ToastContext';

// ─── Mobile breakpoint ───────────────────────────────────────────────────────

const MOBILE_BREAKPOINT = 768;

function getSidebarExpanded() {
  try {
    const v = localStorage.getItem('lcyt.sidebar.expanded');
    if (v !== null) return v === 'true';
  } catch { /* ignore */ }
  return window.innerWidth > 1024;
}

function setSidebarExpanded(val) {
  try { localStorage.setItem('lcyt.sidebar.expanded', String(val)); } catch { /* ignore */ }
}

function getGroupOpen(name) {
  try {
    const v = localStorage.getItem(`lcyt.sidebar.${name}.open`);
    return v === 'true';
  } catch { return false; }
}

function setGroupOpen(name, val) {
  try { localStorage.setItem(`lcyt.sidebar.${name}.open`, String(val)); } catch { /* ignore */ }
}

// ─── Nav config ──────────────────────────────────────────────────────────────

const NAV_ITEMS = [
  { id: 'dashboard',  icon: '🏠', label: 'Dashboard',  path: '/',         exact: true },
  { id: 'captions',   icon: '✏️',  label: 'Captions',   path: '/captions' },
  { id: 'audio',      icon: '🎤', label: 'Audio',       path: '/audio' },
  { id: 'broadcast',  icon: '📡', label: 'Broadcast',   path: '/broadcast' },
];

const NAV_GROUPS = [
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
      { id: 'prod-cameras',  label: 'Cameras',  path: '/production/cameras' },
      { id: 'prod-mixers',   label: 'Mixers',   path: '/production/mixers' },
      { id: 'prod-bridges',  label: 'Bridges',  path: '/production/bridges' },
    ],
  },
];

const NAV_BOTTOM = [
  { id: 'projects', icon: '📁', label: 'Projects', path: '/projects' },
  { id: 'account',  icon: '👤', label: 'Account',  path: '/account' },
  { id: 'settings', icon: '⚙️',  label: 'Settings', path: '/settings' },
];

// ─── Connect button (top bar) ─────────────────────────────────────────────────

function ConnectButton() {
  const session = useSessionContext();
  const { showToast } = useToastContext();
  const [connecting, setConnecting] = useState(false);

  async function handleClick() {
    if (session.connected) {
      await session.disconnect();
      return;
    }
    const cfg = session.getPersistedConfig();
    if (!cfg.backendUrl || !cfg.apiKey) {
      // Navigate to settings; for now just show a toast
      showToast('Enter backend URL and API key in Settings first', 'warning');
      return;
    }
    setConnecting(true);
    try {
      await session.connect(cfg);
    } catch (err) {
      showToast(err?.message || 'Connection failed', 'error');
    } finally {
      setConnecting(false);
    }
  }

  const cls = [
    'top-bar__connect-btn',
    session.connected ? 'top-bar__connect-btn--connected' : '',
    connecting ? 'top-bar__connect-btn--connecting' : '',
  ].filter(Boolean).join(' ');

  return (
    <button className={cls} onClick={handleClick} disabled={connecting}>
      {connecting ? 'Connecting…' : session.connected ? 'Disconnect' : 'Connect'}
    </button>
  );
}

// ─── Health dot ───────────────────────────────────────────────────────────────

function HealthDot() {
  const { connected, healthStatus, backendUrl, sequence } = useSessionContext();

  let dotClass = 'top-bar__health-dot';
  let title = 'Not connected';
  if (connected) {
    dotClass += ' top-bar__health-dot--ok';
    title = `Connected to ${backendUrl} · seq #${sequence}`;
  } else if (healthStatus === 'ok') {
    dotClass += ' top-bar__health-dot--idle';
    title = `Reachable: ${backendUrl}`;
  } else if (healthStatus === 'unreachable') {
    dotClass += ' top-bar__health-dot--error';
    title = `Unreachable: ${backendUrl}`;
  }

  return <span className={dotClass} title={title} aria-label={title} />;
}

// ─── Top bar ──────────────────────────────────────────────────────────────────

function TopBar({ expanded, onToggle }) {
  const [, navigate] = useLocation();

  return (
    <div className="top-bar">
      <button
        className="top-bar__hamburger"
        onClick={onToggle}
        aria-label={expanded ? 'Collapse sidebar' : 'Expand sidebar'}
        title={expanded ? 'Collapse sidebar' : 'Expand sidebar'}
      >
        ≡
      </button>
      <button
        className="top-bar__brand"
        onClick={() => navigate('/')}
        aria-label="Go to Dashboard"
      >
        LCYT
      </button>
      <span className="top-bar__spacer" />
      <HealthDot />
      <ConnectButton />
    </div>
  );
}

// ─── Sidebar item ─────────────────────────────────────────────────────────────

function SidebarItem({ icon, label, path, exact, expanded, onClick }) {
  const [location] = useLocation();

  const isActive = exact
    ? location === path
    : location === path || location.startsWith(path + '/');

  return (
    <Link
      href={path}
      onClick={onClick}
      className={['sidebar__item', isActive ? 'sidebar__item--active' : ''].filter(Boolean).join(' ')}
      title={!expanded ? label : undefined}
    >
      <span className="sidebar__item-icon" aria-hidden="true">{icon}</span>
      {expanded && <span className="sidebar__item-label">{label}</span>}
    </Link>
  );
}

// ─── Sidebar group (collapsible sub-nav) ─────────────────────────────────────

function SidebarGroup({ group, expanded, onNavigate }) {
  const [location] = useLocation();
  const groupActive = group.items.some(
    item => location === item.path || location.startsWith(item.path + '/')
  );

  const [open, setOpen] = useState(() => getGroupOpen(group.id) || groupActive);

  // Auto-open when navigating to a child route
  useEffect(() => {
    if (groupActive && !open) {
      setOpen(true);
      setGroupOpen(group.id, true);
    }
  }, [groupActive, open, group.id]);

  function handleGroupClick() {
    if (!expanded) {
      // Collapsed mode: navigate to first sub-item
      onNavigate(group.items[0].path);
      return;
    }
    const next = !open;
    setOpen(next);
    setGroupOpen(group.id, next);
  }

  return (
    <div className={['sidebar__group', groupActive ? 'sidebar__group--active' : ''].filter(Boolean).join(' ')}>
      <button
        className="sidebar__group-header"
        onClick={handleGroupClick}
        title={!expanded ? group.label : undefined}
        aria-expanded={expanded ? open : undefined}
      >
        <span className="sidebar__item-icon" aria-hidden="true">{group.icon}</span>
        {expanded && (
          <>
            <span className="sidebar__item-label">{group.label}</span>
            <span className="sidebar__group-chevron" aria-hidden="true">
              {open ? '▾' : '▸'}
            </span>
          </>
        )}
      </button>
      {expanded && open && (
        <div className="sidebar__sub-items">
          {group.items.map(item => (
            <SidebarItem
              key={item.id}
              icon="·"
              label={item.label}
              path={item.path}
              expanded={expanded}
              onClick={onNavigate ? () => onNavigate(item.path) : undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────

function Sidebar({ expanded, onNavigate }) {
  return (
    <nav className={['sidebar', expanded ? 'sidebar--expanded' : 'sidebar--collapsed'].join(' ')} aria-label="Main navigation">
      <div className="sidebar__main">
        {NAV_ITEMS.map(item => (
          <SidebarItem key={item.id} {...item} expanded={expanded} onClick={onNavigate ? () => onNavigate(item.path) : undefined} />
        ))}
        {NAV_GROUPS.map(group => (
          <SidebarGroup key={group.id} group={group} expanded={expanded} onNavigate={onNavigate} />
        ))}
      </div>
      <div className="sidebar__divider" role="separator" />
      <div className="sidebar__bottom">
        {NAV_BOTTOM.map(item => (
          <SidebarItem key={item.id} {...item} expanded={expanded} onClick={onNavigate ? () => onNavigate(item.path) : undefined} />
        ))}
      </div>
    </nav>
  );
}

// ─── Mobile drawer overlay ────────────────────────────────────────────────────

function MobileDrawer({ open, onClose }) {
  const [, navigate] = useLocation();

  function handleNavigate(path) {
    navigate(path);
    onClose();
  }

  return (
    <>
      {open && (
        <div className="mobile-drawer-backdrop" onClick={onClose} aria-hidden="true" />
      )}
      <div
        className={['mobile-drawer', open ? 'mobile-drawer--open' : ''].filter(Boolean).join(' ')}
        aria-hidden={!open}
      >
        <Sidebar expanded={true} onNavigate={handleNavigate} />
      </div>
    </>
  );
}

// ─── SidebarLayout ────────────────────────────────────────────────────────────

export function SidebarLayout({ children }) {
  const [expanded, setExpanded] = useState(getSidebarExpanded);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const isMobile = () => window.innerWidth < MOBILE_BREAKPOINT;
  const [, navigate] = useLocation();

  function handleToggle() {
    if (isMobile()) {
      setMobileDrawerOpen(v => !v);
    } else {
      const next = !expanded;
      setExpanded(next);
      setSidebarExpanded(next);
    }
  }

  // Close drawer on resize to desktop
  useEffect(() => {
    function onResize() {
      if (window.innerWidth >= MOBILE_BREAKPOINT) {
        setMobileDrawerOpen(false);
      }
    }
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return (
    <div className="sidebar-shell">
      <TopBar expanded={expanded} onToggle={handleToggle} />
      <div className="sidebar-body">
        {/* Desktop sidebar */}
        <Sidebar expanded={expanded} onNavigate={path => navigate(path)} />
        {/* Mobile drawer */}
        <MobileDrawer open={mobileDrawerOpen} onClose={() => setMobileDrawerOpen(false)} />
        {/* Page content */}
        <div className="sidebar-content">
          {children}
        </div>
      </div>
    </div>
  );
}
