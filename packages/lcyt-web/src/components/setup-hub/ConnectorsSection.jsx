import { useState, useEffect, useCallback } from 'react';
import { useSessionContext } from '../../contexts/SessionContext';
import { SetupCard } from './SetupCard.jsx';

const AUTH_TYPES = ['none', 'api_key', 'bearer', 'basic', 'custom'];
const METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'];
const RESPONSE_TYPES = ['auto', 'json', 'text', 'image', 'binary', 'raw'];

const inputStyle = { padding: '0.4rem 0.5rem', borderRadius: 6, border: '1px solid var(--border, #ccc)', width: '100%', boxSizing: 'border-box' };
const labelStyle = { fontSize: '0.8em', fontWeight: 600, opacity: 0.8, display: 'block', marginBottom: 2 };
const fieldStyle = { marginBottom: '0.6rem' };

function useApi(session) {
  const call = useCallback(async (path, { method = 'GET', body } = {}) => {
    const token = session.getSessionToken?.();
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(`${session.backendUrl}${path}`, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }, [session]);
  return call;
}

/** Editable list of { key, value } pairs (headers / query params). */
function PairList({ pairs, onChange, keyPlaceholder = 'Key', valuePlaceholder = 'Value ({{var}} allowed)' }) {
  function update(i, field, val) {
    const next = pairs.slice();
    next[i] = { ...next[i], [field]: val };
    onChange(next);
  }
  function remove(i) {
    onChange(pairs.filter((_, idx) => idx !== i));
  }
  return (
    <div>
      {pairs.map((p, i) => (
        <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
          <input style={inputStyle} placeholder={keyPlaceholder} value={p.key} onChange={e => update(i, 'key', e.target.value)} />
          <input style={inputStyle} placeholder={valuePlaceholder} value={p.value} onChange={e => update(i, 'value', e.target.value)} />
          <button type="button" className="btn btn--danger btn--sm" onClick={() => remove(i)}>✕</button>
        </div>
      ))}
      <button type="button" className="btn btn--secondary btn--sm" onClick={() => onChange([...pairs, { key: '', value: '' }])}>
        + Add
      </button>
    </div>
  );
}

function MappingsEditor({ api, connectorSlug, requestSlug }) {
  const [mappings, setMappings] = useState([]);
  const [form, setForm] = useState({ jsonPath: '$', variableName: '' });
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const data = await api(`/connectors/${connectorSlug}/requests/${requestSlug}/mappings`);
      setMappings(data.mappings);
    } catch { /* ignore */ }
  }, [api, connectorSlug, requestSlug]);

  useEffect(() => { load(); }, [load]);

  async function create() {
    setError('');
    if (!form.variableName) { setError('variableName is required'); return; }
    try {
      await api(`/connectors/${connectorSlug}/requests/${requestSlug}/mappings`, { method: 'POST', body: form });
      setForm({ jsonPath: '$', variableName: '' });
      load();
    } catch (e) { setError(e.message); }
  }

  async function remove(id) {
    await api(`/connectors/${connectorSlug}/requests/${requestSlug}/mappings/${id}`, { method: 'DELETE' });
    load();
  }

  return (
    <div style={{ marginTop: '0.5rem', paddingLeft: '1rem', borderLeft: '2px solid var(--border, #eee)' }}>
      <div style={{ fontSize: '0.8em', fontWeight: 600, opacity: 0.8, marginBottom: 4 }}>Response mappings → variables</div>
      {mappings.map(m => (
        <div key={m.id} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: '0.85em', marginBottom: 4 }}>
          <code>{m.jsonPath}</code> → <code>{`{{${m.variableName}}}`}</code>
          <button type="button" className="btn btn--danger btn--sm" onClick={() => remove(m.id)}>✕</button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
        <input style={inputStyle} placeholder="$.path.to.value" value={form.jsonPath} onChange={e => setForm(f => ({ ...f, jsonPath: e.target.value }))} />
        <input style={inputStyle} placeholder="variableName" value={form.variableName} onChange={e => setForm(f => ({ ...f, variableName: e.target.value }))} />
        <button type="button" className="btn btn--secondary btn--sm" onClick={create}>+ Map</button>
      </div>
      {error && <div style={{ color: 'var(--danger, #d33)', fontSize: '0.8em' }}>{error}</div>}
    </div>
  );
}

function RequestRow({ api, connectorSlug, request, onDeleted }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div style={{ border: '1px solid var(--border, #ddd)', borderRadius: 8, padding: '0.6rem 0.8rem', marginBottom: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }} onClick={() => setExpanded(v => !v)}>
        <span>
          <strong>{request.name}</strong>{' '}
          <code style={{ fontSize: '0.85em' }}>{request.method} {request.path}</code>{' '}
          <span style={{ fontSize: '0.8em', opacity: 0.6 }}>{connectorSlug}.{request.slug}</span>
        </span>
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button" className="btn btn--danger btn--sm" onClick={(e) => { e.stopPropagation(); onDeleted(request.slug); }}>Delete</button>
          <span>{expanded ? '▾' : '▸'}</span>
        </div>
      </div>
      {expanded && <MappingsEditor api={api} connectorSlug={connectorSlug} requestSlug={request.slug} />}
    </div>
  );
}

function NewRequestForm({ api, connectorSlug, onCreated }) {
  const [form, setForm] = useState({
    name: '', slug: '', method: 'GET', path: '/', responseType: 'json',
    queryParams: [], bodyType: 'raw', bodyContent: '',
  });
  const [error, setError] = useState('');

  async function create() {
    setError('');
    if (!form.name || !form.slug || !form.path) { setError('name, slug, and path are required'); return; }
    try {
      await api(`/connectors/${connectorSlug}/requests`, { method: 'POST', body: form });
      setForm({ name: '', slug: '', method: 'GET', path: '/', responseType: 'json', queryParams: [], bodyType: 'raw', bodyContent: '' });
      onCreated();
    } catch (e) { setError(e.message); }
  }

  return (
    <div style={{ border: '1px dashed var(--border, #ccc)', borderRadius: 8, padding: '0.6rem 0.8rem' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <div style={fieldStyle}><label style={labelStyle}>Name</label><input style={inputStyle} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
        <div style={fieldStyle}><label style={labelStyle}>Slug</label><input style={inputStyle} value={form.slug} onChange={e => setForm(f => ({ ...f, slug: e.target.value }))} placeholder="current" /></div>
        <div style={fieldStyle}>
          <label style={labelStyle}>Method</label>
          <select style={inputStyle} value={form.method} onChange={e => setForm(f => ({ ...f, method: e.target.value }))}>
            {METHODS.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div style={fieldStyle}><label style={labelStyle}>Path</label><input style={inputStyle} value={form.path} onChange={e => setForm(f => ({ ...f, path: e.target.value }))} placeholder="/current?zip={{zip}}" /></div>
        <div style={fieldStyle}>
          <label style={labelStyle}>Response type</label>
          <select style={inputStyle} value={form.responseType} onChange={e => setForm(f => ({ ...f, responseType: e.target.value }))}>
            {RESPONSE_TYPES.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <div style={fieldStyle}>
          <label style={labelStyle}>Body type</label>
          <select style={inputStyle} value={form.bodyType} onChange={e => setForm(f => ({ ...f, bodyType: e.target.value }))}>
            <option value="raw">none</option>
            <option value="json">json</option>
            <option value="text">text</option>
          </select>
        </div>
      </div>
      {form.bodyType !== 'raw' && (
        <div style={fieldStyle}>
          <label style={labelStyle}>Body content</label>
          <textarea style={{ ...inputStyle, minHeight: 60, fontFamily: 'monospace' }} value={form.bodyContent} onChange={e => setForm(f => ({ ...f, bodyContent: e.target.value }))} />
        </div>
      )}
      <div style={fieldStyle}>
        <label style={labelStyle}>Query params</label>
        <PairList pairs={form.queryParams} onChange={v => setForm(f => ({ ...f, queryParams: v }))} />
      </div>
      <button type="button" className="btn btn--primary btn--sm" onClick={create}>+ Add request</button>
      {error && <div style={{ color: 'var(--danger, #d33)', fontSize: '0.8em', marginTop: 4 }}>{error}</div>}
    </div>
  );
}

function ConnectorCard({ api, connector, onDeleted }) {
  const [expanded, setExpanded] = useState(false);
  const [requests, setRequests] = useState([]);

  const loadRequests = useCallback(async () => {
    try {
      const data = await api(`/connectors/${connector.slug}/requests`);
      setRequests(data.requests);
    } catch { /* ignore */ }
  }, [api, connector.slug]);

  useEffect(() => { if (expanded) loadRequests(); }, [expanded, loadRequests]);

  async function deleteRequest(requestSlug) {
    await api(`/connectors/${connector.slug}/requests/${requestSlug}`, { method: 'DELETE' });
    loadRequests();
  }

  return (
    <div style={{ border: '1px solid var(--border, #ccc)', borderRadius: 10, padding: '0.8rem 1rem', marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }} onClick={() => setExpanded(v => !v)}>
        <span>
          <strong>🔌 {connector.name}</strong>{' '}
          <span style={{ fontSize: '0.85em', opacity: 0.7 }}>{connector.slug} — {connector.baseUrl}</span>{' '}
          {connector.authType !== 'none' && (
            <span style={{ fontSize: '0.8em', padding: '1px 6px', borderRadius: 4, background: 'var(--surface, #eee)' }}>
              {connector.authType}{connector.authConfigured ? ' ✓' : ''}
            </span>
          )}
        </span>
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button" className="btn btn--danger btn--sm" onClick={(e) => { e.stopPropagation(); onDeleted(connector.slug); }}>Delete</button>
          <span>{expanded ? '▾' : '▸'}</span>
        </div>
      </div>
      {expanded && (
        <div style={{ marginTop: '0.8rem' }}>
          {requests.map(r => (
            <RequestRow key={r.id} api={api} connectorSlug={connector.slug} request={r} onDeleted={deleteRequest} />
          ))}
          <NewRequestForm api={api} connectorSlug={connector.slug} onCreated={loadRequests} />
        </div>
      )}
    </div>
  );
}

function NewConnectorForm({ api, onCreated }) {
  const [form, setForm] = useState({ name: '', slug: '', baseUrl: '', authType: 'none', authConfig: {}, headers: [] });
  const [error, setError] = useState('');

  async function create() {
    setError('');
    if (!form.name || !form.slug || !form.baseUrl) { setError('name, slug, and baseUrl are required'); return; }
    try {
      await api('/connectors', { method: 'POST', body: form });
      setForm({ name: '', slug: '', baseUrl: '', authType: 'none', authConfig: {}, headers: [] });
      onCreated();
    } catch (e) { setError(e.message); }
  }

  return (
    <div style={{ border: '1px dashed var(--border, #ccc)', borderRadius: 10, padding: '0.8rem 1rem', marginBottom: '1.5rem' }}>
      <div style={{ fontWeight: 600, marginBottom: 8 }}>+ New API Connector</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <div style={fieldStyle}><label style={labelStyle}>Name</label><input style={inputStyle} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Weather" /></div>
        <div style={fieldStyle}><label style={labelStyle}>Slug</label><input style={inputStyle} value={form.slug} onChange={e => setForm(f => ({ ...f, slug: e.target.value }))} placeholder="weather" /></div>
        <div style={{ ...fieldStyle, gridColumn: '1 / -1' }}><label style={labelStyle}>Base URL</label><input style={inputStyle} value={form.baseUrl} onChange={e => setForm(f => ({ ...f, baseUrl: e.target.value }))} placeholder="https://api.example.com" /></div>
        <div style={fieldStyle}>
          <label style={labelStyle}>Auth type</label>
          <select style={inputStyle} value={form.authType} onChange={e => setForm(f => ({ ...f, authType: e.target.value, authConfig: {} }))}>
            {AUTH_TYPES.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        {form.authType === 'bearer' && (
          <div style={fieldStyle}><label style={labelStyle}>Token</label><input style={inputStyle} type="password" value={form.authConfig.token || ''} onChange={e => setForm(f => ({ ...f, authConfig: { token: e.target.value } }))} /></div>
        )}
        {form.authType === 'api_key' && (
          <>
            <div style={fieldStyle}><label style={labelStyle}>Header name</label><input style={inputStyle} value={form.authConfig.headerName || ''} onChange={e => setForm(f => ({ ...f, authConfig: { ...f.authConfig, headerName: e.target.value } }))} placeholder="X-API-Key" /></div>
            <div style={fieldStyle}><label style={labelStyle}>Value</label><input style={inputStyle} type="password" value={form.authConfig.value || ''} onChange={e => setForm(f => ({ ...f, authConfig: { ...f.authConfig, value: e.target.value } }))} /></div>
          </>
        )}
        {form.authType === 'basic' && (
          <>
            <div style={fieldStyle}><label style={labelStyle}>Username</label><input style={inputStyle} value={form.authConfig.username || ''} onChange={e => setForm(f => ({ ...f, authConfig: { ...f.authConfig, username: e.target.value } }))} /></div>
            <div style={fieldStyle}><label style={labelStyle}>Password</label><input style={inputStyle} type="password" value={form.authConfig.password || ''} onChange={e => setForm(f => ({ ...f, authConfig: { ...f.authConfig, password: e.target.value } }))} /></div>
          </>
        )}
      </div>
      <div style={fieldStyle}>
        <label style={labelStyle}>Headers</label>
        <PairList pairs={form.headers} onChange={v => setForm(f => ({ ...f, headers: v }))} />
      </div>
      <button type="button" className="btn btn--primary btn--sm" onClick={create}>+ Create connector</button>
      {error && <div style={{ color: 'var(--danger, #d33)', fontSize: '0.8em', marginTop: 4 }}>{error}</div>}
    </div>
  );
}

function VariablesPanel({ api }) {
  const [variables, setVariables] = useState({});
  const [form, setForm] = useState({ name: '', value: '', defaultValue: '' });
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const data = await api('/variables');
      setVariables(data.variables);
    } catch { /* ignore */ }
  }, [api]);

  useEffect(() => { load(); }, [load]);

  async function create() {
    setError('');
    if (!form.name) { setError('name is required'); return; }
    try {
      await api('/variables', { method: 'POST', body: form });
      setForm({ name: '', value: '', defaultValue: '' });
      load();
    } catch (e) { setError(e.message); }
  }

  async function remove(name) {
    await api(`/variables/${encodeURIComponent(name)}`, { method: 'DELETE' });
    load();
  }

  const entries = Object.entries(variables);

  return (
    <div style={{ marginTop: '1.2rem', paddingTop: '0.8rem', borderTop: '1px solid var(--border, #eee)' }}>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>Variables</div>
      {entries.length === 0 && <p style={{ opacity: 0.6, fontSize: '0.85em' }}>No variables yet.</p>}
      {entries.map(([name, v]) => (
        <div key={name} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: '0.9em', marginBottom: 4 }}>
          <code>{`{{${name}}}`}</code>
          <span>= <strong>{v.value || <em>empty</em>}</strong></span>
          <span style={{ fontSize: '0.75em', opacity: 0.6 }}>({v.source}{v.resolvedAt ? `, resolved ${v.resolvedAt}` : ''})</span>
          <button type="button" className="btn btn--danger btn--sm" onClick={() => remove(name)}>✕</button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 6, marginTop: '0.6rem' }}>
        <input style={inputStyle} placeholder="name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
        <input style={inputStyle} placeholder="value" value={form.value} onChange={e => setForm(f => ({ ...f, value: e.target.value }))} />
        <input style={inputStyle} placeholder="default (optional)" value={form.defaultValue} onChange={e => setForm(f => ({ ...f, defaultValue: e.target.value }))} />
        <button type="button" className="btn btn--secondary btn--sm" onClick={create}>+ Add</button>
      </div>
      {error && <div style={{ color: 'var(--danger, #d33)', fontSize: '0.8em', marginTop: 4 }}>{error}</div>}
    </div>
  );
}

/**
 * ConnectorsSection — API Connectors & Variables card. Full CRUD for
 * Connectors → Requests → response mappings, plus manual variables, all
 * inline in the expanded card body (same convention as StorageSection/
 * SttSection/CameraSection) — no separate route.
 *
 * See docs/plans/plan_api_connectors_variables.md and
 * packages/plugins/lcyt-connectors/CLAUDE.md.
 */
export function ConnectorsSection() {
  const session = useSessionContext();
  const api = useApi(session);
  const [connectors, setConnectors] = useState([]);

  const load = useCallback(async () => {
    if (!session?.connected) return;
    try {
      const data = await api('/connectors');
      setConnectors(data.connectors);
    } catch { /* ignore */ }
  }, [api, session?.connected]);

  useEffect(() => { load(); }, [load]);

  async function deleteConnector(slug) {
    await api(`/connectors/${slug}`, { method: 'DELETE' });
    load();
  }

  return (
    <SetupCard
      id="connectors"
      icon="🔌"
      title="API connectors"
      description={
        session?.connected
          ? `${connectors.length} connector${connectors.length === 1 ? '' : 's'} configured. Connect third-party services and expose their responses as {{name}} variables.`
          : 'Connect third-party services (calendars, ChMS, lighting consoles, etc.) and expose their responses as {{name}} variables.'
      }
      status="ready"
    >
      <p style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: '0 0 0.8rem' }}>
        Trigger a refresh from a file line with <code>{'<!-- !api:slug.slug -->'}</code> (on
        arrival), <code>{'<!-- api:slug.slug -->'}</code> (at send), or{' '}
        <code>{'<!-- api!:slug.slug -->'}</code> (prefetched, small blocking fallback).
      </p>

      <NewConnectorForm api={api} onCreated={load} />

      {connectors.map(c => (
        <ConnectorCard key={c.id} api={api} connector={c} onDeleted={deleteConnector} />
      ))}
      {connectors.length === 0 && <p style={{ opacity: 0.6, fontSize: '0.9em' }}>No connectors yet — create one above.</p>}

      <VariablesPanel api={api} />
    </SetupCard>
  );
}
