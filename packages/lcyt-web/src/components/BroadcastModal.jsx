import { useState } from 'react';
import { useEscapeKey } from '../hooks/useEscapeKey';
import { EncoderTab } from './broadcast/EncoderTab.jsx';
import { StreamTab } from './broadcast/StreamTab.jsx';
import { YouTubeTab } from './broadcast/YouTubeTab.jsx';

const TABS = ['encoder', 'youtube', 'stream'];
const TAB_LABELS = { encoder: 'Encoder', youtube: 'YouTube', stream: 'Stream' };

export function BroadcastModal({ isOpen, onClose, inline }) {
  const [activeTab, setActiveTab] = useState('encoder');

  useEscapeKey(onClose, isOpen && !inline);

  if (!isOpen && !inline) return null;

  const box = (
    <div
      className="settings-modal__box broadcast-modal__box"
      style={inline ? { position: 'static', maxWidth: '100%', maxHeight: '100%', height: '100%', borderRadius: 0, border: 'none', boxShadow: 'none' } : {}}
    >
      <div className="settings-modal__header">
        <span className="settings-modal__title">Broadcast</span>
        {!inline && <button className="settings-modal__close" onClick={onClose} aria-label="Close">✕</button>}
      </div>

      <div className="settings-modal__tabs">
        {TABS.map(tab => (
          <button
            key={tab}
            className={`settings-tab${activeTab === tab ? ' settings-tab--active' : ''}`}
            onClick={() => setActiveTab(tab)}
          >
            {TAB_LABELS[tab]}
          </button>
        ))}
      </div>

      <div className="settings-modal__body">
        {activeTab === 'encoder' && <EncoderTab />}
        {activeTab === 'youtube' && <YouTubeTab />}
        {activeTab === 'stream'  && <StreamTab />}
      </div>
    </div>
  );

  if (inline) return box;

  return (
    <div className="settings-modal broadcast-modal" role="dialog" aria-modal="true" aria-label="Broadcast">
      <div className="settings-modal__backdrop" onClick={onClose} />
      {box}
    </div>
  );
}
