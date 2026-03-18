import { useState, useEffect, useRef } from 'react';
import { useLocation, Link } from 'wouter';
import { useSessionContext } from '../contexts/SessionContext';
import { useToastContext } from '../contexts/ToastContext';
import { useLang } from '../contexts/LangContext';
import { COMMON_LANGUAGES } from '../lib/sttConfig';
import { getActiveCodes, setActiveCode, clearActiveCode } from '../lib/activeCodes';
import { readInputLang, writeInputLang, INPUT_LANG_EVENT } from '../lib/inputLang';
import { KEYS } from '../lib/storageKeys.js';
import { ControlsPanel } from './ControlsPanel';

// ─── Mobile breakpoint ───────────────────────────────────────────────────────

const MOBILE_BREAKPOINT = 768;

function getShowAdvanced() {
  try { return localStorage.getItem('lcyt.sidebar.showAdvanced') === 'true'; } catch { return false; }
}

function setShowAdvanced(val) {
  try { localStorage.setItem('lcyt.sidebar.showAdvanced', String(val)); } catch { /* ignore */ }
}

function getSidebarExpanded() {
  try {
    const v = localStorage.getItem(KEYS.ui.sidebarExpanded);
    if (v !== null) return v === 'true';
  } catch { /* ignore */ }
  return window.innerWidth > 1024;
}

function setSidebarExpanded(val) {
  try { localStorage.setItem(KEYS.ui.sidebarExpanded, String(val)); } catch { /* ignore */ }
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

// ─── Uptime formatter ─────────────────────────────────────────────────────────

function formatUptime(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

// ─── Nav config ──────────────────────────────────────────────────────────────

const NAV_ITEMS = [
  { id: 'dashboard',  icon: '🏠', label: 'Dashboard',  path: '/',         exact: true },
  { id: 'captions',   icon: '✏️',  label: 'Captions',   path: '/captions' },
  { id: 'audio',      icon: '🎤', label: 'Audio',       path: '/audio' },
  { id: 'broadcast',  icon: '📡', label: 'Broadcast',   path: '/broadcast' },
  { id: 'planner',    icon: '📋', label: 'Planner',     path: '/planner' },
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

// ─── Status popover ───────────────────────────────────────────────────────────

function StatusPopover({ onClose }) {
  const { connected, healthStatus, backendUrl, sequence, syncOffset, startedAt, latencyMs } = useSessionContext();

  const targets = (() => {
    try { return JSON.parse(localStorage.getItem(KEYS.targets.list) || '[]'); } catch { return []; }
  })();
  const batchInterval = (() => {
    try { return parseInt(localStorage.getItem(KEYS.captions.batchInterval) || '0', 10); } catch { return 0; }
  })();
  const translations = (() => {
    try { return JSON.parse(localStorage.getItem(KEYS.translation.list) || '[]'); } catch { return []; }
  })();

  const enabledTargets = targets.filter(t => t.enabled);
  const ytTargets = enabledTargets.filter(t => t.type === 'youtube');
  const viewerTargets = enabledTargets.filter(t => t.type === 'viewer');
  const genericTargets = enabledTargets.filter(t => t.type === 'generic');
  const enabledTranslations = translations.filter(t => t.enabled);

  const uptimeStr = startedAt ? formatUptime(Date.now() - new Date(startedAt).getTime()) : null;

  return (
    <div className="status-popover">
      <div className="status-popover__section">
        <div className="status-popover__label">Backend</div>
        <div className={`status-popover__value status-popover__value--${connected ? 'ok' : healthStatus}`}>
          {connected ? 'Connected' : healthStatus === 'ok' ? 'Reachable' : healthStatus === 'unreachable' ? 'Unreachable' : 'Unknown'}
          {latencyMs != null && <span className="status-popover__latency"> {latencyMs}ms</span>}
        </div>
        {backendUrl && <div className="status-popover__sub">{backendUrl}</div>}
      </div>

      {connected && (
        <div className="status-popover__section">
          <div className="status-popover__label">Session</div>
          <div className="status-popover__value">seq #{sequence}</div>
          {syncOffset !== 0 && <div className="status-popover__sub">offset {syncOffset > 0 ? '+' : ''}{syncOffset}ms</div>}
          {uptimeStr && <div className="status-popover__sub">up {uptimeStr}</div>}
        </div>
      )}

      {enabledTargets.length > 0 && (
        <div className="status-popover__section">
          <div className="status-popover__label">Targets</div>
          {ytTargets.length > 0 && <div className="status-popover__value" aria-label={`YouTube targets: ${ytTargets.length}`}><span aria-hidden="true">▶</span> YouTube ×{ytTargets.length}</div>}
          {viewerTargets.length > 0 && <div className="status-popover__value" aria-label={`Viewer targets: ${viewerTargets.length}`}><span aria-hidden="true">👁</span> Viewer ×{viewerTargets.length}</div>}
          {genericTargets.length > 0 && <div className="status-popover__value" aria-label={`Generic targets: ${genericTargets.length}`}><span aria-hidden="true">⚡</span> Generic ×{genericTargets.length}</div>}
        </div>
      )}

      {batchInterval > 0 && (
        <div className="status-popover__section">
          <div className="status-popover__label">Batch</div>
          <div className="status-popover__value">On · {batchInterval}ms window</div>
        </div>
      )}

      {enabledTranslations.length > 0 && (
        <div className="status-popover__section">
          <div className="status-popover__label">Translations</div>
          <div className="status-popover__value">{enabledTranslations.map(t => t.lang).join(', ')}</div>
        </div>
      )}
    </div>
  );
}

// ─── Health dot ───────────────────────────────────────────────────────────────

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

// ─── Quick Actions Popover ────────────────────────────────────────────────────

function QuickActionsPopover() {
  const session = useSessionContext();
  const { showToast } = useToastContext();
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const [controlsOpen, setControlsOpen] = useState(false);
  const [customSequence, setCustomSequence] = useState(0);
  const [hbResult, setHbResult] = useState(null);
  const [syncResult, setSyncResult] = useState(null);
  const [inputLang, setInputLang] = useState(readInputLang);
  const [activeCodes, setActiveCodesState] = useState(getActiveCodes);
  const [langPickerOpen, setLangPickerOpen] = useState(false);
  const [langQuery, setLangQuery] = useState('');
  const popoverRef = useRef(null);

  useEffect(() => {
    function onLangChange() { setInputLang(readInputLang()); }
    function onCodesChange() { setActiveCodesState(getActiveCodes()); }
    window.addEventListener(INPUT_LANG_EVENT, onLangChange);
    window.addEventListener('lcyt:active-codes-changed', onCodesChange);
    return () => {
      window.removeEventListener(INPUT_LANG_EVENT, onLangChange);
      window.removeEventListener('lcyt:active-codes-changed', onCodesChange);
    };
  }, []);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function onDown(e) {
      if (popoverRef.current && !popoverRef.current.contains(e.target)) {
        setOpen(false);
        setLangPickerOpen(false);
      }
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  async function handleSync() {
    if (!session.connected) { showToast('Not connected', 'warning'); return; }
    try {
      const data = await session.sync();
      setSyncResult(`+${data.syncOffset}ms`);
    } catch (err) { showToast(err.message, 'error'); }
  }

  async function handleHeartbeat() {
    if (!session.connected) { showToast('Not connected', 'warning'); return; }
    try {
      const data = await session.heartbeat();
      setHbResult(`${data.roundTripTime}ms`);
    } catch (err) { showToast(err.message, 'error'); }
  }

  async function handleResetSequence() {
    if (!session.connected) { showToast('Not connected', 'warning'); return; }
    try { await session.updateSequence(0); showToast('Sequence reset to 0', 'success'); } catch (err) { showToast(err.message, 'error'); }
  }

  async function handleSetSequence() {
    if (!session.connected) { showToast('Not connected', 'warning'); return; }
    try { await session.updateSequence(customSequence); showToast(`Sequence set to ${customSequence}`, 'success'); } catch (err) { showToast(err.message, 'error'); }
  }

  function selectLang(code) {
    writeInputLang(code);
    setInputLang(code);
    setLangPickerOpen(false);
    setLangQuery('');
    window.dispatchEvent(new Event(INPUT_LANG_EVENT));
  }

  function handleLangBtn() {
    if (inputLang) { writeInputLang(''); setInputLang(''); window.dispatchEvent(new Event(INPUT_LANG_EVENT)); }
    else setLangPickerOpen(v => !v);
  }

  function toggleNoTranslate() {
    setActiveCode('no-translate', activeCodes['no-translate'] ? null : true);
  }

  const langMatches = langQuery.trim().length > 0
    ? COMMON_LANGUAGES.filter(l =>
        l.label.toLowerCase().includes(langQuery.toLowerCase()) ||
        l.code.toLowerCase().includes(langQuery.toLowerCase()))
    : COMMON_LANGUAGES.slice(0, 12);

  const langLabel = inputLang
    ? (COMMON_LANGUAGES.find(l => l.code === inputLang)?.code ?? inputLang)
    : 'Lang';

  const customCodeKeys = Object.entries(activeCodes).filter(([k]) => k !== 'no-translate');
  const hasActiveCodes = inputLang || activeCodes['no-translate'] || customCodeKeys.length > 0;

  return (
    <div className="quick-actions" ref={popoverRef}>
      <button
        className={['quick-actions__btn', open ? 'quick-actions__btn--open' : '', hasActiveCodes ? 'quick-actions__btn--codes' : ''].filter(Boolean).join(' ')}
        onClick={() => setOpen(v => !v)}
        title="Quick Actions"
        aria-expanded={open}
        aria-haspopup="true"
      >
        ⚡{hasActiveCodes ? <span className="quick-actions__code-dot" /> : null}
      </button>

      {controlsOpen && <ControlsPanel onClose={() => setControlsOpen(false)} />}

      {open && (
        <div className="quick-actions__panel" role="menu">
          <div className="quick-actions__row">
            <button className="btn btn--secondary btn--sm" onClick={() => { setOpen(false); setControlsOpen(true); }}>
              ⚙ Controls
            </button>
          </div>
          <div className="quick-actions__section-label">Session</div>
          <div className="quick-actions__row">
            <button className="btn btn--secondary btn--sm" onClick={handleSync} disabled={!session.connected}>
              🔄 Sync{syncResult && <span className="quick-actions__result">{syncResult}</span>}
            </button>
            <button className="btn btn--secondary btn--sm" onClick={handleHeartbeat} disabled={!session.connected}>
              💓 Heartbeat{hbResult && <span className="quick-actions__result">{hbResult}</span>}
            </button>
            <button className="btn btn--secondary btn--sm" onClick={handleResetSequence} disabled={!session.connected}>
              ↺ Reset seq
            </button>
          </div>
          <div className="quick-actions__row quick-actions__row--seq">
            <input
              type="number"
              className="settings-field__input quick-actions__seq-input"
              min="0"
              value={customSequence}
              onChange={e => setCustomSequence(Math.max(0, parseInt(e.target.value, 10) || 0))}
              aria-label="Set sequence number"
            />
            <button className="btn btn--secondary btn--sm" onClick={handleSetSequence} disabled={!session.connected}>
              Set seq
            </button>
          </div>

          <div className="quick-actions__section-label quick-actions__section-label--mt">Caption codes</div>
          <div className="quick-actions__codes">
            {/* Language */}
            <div className="quick-actions__code-wrap">
              <button
                className={`code-btn${inputLang ? ' code-btn--active' : ''}`}
                title={inputLang ? `lang: ${inputLang} — click to clear` : 'Set caption language'}
                onClick={handleLangBtn}
              >
                {inputLang ? langLabel : `${langLabel} ▾`}
              </button>
              {langPickerOpen && (
                <div className="code-btn-dropdown">
                  <input
                    type="text"
                    placeholder="Filter languages…"
                    value={langQuery}
                    autoFocus
                    onChange={e => setLangQuery(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Escape') setLangPickerOpen(false);
                      if (e.key === 'Enter' && langMatches.length > 0) selectLang(langMatches[0].code);
                    }}
                    style={{ width: '100%', boxSizing: 'border-box', padding: '4px 8px', border: 'none', borderBottom: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-text)', outline: 'none' }}
                  />
                  {langMatches.map(l => (
                    <button key={l.code} className="audio-lang-option" onClick={() => selectLang(l.code)}>
                      {l.label} <span className="audio-lang-code">{l.code}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {/* No-translate */}
            <button
              className={`code-btn${activeCodes['no-translate'] ? ' code-btn--active' : ''}`}
              title="Toggle no-translate"
              onClick={toggleNoTranslate}
            >
              no-translate
            </button>
            {/* Custom codes */}
            {customCodeKeys.map(([k, v]) => (
              <button
                key={k}
                className="code-btn code-btn--active code-btn--custom"
                title={`${k}: ${v} — click to remove`}
                onClick={() => clearActiveCode(k)}
              >
                {k}: {v}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
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
      <QuickActionsPopover />
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
  const [showAdvanced, setShowAdvancedState] = useState(getShowAdvanced);

  function toggleAdvanced() {
    const next = !showAdvanced;
    setShowAdvancedState(next);
    setShowAdvanced(next);
  }

  return (
    <nav className={['sidebar', expanded ? 'sidebar--expanded' : 'sidebar--collapsed'].join(' ')} aria-label="Main navigation">
      <div className="sidebar__main">
        {NAV_ITEMS.map(item => (
          <SidebarItem key={item.id} {...item} expanded={expanded} onClick={onNavigate ? () => onNavigate(item.path) : undefined} />
        ))}
        {NAV_GROUPS.map(group => (
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
        {NAV_BOTTOM.map(item => (
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

// ─── Reconnect banner ─────────────────────────────────────────────────────────

function ReconnectBanner() {
  const { reconnecting, reconnectNow } = useSessionContext();
  if (!reconnecting) return null;
  return (
    <div className="reconnect-banner" role="alert" aria-live="polite">
      <span className="reconnect-banner__icon" aria-hidden="true">🔄</span>
      <span className="reconnect-banner__msg">Session disconnected — reconnecting…</span>
      <button className="reconnect-banner__btn" onClick={reconnectNow}>Reconnect now</button>
    </div>
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
      <ReconnectBanner />
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
