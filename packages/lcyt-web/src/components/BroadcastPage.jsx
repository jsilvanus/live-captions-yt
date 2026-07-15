import { useState } from 'react';
import { useProjectRequired } from '../hooks/useProjectRequired';
import { LiveTab } from './broadcast/LiveTab.jsx';
import { SettingsTab } from './broadcast/SettingsTab.jsx';
import { ScheduleTab } from './broadcast/ScheduleTab.jsx';

const TABS = [
  { id: 'live',     label: 'Live' },
  { id: 'schedule', label: 'Schedule' },
  { id: 'settings', label: 'Settings' },
];

/**
 * BroadcastPage — full-page Broadcast view at /broadcast.
 *
 * Tab shell: **Live** (default) hosts the widget-grid operator console
 * (formerly the `/` Dashboard); **Settings** hosts the Encoder/YouTube/Stream
 * config (formerly `BroadcastModal`).
 */
export function BroadcastPage() {
  useProjectRequired();
  const [activeTab, setActiveTab] = useState('live');

  return (
    <div className="settings-page broadcast-page">
      <div className="settings-modal__tabs broadcast-page__tabs">
        {TABS.map(t => (
          <button
            key={t.id}
            className={`settings-tab${activeTab === t.id ? ' settings-tab--active' : ''}`}
            onClick={() => setActiveTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="broadcast-page__body">
        {activeTab === 'live'     && <LiveTab />}
        {activeTab === 'schedule' && <ScheduleTab />}
        {activeTab === 'settings' && <SettingsTab />}
      </div>
    </div>
  );
}
