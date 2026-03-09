/**
 * EmbedSettingsPage — standalone settings widget for iframe embedding.
 *
 * Rendered when lcyt-web is opened at /embed/settings
 *
 * Provides two tabs:
 *   General — connection credentials (backend URL, API key), theme, text size,
 *             language, and RTMP relay targets. Saved to localStorage (lcyt-config).
 *   CC      — caption targets (YouTube stream keys / generic endpoints), STT
 *             engine, speech language, translations, and advanced caption details.
 *             All settings saved to localStorage by each individual config module.
 *
 * Because all settings are persisted to localStorage, other embed widgets
 * (/embed/audio, /embed/input, etc.) on the same origin automatically pick
 * them up on their next load.
 *
 * URL params:
 *   ?theme=dark|light    UI theme (default: dark)
 *   ?tab=general|cc      Initial active top-level tab (default: general)
 *
 * Host page usage:
 *   <iframe
 *     src="https://your-lcyt-host/embed/settings?theme=dark"
 *     style="width:100%; height:600px; border:none;">
 *   </iframe>
 */

import { useEffect, useState } from 'react';
import { AppProviders } from '../contexts/AppProviders';
import { SettingsModal } from './SettingsModal';
import { CCModal } from './CCModal';

const TABS = [
  { id: 'general', label: 'General' },
  { id: 'cc',      label: 'CC' },
];

function SettingsLayout({ initialTab }) {
  const [activeTab, setActiveTab] = useState(initialTab);

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--color-bg, #111)' }}>

      {/* Top-level tab bar */}
      <div style={topTabBarStyle}>
        {TABS.map(tab => (
          <button
            key={tab.id}
            style={{ ...topTabStyle, ...(activeTab === tab.id ? topTabActiveStyle : {}) }}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {activeTab === 'general' && <SettingsModal inline isOpen />}
        {activeTab === 'cc'      && <CCModal      inline isOpen />}
      </div>
    </div>
  );
}

export function EmbedSettingsPage() {
  const params      = new URLSearchParams(window.location.search);
  const theme       = params.get('theme') || 'dark';
  const initialTab  = params.get('tab') === 'cc' ? 'cc' : 'general';

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, []);

  return (
    <AppProviders>
      <SettingsLayout initialTab={initialTab} />
    </AppProviders>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const topTabBarStyle = {
  display:         'flex',
  borderBottom:    '1px solid var(--color-border, #333)',
  background:      'var(--color-surface, #1e1e1e)',
  flexShrink:      0,
};

const topTabStyle = {
  padding:         '10px 20px',
  background:      'none',
  border:          'none',
  borderBottom:    '2px solid transparent',
  cursor:          'pointer',
  color:           'var(--color-text-dim, #888)',
  fontSize:        '13px',
  fontWeight:      500,
};

const topTabActiveStyle = {
  borderBottomColor: 'var(--color-accent, #1976d2)',
  color:             'var(--color-text, #eee)',
};
