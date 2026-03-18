import { useState } from 'react';
import { ProductionCamerasPage } from './ProductionCamerasPage';
import { ProductionMixersPage } from './ProductionMixersPage';
import { ProductionBridgesPage } from './ProductionBridgesPage';

const TABS = [
  { id: 'cameras',  label: '📷 Cameras' },
  { id: 'mixers',   label: '🎬 Mixers' },
  { id: 'bridges',  label: '🔌 Bridges' },
];

export function ProductionDevicesPage() {
  const [activeTab, setActiveTab] = useState('cameras');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 0,
        padding: '12px 20px 0',
        borderBottom: '1px solid var(--color-border)',
        background: 'var(--color-surface)',
        flexShrink: 0,
      }}>
        <h2 style={{ margin: '0 16px 0 0', fontSize: 18, fontWeight: 700 }}>Devices</h2>
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              background: 'none',
              border: 'none',
              borderBottom: activeTab === tab.id ? '2px solid var(--color-accent)' : '2px solid transparent',
              color: activeTab === tab.id ? 'var(--color-text)' : 'var(--color-text-muted)',
              cursor: 'pointer',
              fontWeight: activeTab === tab.id ? 600 : 400,
              fontSize: 13,
              padding: '8px 14px',
              marginBottom: -1,
              transition: 'color 0.12s, border-color 0.12s',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div style={{ flex: 1, overflow: 'auto' }}>
        {activeTab === 'cameras'  && <ProductionCamerasPage />}
        {activeTab === 'mixers'   && <ProductionMixersPage />}
        {activeTab === 'bridges'  && <ProductionBridgesPage />}
      </div>
    </div>
  );
}
