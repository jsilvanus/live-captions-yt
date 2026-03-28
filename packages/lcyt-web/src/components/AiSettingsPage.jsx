import { useState, useEffect, useCallback } from 'react';
import { useSessionContext } from '../contexts/ConnectionContext';
import { useLang } from '../lib/i18n';

const PROVIDERS = [
  { value: 'none',   label: 'Disabled' },
  { value: 'server', label: 'Server-provided' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'custom', label: 'Custom API' },
];

export function AiSettingsPage() {
  const { t } = useLang();
  const session = useSessionContext();
  const [config, setConfig] = useState(null);
  const [serverStatus, setServerStatus] = useState(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');

  const fetchConfig = useCallback(async () => {
    if (!session.connected) return;
    try {
      const token = session.getSessionToken?.();
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const res = await fetch(`${session.backendUrl}/ai/config`, { headers });
      if (res.ok) {
        const data = await res.json();
        setConfig(data.config);
      }
    } catch { /* ignore */ }
  }, [session.connected, session.backendUrl, session.getSessionToken]);

  const fetchStatus = useCallback(async () => {
    if (!session.backendUrl) return;
    try {
      const res = await fetch(`${session.backendUrl}/ai/status`);
      if (res.ok) {
        const data = await res.json();
        setServerStatus(data);
      }
    } catch { /* ignore */ }
  }, [session.backendUrl]);

  useEffect(() => { fetchConfig(); }, [fetchConfig]);
  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  const handleSave = async () => {
    if (!session.connected || !config) return;
    setSaving(true);
    setStatus('');
    try {
      const token = session.getSessionToken?.();
      const headers = { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
      const res = await fetch(`${session.backendUrl}/ai/config`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(config),
      });
      if (res.ok) {
        setStatus(t('ai.saved') || 'Saved');
        setTimeout(() => setStatus(''), 3000);
      } else {
        const err = await res.json().catch(() => ({}));
        setStatus(err.error || 'Error saving');
      }
    } catch (e) {
      setStatus(e.message);
    }
    setSaving(false);
  };

  const update = (key, value) => {
    setConfig(prev => ({ ...prev, [key]: value }));
  };

  if (!session.connected) {
    return (
      <div className="page-container" style={{ padding: '2rem' }}>
        <h2>🤖 {t('ai.title') || 'AI & Embeddings'}</h2>
        <p style={{ opacity: 0.6 }}>{t('ai.connectFirst') || 'Connect to a backend to configure AI settings.'}</p>
      </div>
    );
  }

  const provider = config?.embeddingProvider || 'none';
  const showUserFields = provider === 'openai' || provider === 'custom';
  const showServerInfo = provider === 'server';

  return (
    <div className="page-container" style={{ padding: '2rem', maxWidth: 700 }}>
      <h2>🤖 {t('ai.title') || 'AI & Embeddings'}</h2>
      <p style={{ opacity: 0.7, marginBottom: '1.5rem' }}>
        {t('ai.description') || 'Configure embedding models for fuzzy cue matching and future AI features.'}
      </p>

      {/* Server status info */}
      {serverStatus && (
        <div style={{ marginBottom: '1.5rem', padding: '0.75rem 1rem', background: 'var(--surface, #f5f5f5)', borderRadius: 8 }}>
          <strong>{t('ai.serverStatus') || 'Server AI Status'}</strong>
          <div style={{ marginTop: 4, fontSize: '0.9em' }}>
            {serverStatus.serverEmbeddingAvailable
              ? <span style={{ color: 'var(--success, green)' }}>✓ {t('ai.serverAvailable') || 'Server embedding API available'} ({serverStatus.serverEmbeddingModel})</span>
              : <span style={{ opacity: 0.6 }}>{t('ai.serverNotConfigured') || 'Server embedding API not configured — use your own API key'}</span>
            }
          </div>
        </div>
      )}

      {config && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {/* Provider selection */}
          <label style={{ fontWeight: 600 }}>{t('ai.provider') || 'Embedding Provider'}</label>
          <select
            value={provider}
            onChange={e => update('embeddingProvider', e.target.value)}
            style={{ padding: '0.5rem', borderRadius: 6, border: '1px solid var(--border, #ccc)' }}
          >
            {PROVIDERS.map(p => (
              <option key={p.value} value={p.value} disabled={p.value === 'server' && !serverStatus?.serverEmbeddingAvailable}>
                {p.label}{p.value === 'server' && !serverStatus?.serverEmbeddingAvailable ? ' (not available)' : ''}
              </option>
            ))}
          </select>

          {/* Server info */}
          {showServerInfo && serverStatus?.serverEmbeddingAvailable && (
            <div style={{ padding: '0.5rem 1rem', background: 'var(--surface, #f0f0f0)', borderRadius: 6, fontSize: '0.9em' }}>
              {t('ai.serverModel') || 'Model'}: <strong>{serverStatus.serverEmbeddingModel}</strong>
              <div style={{ opacity: 0.7, marginTop: 4 }}>{t('ai.serverNote') || 'Using the server-configured embedding API. No API key needed.'}</div>
            </div>
          )}

          {/* User API fields */}
          {showUserFields && (
            <>
              {provider === 'custom' && (
                <>
                  <label>{t('ai.apiUrl') || 'API URL'}</label>
                  <input
                    type="url"
                    value={config.embeddingApiUrl || ''}
                    onChange={e => update('embeddingApiUrl', e.target.value)}
                    placeholder="https://api.openai.com"
                    style={{ padding: '0.5rem', borderRadius: 6, border: '1px solid var(--border, #ccc)' }}
                  />
                </>
              )}

              <label>{t('ai.apiKey') || 'API Key'}</label>
              <input
                type="password"
                value={config.embeddingApiKey || ''}
                onChange={e => update('embeddingApiKey', e.target.value)}
                placeholder={provider === 'openai' ? 'sk-...' : 'your-api-key'}
                style={{ padding: '0.5rem', borderRadius: 6, border: '1px solid var(--border, #ccc)' }}
              />

              <label>{t('ai.model') || 'Model'}</label>
              <input
                type="text"
                value={config.embeddingModel || ''}
                onChange={e => update('embeddingModel', e.target.value)}
                placeholder="text-embedding-3-small"
                style={{ padding: '0.5rem', borderRadius: 6, border: '1px solid var(--border, #ccc)' }}
              />
            </>
          )}

          {/* Fuzzy threshold */}
          {provider !== 'none' && (
            <>
              <label>{t('ai.fuzzyThreshold') || 'Fuzzy Match Threshold'} ({Math.round((config.fuzzyThreshold ?? 0.75) * 100)}%)</label>
              <input
                type="range"
                min="0.5"
                max="1.0"
                step="0.01"
                value={config.fuzzyThreshold ?? 0.75}
                onChange={e => update('fuzzyThreshold', parseFloat(e.target.value))}
                style={{ width: '100%' }}
              />
              <div style={{ fontSize: '0.85em', opacity: 0.6 }}>
                {t('ai.thresholdHelp') || 'Lower values match more loosely. 0.75 is a good default for spoken language.'}
              </div>
            </>
          )}

          {/* Local fuzzy info */}
          <div style={{ padding: '0.75rem 1rem', background: 'var(--surface, #f5f5f5)', borderRadius: 8, fontSize: '0.9em', marginTop: '0.5rem' }}>
            <strong>{t('ai.localFuzzy') || 'Local Fuzzy Matching'}</strong>
            <div style={{ marginTop: 4, opacity: 0.7 }}>
              {t('ai.localFuzzyNote') || 'Client-side Jaro-Winkler matching is always available for cue~: metacodes. Use the threshold above to control sensitivity. No API key needed.'}
            </div>
          </div>

          {/* Future: Ollama */}
          <div style={{ padding: '0.75rem 1rem', border: '1px dashed var(--border, #ccc)', borderRadius: 8, fontSize: '0.9em', opacity: 0.6 }}>
            <strong>🔮 {t('ai.ollamaFuture') || 'Local Model (Ollama)'}</strong>
            <div style={{ marginTop: 4 }}>
              {t('ai.ollamaNote') || 'Support for running local embedding models via Ollama is planned for a future release.'}
            </div>
          </div>

          {/* Save button */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginTop: '0.5rem' }}>
            <button
              onClick={handleSave}
              disabled={saving}
              style={{ padding: '0.6rem 1.5rem', borderRadius: 8, background: 'var(--primary, #2196F3)', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 600, opacity: saving ? 0.5 : 1 }}
            >
              {saving ? (t('ai.saving') || 'Saving...') : (t('ai.save') || 'Save')}
            </button>
            {status && <span style={{ fontSize: '0.9em' }}>{status}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
