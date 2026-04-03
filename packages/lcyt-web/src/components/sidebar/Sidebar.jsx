import { useState, useEffect, useRef, useMemo } from 'react';
import { useLocation, Link } from 'wouter';
import { useSessionContext } from '../../contexts/SessionContext';
import { useToastContext } from '../../contexts/ToastContext';
import { StatusPopover } from './StatusPopover.jsx';
import { QuickActionsPopover } from './QuickActionsPopover.jsx';
import { NAV_ITEMS, NAV_GROUPS, NAV_BOTTOM } from './navConfig.js';
import { KEYS } from '../../lib/storageKeys.js';
import { readInputLang } from '../../lib/inputLang.js';

// ── localStorage helpers ────────────────────────────────────────────────────

export function getGroupOpen(name) {
  try {
    const v = localStorage.getItem(`lcyt.sidebar.${name}.open`);
    return v === 'true';
  } catch { return false; }
}

export function setGroupOpen(name, val) {
  try { localStorage.setItem(`lcyt.sidebar.${name}.open`, String(val)); } catch { /* ignore */ }
}

export function getShowAdvanced() {
  try { return localStorage.getItem('lcyt.sidebar.showAdvanced') === 'true'; } catch { return false; }
}

export function setShowAdvanced(val) {
  try { localStorage.setItem('lcyt.sidebar.showAdvanced', String(val)); } catch { /* ignore */ }
}

// ── ConnectButton ───────────────────────────────────────────────────────────

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

// ── HealthDot ───────────────────────────────────────────────────────────────

function HealthDot() {
  const { connected, healthStatus, latencyMs } = useSessionContext();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    function handler(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handler(e) { if (e.key === 'Escape') setOpen(false); }
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  let dotClass = 'top-bar__health-dot';
  let label = 'Not connected';
  if (connected) {
    dotClass += ' top-bar__health-dot--ok';
    label = `Connected${latencyMs != null ? ` · ${latencyMs}ms` : ''}`;
  } else if (healthStatus === 'ok') {
    dotClass += ' top-bar__health-dot--idle';
    label = `Reachable${latencyMs != null ? ` · ${latencyMs}ms` : ''}`;
  } else if (healthStatus === 'unreachable') {
    dotClass += ' top-bar__health-dot--error';
    label = 'Unreachable';
  }

  return (
    <div className="top-bar__health-wrap" ref={ref}>
      <button
        className={`${dotClass} top-bar__health-dot--btn`}
        title={label}
        aria-label={`Connection status: ${label}`}
        onClick={() => setOpen(o => !o)}
      />
      {open && <StatusPopover onClose={() => setOpen(false)} />}
    </div>
  );
}

// ── TopBarBadges ────────────────────────────────────────────────────────────
// Small status indicators in the topbar: active target count, language, batch.

function TopBarBadges() {
  const { connected } = useSessionContext();

  // Read live values from localStorage (refreshed each render; changes via
  // storage events handled by useEffect below).
  const [targets, setTargets] = useState(() => {
    try { return JSON.parse(localStorage.getItem(KEYS.targets.list) || '[]'); } catch { return []; }
  });
  const [inputLang, setInputLang] = useState(readInputLang);
  const [batchInterval, setBatchInterval] = useState(() => {
    try { return parseInt(localStorage.getItem(KEYS.captions.batchInterval) || '0', 10); } catch { return 0; }
  });

  useEffect(() => {
    function refresh() {
      try { setTargets(JSON.parse(localStorage.getItem(KEYS.targets.list) || '[]')); } catch { setTargets([]); }
      try { setBatchInterval(parseInt(localStorage.getItem(KEYS.captions.batchInterval) || '0', 10)); } catch { setBatchInterval(0); }
      setInputLang(readInputLang());
    }
    window.addEventListener('storage', refresh);
    window.addEventListener('lcyt:active-codes-changed', refresh);
    window.addEventListener(/* INPUT_LANG_EVENT */ 'lcyt:input-lang-changed', refresh);
    window.addEventListener('lcyt:settings-imported', refresh);
    return () => {
      window.removeEventListener('storage', refresh);
      window.removeEventListener('lcyt:active-codes-changed', refresh);
      window.removeEventListener('lcyt:input-lang-changed', refresh);
      window.removeEventListener('lcyt:settings-imported', refresh);
    };
  }, []);

  if (!connected) return null;

  const enabledTargets = targets.filter(t => t.enabled);
  const ytCount = enabledTargets.filter(t => t.type === 'youtube').length;
  const viewerCount = enabledTargets.filter(t => t.type === 'viewer').length;

  return (
    <div className="top-bar__badges" aria-label="Session status badges">
      {ytCount > 0 && (
        <span className="top-bar__badge top-bar__badge--yt" title={`${ytCount} YouTube target${ytCount !== 1 ? 's' : ''}`} aria-label={`${ytCount} YouTube targets`}>
          ▶ {ytCount}
        </span>
      )}
      {viewerCount > 0 && (
        <span className="top-bar__badge top-bar__badge--viewer" title={`${viewerCount} Viewer target${viewerCount !== 1 ? 's' : ''}`} aria-label={`${viewerCount} viewer targets`}>
          👁 {viewerCount}
        </span>
      )}
      {inputLang && (
        <span className="top-bar__badge top-bar__badge--lang" title={`Caption language: ${inputLang}`} aria-label={`Caption language: ${inputLang}`}>
          {inputLang}
        </span>
      )}
      {batchInterval > 0 && (
        <span className="top-bar__badge top-bar__badge--batch" title={`Batch mode: ${batchInterval}ms window`} aria-label={`Batch mode: ${batchInterval}ms`}>
          ⚡ {batchInterval}ms
        </span>
      )}
    </div>
  );
}

// ── TopBar ──────────────────────────────────────────────────────────────────

export function TopBar({ expanded, onToggle, onOpenCommandPalette, onOpenShortcuts }) {
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
      <TopBarBadges />
      <span className="top-bar__spacer" />
      <HealthDot />
      <QuickActionsPopover />
      {onOpenCommandPalette && (
        <button
          className="top-bar__icon-btn"
          onClick={onOpenCommandPalette}
          title="Command palette (Ctrl+K)"
          aria-label="Open command palette"
        >
          ⌘
        </button>
      )}
      {onOpenShortcuts && (
        <button
          className="top-bar__icon-btn"
          onClick={onOpenShortcuts}
          title="Keyboard shortcuts (?)"
          aria-label="Show keyboard shortcuts"
        >
          ?
        </button>
      )}
      <ConnectButton />
    </div>
  );
}

// ── SidebarItem ─────────────────────────────────────────────────────────────

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

// ── SidebarGroup ────────────────────────────────────────────────────────────

function SidebarGroup({ group, expanded, onNavigate }) {
  const [location] = useLocation();
  const groupActive = group.items.some(
    item => location === item.path || location.startsWith(item.path + '/')
  );

  const [open, setOpen] = useState(() => getGroupOpen(group.id) || groupActive);

  useEffect(() => {
    if (groupActive && !open) {
      setOpen(true);
      setGroupOpen(group.id, true);
    }
  }, [groupActive, open, group.id]);

  function handleGroupClick() {
    if (!expanded) {
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

// ── Sidebar ─────────────────────────────────────────────────────────────────

export function Sidebar({ expanded, onNavigate }) {
  const [showAdvanced, setShowAdvancedState] = useState(getShowAdvanced);
  const session = useSessionContext();
  const features = session.backendFeatures;

  // Filter nav items/groups based on backend features
  const visibleItems = useMemo(() => {
    if (!features) return NAV_ITEMS;
    return NAV_ITEMS.filter(item => !item.feature || features.includes(item.feature));
  }, [features]);

  const visibleGroups = useMemo(() => {
    if (!features) return NAV_GROUPS;
    return NAV_GROUPS.filter(group => !group.feature || features.includes(group.feature));
  }, [features]);

  const visibleBottom = useMemo(() => {
    if (!features) return NAV_BOTTOM;
    return NAV_BOTTOM.filter(item => !item.feature || features.includes(item.feature));
  }, [features]);

  function toggleAdvanced() {
    const next = !showAdvanced;
    setShowAdvancedState(next);
    setShowAdvanced(next);
  }

  return (
    <nav className={['sidebar', expanded ? 'sidebar--expanded' : 'sidebar--collapsed'].join(' ')} aria-label="Main navigation">
      <div className="sidebar__main">
        {visibleItems.map(item => (
          <SidebarItem key={item.id} {...item} expanded={expanded} onClick={onNavigate ? () => onNavigate(item.path) : undefined} />
        ))}
        {visibleGroups.map(group => (
          <SidebarGroup key={group.id} group={group} expanded={expanded} onNavigate={onNavigate} />
        ))}
        {showAdvanced && (
          <a
            href="/legacy"
            className="sidebar__item"
            title={!expanded ? 'Legacy' : undefined}
          >
            <span className="sidebar__item-icon" aria-hidden="true">⏮</span>
            {expanded && <span className="sidebar__item-label">Legacy</span>}
          </a>
        )}
      </div>
      <div className="sidebar__divider" role="separator" />
      <div className="sidebar__bottom">
        {visibleBottom.map(item => (
          <SidebarItem key={item.id} {...item} expanded={expanded} onClick={onNavigate ? () => onNavigate(item.path) : undefined} />
        ))}
        <button
          className="sidebar__item sidebar__item--btn"
          onClick={toggleAdvanced}
          title={expanded ? undefined : (showAdvanced ? 'Hide advanced' : 'Show advanced')}
        >
          <span className="sidebar__item-icon" aria-hidden="true">{showAdvanced ? '▴' : '▾'}</span>
          {expanded && <span className="sidebar__item-label sidebar__item-label--dim">{showAdvanced ? 'Less' : 'Advanced'}</span>}
        </button>
      </div>
    </nav>
  );
}
