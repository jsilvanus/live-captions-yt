import { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { useSessionContext } from '../contexts/SessionContext';
import { KEYS } from '../lib/storageKeys.js';
import { TopBar, Sidebar } from './sidebar/Sidebar.jsx';

const MOBILE_BREAKPOINT = 768;

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
        <Sidebar expanded={expanded} onNavigate={path => navigate(path)} />
        <MobileDrawer open={mobileDrawerOpen} onClose={() => setMobileDrawerOpen(false)} />
        <div className="sidebar-content">
          {children}
        </div>
      </div>
    </div>
  );
}
