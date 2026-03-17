import { useState, useRef } from 'react';
import { SettingsModal } from './SettingsModal';
import { CCModal } from './CCModal';
import { useSessionContext } from '../contexts/SessionContext';
import { downloadSettings, importSettings } from '../lib/settingsIO.js';

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
 *   I/O       — export settings to JSON, import from file
 */

const TOP_TABS = [
  { id: 'general', label: '⚙ General' },
  { id: 'cc',      label: '📡 Captions & Targets' },
  { id: 'io',      label: '⬇ Import / Export' },
];

export function SettingsPage() {
  const [activeTab, setActiveTab] = useState('general');
  const { connected } = useSessionContext();
  const [importResult, setImportResult] = useState(null);
  const fileInputRef = useRef(null);

  function handleImport(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        const result = importSettings(data);
        setImportResult(result);
      } catch {
        setImportResult({ ok: false, count: 0, errors: ['Could not parse JSON file'] });
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

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
        {activeTab === 'io' && (
          <div className="settings-page__io">
            <p className="settings-page__io-desc">
              Export all settings to a file. Import to restore or transfer to another device.
            </p>
            <div className="settings-page__io-actions">
              <button className="btn btn--primary" onClick={downloadSettings}>
                ⬇ Export settings
              </button>
              <button className="btn btn--secondary" onClick={() => fileInputRef.current?.click()}>
                ⬆ Import settings
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json"
                style={{ display: 'none' }}
                onChange={handleImport}
              />
            </div>
            {importResult && (
              <div className={`settings-page__io-result settings-page__io-result--${importResult.ok ? 'ok' : 'error'}`}>
                {importResult.ok
                  ? `✓ Imported ${importResult.count} setting${importResult.count !== 1 ? 's' : ''}.${importResult.errors.length > 0 ? ` (${importResult.errors.length} skipped)` : ''}`
                  : `✗ ${importResult.errors[0] || 'Import failed'}`}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
