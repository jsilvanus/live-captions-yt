import { useCallback, useEffect, useState } from 'react';
import { useSessionContext } from '../../contexts/SessionContext.jsx';
import { useUserAuth } from '../../hooks/useUserAuth.js';
import { createAiModel, deleteAiModel, listAiModels, updateAiModel } from '../../lib/aiAdminApi.js';
import { Dialog } from '../Dialog.jsx';
import { SetupCard, SetupItemRow } from './SetupCard.jsx';
import { ModelsIcon } from './icons.jsx';

const ROLE_LABELS = { assistant: 'Assistant' };
const PROVIDER_LABELS = { api: 'API (BYOK)', ollama: 'Ollama' };
const EMPTY_FORM = { roleCode: 'assistant', provider: 'api', modelName: '', apiUrl: 'http://localhost:11434', apiKeyValue: '', enabled: true };

export function AiModelsSection() {
  const session = useSessionContext();
  const { token: userToken, backendUrl: userBackendUrl } = useUserAuth();
  const backendUrl = userBackendUrl || session?.backendUrl || '';
  const apiKey = session?.apiKey || '';
  const [models, setModels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editingModel, setEditingModel] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [discovering, setDiscovering] = useState(false);
  const [discoveredModels, setDiscoveredModels] = useState([]);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!backendUrl || !userToken || !apiKey) {
      setModels([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const rows = await listAiModels({ backendUrl, token: userToken, apiKey });
      setModels(rows);
    } catch (err) {
      setModels([]);
      setError(err.message || 'Unable to load AI models');
    } finally {
      setLoading(false);
    }
  }, [apiKey, backendUrl, userToken]);

  useEffect(() => { load(); }, [load]);

  function closeDialog() {
    setOpen(false);
    setEditingModel(null);
    setForm(EMPTY_FORM);
    setDiscoveredModels([]);
    setError('');
  }

  function openCreate() {
    setEditingModel(null);
    setForm(EMPTY_FORM);
    setDiscoveredModels([]);
    setError('');
    setOpen(true);
  }

  function openEdit(model) {
    setEditingModel(model);
    setForm({
      roleCode: model.roleCode || 'assistant',
      provider: model.provider || 'api',
      modelName: model.modelName || '',
      apiUrl: model.apiUrl || 'http://localhost:11434',
      apiKeyValue: '',
      enabled: model.enabled !== false,
    });
    setDiscoveredModels([]);
    setError('');
    setOpen(true);
  }

  async function handleDiscover() {
    if (form.provider !== 'ollama') return;
    const endpoint = (form.apiUrl || '').trim();
    if (!endpoint) {
      setError('Enter an Ollama endpoint first');
      return;
    }
    setDiscovering(true);
    setError('');
    try {
      const base = endpoint.replace(/\/$/, '');
      const res = await fetch(`${base}/api/tags`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Unable to discover models');
      const names = Array.isArray(data.models) ? data.models.map(item => item.name).filter(Boolean) : [];
      setDiscoveredModels(names);
      if (names.length > 0 && !form.modelName) {
        setForm(prev => ({ ...prev, modelName: names[0] }));
      }
    } catch (err) {
      setError(err.message || 'Unable to discover models');
    } finally {
      setDiscovering(false);
    }
  }

  async function handleSave(event) {
    event.preventDefault();
    if (!form.modelName.trim()) {
      setError('Enter a model name');
      return;
    }
    try {
      if (editingModel) {
        await updateAiModel({
          backendUrl,
          token: userToken,
          apiKey,
          id: editingModel.id,
          roleCode: form.roleCode,
          provider: form.provider,
          modelName: form.modelName.trim(),
          apiUrl: form.apiUrl.trim(),
          apiKeyValue: form.apiKeyValue.trim(),
          enabled: form.enabled,
        });
      } else {
        await createAiModel({
          backendUrl,
          token: userToken,
          apiKey,
          roleCode: form.roleCode,
          provider: form.provider,
          modelName: form.modelName.trim(),
          apiUrl: form.apiUrl.trim(),
          apiKeyValue: form.apiKeyValue.trim(),
          enabled: form.enabled,
        });
      }
      await load();
      closeDialog();
    } catch (err) {
      setError(err.message || 'Unable to save model');
    }
  }

  async function handleToggle(model) {
    try {
      await updateAiModel({
        backendUrl,
        token: userToken,
        apiKey,
        id: model.id,
        roleCode: model.roleCode || 'assistant',
        provider: model.provider,
        modelName: model.modelName,
        apiUrl: model.apiUrl,
        apiKeyValue: '',
        enabled: !model.enabled,
      });
      await load();
    } catch (err) {
      setError(err.message || 'Unable to update model');
    }
  }

  async function handleDelete(model) {
    if (!confirm(`Remove ${model.modelName || model.roleCode}?`)) return;
    try {
      await deleteAiModel({ backendUrl, token: userToken, apiKey, id: model.id });
      await load();
      if (open) closeDialog();
    } catch (err) {
      setError(err.message || 'Unable to remove model');
    }
  }

  const content = loading ? (
    <p className="setup-card__empty">Loading AI models…</p>
  ) : models.length > 0 ? (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
      {models.map(model => (
        <SetupItemRow
          key={model.id}
          name={ROLE_LABELS[model.roleCode] || model.roleCode || 'Assistant'}
          meta={`${PROVIDER_LABELS[model.provider] || model.provider} • ${model.modelName || 'No model selected'}`}
          badge={model.enabled ? 'Enabled' : 'Disabled'}
          toggleOn={model.enabled}
          onToggle={() => handleToggle(model)}
          onSettings={() => openEdit(model)}
          onDelete={() => handleDelete(model)}
        />
      ))}
    </div>
  ) : (
    <p className="setup-card__empty">No AI models configured yet. Add one for the Assistant role.</p>
  );

  return (
    <>
      <SetupCard
        id="ai-models"
        icon={ModelsIcon}
        color="purple"
        title="AI models"
        description="Choose which model the Assistant role can use, and whether it is enabled site-wide."
        headerAction={{ label: 'Add model', onClick: openCreate }}
        status="partial"
        statusLabel="Role-based"
      >
        {content}
      </SetupCard>

      {open && (
        <Dialog title={editingModel ? 'Edit AI model' : 'Add AI model'} onClose={closeDialog} width={600}>
          <form onSubmit={handleSave}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                <span style={{ fontWeight: 600 }}>Role</span>
                <select
                  value={form.roleCode}
                  onChange={event => setForm(prev => ({ ...prev, roleCode: event.target.value }))}
                  style={{ padding: '0.6rem 0.75rem', borderRadius: 6, border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)' }}
                >
                  <option value="assistant">Assistant</option>
                </select>
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                <span style={{ fontWeight: 600 }}>Provider</span>
                <select
                  value={form.provider}
                  onChange={event => setForm(prev => ({ ...prev, provider: event.target.value, modelName: '', apiUrl: prev.apiUrl || 'http://localhost:11434' }))}
                  style={{ padding: '0.6rem 0.75rem', borderRadius: 6, border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)' }}
                >
                  <option value="api">API (BYOK)</option>
                  <option value="ollama">Ollama</option>
                </select>
              </label>

              {form.provider === 'ollama' && (
                <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                  <span style={{ fontWeight: 600 }}>Ollama endpoint</span>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <input
                      value={form.apiUrl}
                      onChange={event => setForm(prev => ({ ...prev, apiUrl: event.target.value }))}
                      placeholder="http://localhost:11434"
                      style={{ flex: 1, padding: '0.6rem 0.75rem', borderRadius: 6, border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)' }}
                    />
                    <button type="button" className="btn btn--ghost btn--sm" onClick={handleDiscover} disabled={discovering}>
                      {discovering ? 'Discovering…' : 'Discover models'}
                    </button>
                  </div>
                </label>
              )}

              <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                <span style={{ fontWeight: 600 }}>Model</span>
                {form.provider === 'ollama' && discoveredModels.length > 0 ? (
                  <select
                    value={form.modelName}
                    onChange={event => setForm(prev => ({ ...prev, modelName: event.target.value }))}
                    style={{ padding: '0.6rem 0.75rem', borderRadius: 6, border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)' }}
                  >
                    {discoveredModels.map(name => <option key={name} value={name}>{name}</option>)}
                  </select>
                ) : (
                  <input
                    value={form.modelName}
                    onChange={event => setForm(prev => ({ ...prev, modelName: event.target.value }))}
                    placeholder={form.provider === 'ollama' ? 'llama3.2' : 'gpt-4o-mini'}
                    style={{ padding: '0.6rem 0.75rem', borderRadius: 6, border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)' }}
                  />
                )}
              </label>

              {form.provider === 'api' && (
                <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                  <span style={{ fontWeight: 600 }}>API key</span>
                  <input
                    type="password"
                    value={form.apiKeyValue}
                    onChange={event => setForm(prev => ({ ...prev, apiKeyValue: event.target.value }))}
                    placeholder="sk-..."
                    style={{ padding: '0.6rem 0.75rem', borderRadius: 6, border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)' }}
                  />
                </label>
              )}

              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <input type="checkbox" checked={!!form.enabled} onChange={event => setForm(prev => ({ ...prev, enabled: event.target.checked }))} />
                <span>Enabled</span>
              </label>

              {error && <div style={{ color: 'var(--color-danger, #c2410c)', fontSize: '0.9rem' }}>{error}</div>}
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1rem' }}>
              <div>
                {editingModel && (
                  <button type="button" className="btn btn--ghost btn--sm" onClick={() => handleDelete(editingModel)}>
                    Remove
                  </button>
                )}
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button type="button" className="btn btn--ghost btn--sm" onClick={closeDialog}>Cancel</button>
                <button type="submit" className="btn btn--sm">Save</button>
              </div>
            </div>
          </form>
        </Dialog>
      )}
    </>
  );
}
