import { useState, useEffect, useCallback } from 'react';
import { useLocation } from 'wouter';
import { useSessionContext } from '../contexts/SessionContext';
import { TopBar, Sidebar } from './sidebar/Sidebar.jsx';
import { CommandPalette } from './CommandPalette.jsx';
import { KeyboardShortcutsHelp } from './KeyboardShortcutsHelp.jsx';

const MOBILE_BREAKPOINT = 768;

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
        <Sidebar onNavigate={handleNavigate} />
      </div>
    </>
  );
}

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

export function SidebarLayout({ children }) {
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [cmdPaletteOpen, setCmdPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [, navigate] = useLocation();

  // The persistent desktop sidebar is icon-only at a fixed width, so there's
  // nothing to toggle there — the hamburger only opens the mobile drawer
  // (hidden via CSS above the mobile breakpoint).
  function handleToggle() {
    setMobileDrawerOpen(v => !v);
  }

  // Global keyboard shortcuts: Ctrl/Cmd+K → command palette; ? → shortcuts help
  const onGlobalKeyDown = useCallback((e) => {
    // Ctrl/Cmd+K — open command palette (works even in text inputs)
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      setCmdPaletteOpen(v => !v);
      return;
    }

    // Skip remaining shortcuts when a text field has focus
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    const inDialog = document.activeElement?.closest('[role="dialog"]');
    if (inDialog) return;

    // '?' — open keyboard shortcuts help
    if (e.key === '?') {
      e.preventDefault();
      setShortcutsOpen(v => !v);
    }
  }, []);

  useEffect(() => {
    document.addEventListener('keydown', onGlobalKeyDown);
    return () => document.removeEventListener('keydown', onGlobalKeyDown);
  }, [onGlobalKeyDown]);

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
      <TopBar
        onToggle={handleToggle}
        onOpenCommandPalette={() => setCmdPaletteOpen(true)}
        onOpenShortcuts={() => setShortcutsOpen(true)}
      />
      <ReconnectBanner />
      <div className="sidebar-body">
        <Sidebar onNavigate={path => navigate(path)} />
        <MobileDrawer open={mobileDrawerOpen} onClose={() => setMobileDrawerOpen(false)} />
        <div className="sidebar-content">
          {children}
        </div>
      </div>
      <CommandPalette open={cmdPaletteOpen} onClose={() => setCmdPaletteOpen(false)} />
      <KeyboardShortcutsHelp open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </div>
  );
}
