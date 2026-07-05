import { useState, useMemo } from 'react';
import { useSessionContext } from '../../contexts/SessionContext';
import { EncoderTab } from './EncoderTab.jsx';
import { StreamTab } from './StreamTab.jsx';
import { YouTubeTab } from './YouTubeTab.jsx';

/**
 * SettingsTab — the Broadcast page's config sub-tabs (Encoder / YouTube /
 * Stream relay). This is the former `BroadcastModal` body, unchanged
 * internally, just re-hosted as the second tab of `BroadcastPage`. The
 * RTMP-relay ("Stream") sub-tab stays conditioned on the `rtmp` feature.
 */
export function SettingsTab() {
  const { backendFeatures } = useSessionContext();
  const showStream = !backendFeatures || backendFeatures.includes('rtmp');

  const tabs = useMemo(() => {
    const t = [
      { id: 'encoder', label: 'Encoder' },
      { id: 'youtube', label: 'YouTube' },
    ];
    if (showStream) t.push({ id: 'stream', label: 'Stream' });
    return t;
  }, [showStream]);

  const [activeTab, setActiveTab] = useState('encoder');
  const tab = tabs.some(t => t.id === activeTab) ? activeTab : 'encoder';

  return (
    <div className="broadcast-settings-tab">
      <div className="settings-modal__tabs">
        {tabs.map(t => (
          <button
            key={t.id}
            className={`settings-tab${tab === t.id ? ' settings-tab--active' : ''}`}
            onClick={() => setActiveTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="settings-modal__body">
        {tab === 'encoder' && <EncoderTab />}
        {tab === 'youtube' && <YouTubeTab />}
        {tab === 'stream' && showStream && <StreamTab />}
      </div>
    </div>
  );
}
