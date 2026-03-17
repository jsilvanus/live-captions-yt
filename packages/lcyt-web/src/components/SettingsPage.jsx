import { useState } from 'react';
import { SettingsModal } from './SettingsModal';
import { CCModal } from './CCModal';
import { useSessionContext } from '../contexts/SessionContext';

/**
 * SettingsPage — unified settings at /settings.
 *
 * Shows SettingsModal (General) and CCModal (Captions & Targets) inline,
 * selectable via a top-level tab bar. Same pattern as EmbedSettingsPage
 * but inside the sidebar shell (no AppProviders wrapper needed).
 *
 * Tabs:
 *   General   — backend URL, API key, theme, text size, stream relay config,
 *               credentials, graphics, shortcuts (from SettingsModal)
 *   CC        — caption targets, STT service, translation, advanced details
 *               (from CCModal)
 */

const TOP_TABS = [
  { id: 'general', label: '⚙ General' },
  { id: 'cc',      label: '📡 Captions & Targets' },
];

export function SettingsPage() {
  const [activeTab, setActiveTab] = useState('general');
  const { connected } = useSessionContext();

  return (
    <div className="settings-page">
      {/* Top-level tab bar */}
      <div className="settings-page__tabs">
        {TOP_TABS.map(tab => (
          <button
            key={tab.id}
            className={[
              'settings-page__tab',
              activeTab === tab.id ? 'settings-page__tab--active' : '',
            ].filter(Boolean).join(' ')}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="settings-page__body">
        {activeTab === 'general' && (
          <SettingsModal inline isOpen />
        )}
        {activeTab === 'cc' && (
          <CCModal inline isOpen connected={connected} />
        )}
      </div>
    </div>
  );
}
