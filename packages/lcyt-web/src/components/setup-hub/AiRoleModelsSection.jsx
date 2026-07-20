import { useCallback, useEffect, useState } from 'react';
import { useSessionContext } from '../../contexts/SessionContext.jsx';
import { SetupCard, SetupItemRow } from './SetupCard.jsx';
import { ModelsIcon } from './icons.jsx';
import { Dialog } from '../Dialog.jsx';

const inputStyle = { padding: '0.4rem 0.5rem', borderRadius: 6, border: '1px solid var(--border, #ccc)', width: '100%', boxSizing: 'border-box' };
const labelStyle = { fontSize: '0.8em', fontWeight: 600, opacity: 0.8, display: 'block', marginBottom: 2 };
const fieldStyle = { marginBottom: '0.6rem' };

// Same small authenticated-fetch idiom as ConnectorsSection.jsx — kept local
// rather than shared, matching this directory's existing convention of each
// Section owning its own thin fetch wrapper.
function useApi(session) {
  const { backendUrl, getSessionToken } = session;
  const call = useCallback(async (path, { method = 'GET', body } = {}) => {
    const token = getSessionToken?.();
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(`${backendUrl}${path}`, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }, [backendUrl, getSessionToken]);
  return call;
}

function providerLabel(provider) {
  const bits = [provider.kind];
  if (provider.vendor && provider.vendor !== 'custom' && provider.vendor !== provider.kind) bits.push(provider.vendor);
  bits.push(provider.reachability === 'bridge' ? 'via bridge' : 'direct');
  return `${provider.name} (${bits.join(' · ')})`;
}

/** One role's provider/model summary line, shown on the card face. */
function configSummary(config, providers) {
  if (!config || !config.enabled) return 'Not configured';
  const provider = providers.find(p => p.id === config.providerId);
  if (!provider) return 'Enabled, but no provider selected';
  return `${provider.name} · ${config.modelName || '(no model set)'}`;
}

/** Dialog body: pick a provider + model for one agentic_chat role and save it. */
function RoleConfigDialog({ api, role, config, providers, onClose, onSaved }) {
  const [enabled, setEnabled] = useState(config.enabled);
  const [providerId, setProviderId] = useState(config.providerId || '');
  const [modelName, setModelName] = useState(config.modelName || '');
  const [models, setModels] = useState([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const selectedProvider = providers.find(p => p.id === providerId);
  const isOllama = selectedProvider?.kind === 'ollama';

  useEffect(() => {
    if (!isOllama || !providerId) { setModels([]); return undefined; }
    let cancelled = false;
    api(`/ai/providers/${providerId}/models`)
      .then(data => { if (!cancelled) setModels(data.models || []); })
      .catch(() => { if (!cancelled) setModels([]); });
    return () => { cancelled = true; };
  }, [api, isOllama, providerId]);

  async function save() {
    setError('');
    setSaving(true);
    try {
      const data = await api(`/roles/${role.roleCode}/config`, {
        method: 'PUT',
        body: { enabled, providerId: providerId || null, modelName },
      });
      onSaved(data.config);
      onClose();
    } catch (e) {
      setError(e.message || 'Unable to save role config');
    } finally {
      setSaving(false);
    }
  }

  const enabledModels = models.filter(m => m.enabled);

  return (
    <Dialog title={`Configure ${role.name}`} onClose={onClose}>
      <p style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: '0 0 0.8rem' }}>{role.description}</p>

      <div style={fieldStyle}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.9em' }}>
          <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />
          Enabled
        </label>
      </div>

      <div style={fieldStyle}>
        <label style={labelStyle} htmlFor="ai-role-provider">Provider</label>
        <select
          id="ai-role-provider"
          style={inputStyle}
          value={providerId}
          onChange={e => { setProviderId(e.target.value); setModelName(''); }}
        >
          <option value="">— none —</option>
          {providers.map(p => (
            <option key={p.id} value={p.id} disabled={p.kind === 'deer'}>
              {providerLabel(p)}{p.kind === 'deer' ? ' — coming soon' : ''}
            </option>
          ))}
        </select>
        {providers.length === 0 && (
          <p className="setup-card__empty" style={{ fontSize: '0.8em', marginTop: 4 }}>
            No AI providers configured yet for this project.
          </p>
        )}
      </div>

      {providerId && (
        <div style={fieldStyle}>
          <label style={labelStyle}>Model</label>
          {isOllama && enabledModels.length > 0 ? (
            <select style={inputStyle} value={modelName} onChange={e => setModelName(e.target.value)}>
              <option value="">— select a model —</option>
              {enabledModels.map(m => (
                <option key={m.id} value={m.modelName}>
                  {m.modelName}{m.parameterSize ? ` (${m.parameterSize})` : ''}
                </option>
              ))}
            </select>
          ) : (
            <>
              <input
                style={inputStyle}
                value={modelName}
                onChange={e => setModelName(e.target.value)}
                placeholder={isOllama ? 'model name (no models discovered yet)' : 'model name, e.g. gpt-4o-mini'}
              />
              {isOllama && (
                <p className="setup-card__empty" style={{ fontSize: '0.75em', marginTop: 4 }}>
                  No models discovered for this provider yet — refresh discovery, or type a model name manually.
                </p>
              )}
            </>
          )}
        </div>
      )}

      {error && <div style={{ color: 'var(--danger, #d33)', fontSize: '0.8em', marginTop: 4 }}>{error}</div>}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: '1rem' }}>
        <button type="button" className="btn btn--secondary btn--sm" onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn--primary btn--sm" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </Dialog>
  );
}

/**
 * AiRoleModelsSection — Setup Hub card letting a project pick, per
 * `agentic_chat` role (Setup Assistant, Asset Control Assistant, Planner
 * Assistant, Graphics Editor Assistant, Production Assistant), which
 * configured `ai_providers` row and which model that role's turn loop
 * should use (`resolveRoleProviderSettings()`/`invokeModelCall()`,
 * `packages/plugins/lcyt-agent/src/agentic-turn.js`).
 *
 * Reads `GET /roles/catalog` (role list), `GET /ai/providers` (this
 * project's visible providers — own project-scope + granted site-scope),
 * `GET /roles/:roleCode/config` (current per-role provider_id/model_name),
 * and for an `ollama`-kind provider, `GET /ai/providers/:id/models` (its
 * discovered/manual catalog) to populate a model dropdown; an `api`-kind
 * provider has no catalog by design (plan_ai_model_registry.md's
 * "Discovery Mechanics" section), so its model stays free text. Saves via
 * the existing `PUT /roles/:roleCode/config` route.
 *
 * This is plan_ai_model_registry.md's Phase 3 frontend — the backend half
 * (bridge-relayed inference dispatch) has been done and tested since
 * before this card existed. See docs/plans/plan_ai_model_registry.md.
 */
export function AiRoleModelsSection() {
  const session = useSessionContext();
  const api = useApi(session);
  const [roles, setRoles] = useState([]);
  const [providers, setProviders] = useState([]);
  const [configs, setConfigs] = useState({});
  const [editingRoleCode, setEditingRoleCode] = useState(null);

  const load = useCallback(async () => {
    if (!session?.connected) return;
    try {
      const [catalog, providerList] = await Promise.all([
        api('/roles/catalog'),
        api('/ai/providers'),
      ]);
      const chatRoles = (catalog.roles || []).filter(r => r.runtimeKind === 'agentic_chat');
      setRoles(chatRoles);
      setProviders(providerList.providers || []);

      const entries = await Promise.all(
        chatRoles.map(async r => {
          const data = await api(`/roles/${r.roleCode}/config`);
          return [r.roleCode, data.config];
        })
      );
      setConfigs(Object.fromEntries(entries));
    } catch { /* ignore — surfaced per-row via empty state */ }
  }, [api, session?.connected]);

  useEffect(() => { load(); }, [load]);

  async function quickToggle(role) {
    const config = configs[role.roleCode];
    if (!config) return;
    try {
      const data = await api(`/roles/${role.roleCode}/config`, {
        method: 'PUT',
        body: { enabled: !config.enabled },
      });
      setConfigs(prev => ({ ...prev, [role.roleCode]: data.config }));
    } catch { /* ignore */ }
  }

  const editingRole = roles.find(r => r.roleCode === editingRoleCode);
  const editingConfig = editingRoleCode ? configs[editingRoleCode] : null;

  return (
    <SetupCard
      id="ai-roles"
      icon={ModelsIcon}
      color="purple"
      title="AI role models"
      description={
        session?.connected
          ? `${roles.filter(r => configs[r.roleCode]?.enabled).length} of ${roles.length} assistant roles configured with a provider/model.`
          : 'Pick which configured AI provider and model each assistant role (Setup, Assets, Planner, Graphics, Production) uses.'
      }
      status="ready"
    >
      {roles.length === 0 && (
        <p className="setup-card__empty">Connect to a project to configure AI role models.</p>
      )}
      {roles.map(role => {
        const config = configs[role.roleCode];
        return (
          <SetupItemRow
            key={role.roleCode}
            name={role.name}
            meta={configSummary(config, providers)}
            toggleOn={!!config?.enabled}
            onToggle={config ? () => quickToggle(role) : undefined}
            onSettings={() => setEditingRoleCode(role.roleCode)}
          />
        );
      })}

      {editingRole && editingConfig && (
        <RoleConfigDialog
          api={api}
          role={editingRole}
          config={editingConfig}
          providers={providers}
          onClose={() => setEditingRoleCode(null)}
          onSaved={(config) => setConfigs(prev => ({ ...prev, [editingRole.roleCode]: config }))}
        />
      )}
    </SetupCard>
  );
}
