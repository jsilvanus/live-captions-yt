import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSessionContext } from '../../contexts/SessionContext.jsx';
import { useUserAuth } from '../../hooks/useUserAuth.js';
import { createMcpToken, deleteMcpToken, listMcpTokens, updateMcpToken } from '../../lib/aiAdminApi.js';
import { Dialog } from '../Dialog.jsx';
import { SetupCard, SetupItemRow } from './SetupCard.jsx';
import { ApiConnectorsIcon } from './icons.jsx';

const EMPTY_FORM = { label: '', active: true, restrict: false, scopes: [] };

// Scope grants offered when a token is restricted. Values map directly to the
// backend scope grammar: `events:read` is the resource:verb gate for
// GET /events/stream (checked by tokenHasScope), the rest are dotted event-bus
// topic patterns that narrow which topics the token may subscribe to (checked
// by tokenAllowsTopic). An empty/absent scope set = full access.
const SCOPE_OPTIONS = [
  { value: 'events:read', label: 'Event stream access', hint: 'Required for the unified event stream (/events/stream)' },
  { value: 'dsk.*', label: 'DSK graphics events', hint: 'dsk.*' },
  { value: 'variable.updated', label: 'Variable updates', hint: 'variable.updated' },
  { value: 'cue.fired', label: 'Cue fires', hint: 'cue.fired' },
  { value: 'role.*', label: 'AI role & assistant events', hint: 'role.*' },
  { value: 'caption.*', label: 'Caption results', hint: 'caption.*' },
  { value: 'session.*', label: 'Session lifecycle', hint: 'session.*' },
];

export function McpAccessSection() {
  const session = useSessionContext();
  const { user, token: userToken, backendUrl: userBackendUrl } = useUserAuth();
  const backendUrl = userBackendUrl || session?.backendUrl || '';
  const apiKey = session?.apiKey || '';
  const [tokens, setTokens] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editingToken, setEditingToken] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [createdToken, setCreatedToken] = useState('');
  const [error, setError] = useState('');

  const creatorName = useMemo(() => user?.name || user?.email || 'You', [user]);

  const load = useCallback(async () => {
    if (!backendUrl || !userToken || !apiKey) {
      setTokens([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const rows = await listMcpTokens({ backendUrl, token: userToken, apiKey });
      setTokens(rows);
    } catch (err) {
      setTokens([]);
      setError(err.message || 'Unable to load MCP tokens');
    } finally {
      setLoading(false);
    }
  }, [apiKey, backendUrl, userToken]);

  useEffect(() => { load(); }, [load]);

  function closeDialog() {
    setOpen(false);
    setEditingToken(null);
    setCreatedToken('');
    setForm(EMPTY_FORM);
    setError('');
  }

  function openCreate() {
    setEditingToken(null);
    setCreatedToken('');
    setForm({ ...EMPTY_FORM });
    setError('');
    setOpen(true);
  }

  function openEdit(token) {
    setEditingToken(token);
    setCreatedToken('');
    // Scopes aren't returned by GET /mcp-tokens, so editing is label/active only.
    setForm({ label: token.label, active: token.active, restrict: false, scopes: [] });
    setError('');
    setOpen(true);
  }

  function toggleScope(value) {
    setForm(prev => ({
      ...prev,
      scopes: prev.scopes.includes(value)
        ? prev.scopes.filter(s => s !== value)
        : [...prev.scopes, value],
    }));
  }

  async function handleSave(event) {
    event.preventDefault();
    if (!form.label.trim()) {
      setError('Enter a token name');
      return;
    }
    if (!editingToken && form.restrict && form.scopes.length === 0) {
      setError('Select at least one scope, or turn off "Restrict access" for full access.');
      return;
    }
    try {
      const payload = editingToken
        ? await updateMcpToken({
            backendUrl,
            token: userToken,
            apiKey,
            id: editingToken.id,
            label: form.label.trim(),
            createdByName: creatorName,
            active: form.active,
          })
        : await createMcpToken({
            backendUrl,
            token: userToken,
            apiKey,
            label: form.label.trim(),
            createdByName: creatorName,
            active: form.active,
            scopes: form.restrict ? form.scopes : undefined,
          });
      if (!editingToken && payload?.token) {
        setCreatedToken(payload.token);
        await load();
        return;
      }
      await load();
      closeDialog();
    } catch (err) {
      setError(err.message || 'Unable to save token');
    }
  }

  async function handleToggle(token) {
    try {
      await updateMcpToken({
        backendUrl,
        token: userToken,
        apiKey,
        id: token.id,
        label: token.label,
        createdByName: token.createdByName || creatorName,
        active: !token.active,
      });
      await load();
    } catch (err) {
      setError(err.message || 'Unable to update token');
    }
  }

  async function handleDelete(token) {
    if (!confirm(`Revoke ${token.label}?`)) return;
    try {
      await deleteMcpToken({ backendUrl, token: userToken, apiKey, id: token.id });
      await load();
      if (open) closeDialog();
    } catch (err) {
      setError(err.message || 'Unable to revoke token');
    }
  }

  const content = loading ? (
    <p className="setup-card__empty">Loading MCP tokens…</p>
  ) : tokens.length > 0 ? (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
      {tokens.map(token => (
        <SetupItemRow
          key={token.id}
          name={token.label}
          meta={`Created by ${token.createdByName || 'Unknown'}`}
          badge={token.active ? 'Active' : 'Revoked'}
          toggleOn={token.active}
          onToggle={() => handleToggle(token)}
          onSettings={() => openEdit(token)}
          onDelete={() => handleDelete(token)}
        />
      ))}
    </div>
  ) : (
    <p className="setup-card__empty">No MCP tokens yet. Create one to connect Claude Desktop or Code.</p>
  );

  return (
    <>
      <SetupCard
        id="mcp-access"
        icon={ApiConnectorsIcon}
        color="teal"
        title="MCP access"
        description="Personal access tokens for MCP clients such as Claude Desktop or Code."
        headerAction={{ label: 'Add token', onClick: openCreate }}
      >
        {content}
      </SetupCard>

      {open && (
        <Dialog title={editingToken ? 'Edit MCP token' : 'Create MCP token'} onClose={closeDialog} width={560}>
          {createdToken ? (
            <div>
              <p style={{ marginBottom: '0.75rem' }}>
                Copy this token now. It will not be shown again.
              </p>
              <div style={{ padding: '0.75rem 0.9rem', background: 'var(--color-surface-alt)', borderRadius: 8, fontFamily: 'monospace', wordBreak: 'break-all' }}>
                {createdToken}
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1rem' }}>
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => navigator.clipboard?.writeText(createdToken).catch(() => {})}>Copy</button>
                <button type="button" className="btn btn--sm" onClick={closeDialog}>Done</button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSave}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                  <span style={{ fontWeight: 600 }}>Token name</span>
                  <input
                    value={form.label}
                    onChange={event => setForm(prev => ({ ...prev, label: event.target.value }))}
                    placeholder="Claude Desktop"
                    style={{ padding: '0.6rem 0.75rem', borderRadius: 6, border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)' }}
                  />
                </label>

                <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                  <span style={{ fontWeight: 600 }}>Created by</span>
                  <input
                    value={creatorName}
                    readOnly
                    style={{ padding: '0.6rem 0.75rem', borderRadius: 6, border: '1px solid var(--color-border)', background: 'var(--color-surface-alt)', color: 'var(--color-text-muted)' }}
                  />
                </label>

                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <input type="checkbox" checked={!!form.active} onChange={event => setForm(prev => ({ ...prev, active: event.target.checked }))} />
                  <span>Active</span>
                </label>

                {!editingToken && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <input
                        type="checkbox"
                        checked={!!form.restrict}
                        onChange={event => setForm(prev => ({ ...prev, restrict: event.target.checked }))}
                      />
                      <span style={{ fontWeight: 600 }}>Restrict access</span>
                    </label>
                    {form.restrict ? (
                      <fieldset style={{ border: '1px solid var(--color-border)', borderRadius: 6, padding: '0.6rem 0.75rem', margin: 0, display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                        <legend style={{ padding: '0 0.35rem', fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>Scopes</legend>
                        {SCOPE_OPTIONS.map(opt => (
                          <label key={opt.value} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}>
                            <input
                              type="checkbox"
                              checked={form.scopes.includes(opt.value)}
                              onChange={() => toggleScope(opt.value)}
                              style={{ marginTop: '0.2rem' }}
                            />
                            <span style={{ display: 'flex', flexDirection: 'column' }}>
                              <span>{opt.label}</span>
                              <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', fontFamily: 'monospace' }}>{opt.hint}</span>
                            </span>
                          </label>
                        ))}
                        <p style={{ margin: '0.2rem 0 0', fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                          To subscribe to the event stream, include <strong>Event stream access</strong>. Adding topic scopes narrows which events the token receives; with none selected it can read all topics.
                        </p>
                      </fieldset>
                    ) : (
                      <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                        Full access — the token can use every project API and event topic.
                      </p>
                    )}
                  </div>
                )}

                {error && <div style={{ color: 'var(--color-danger, #c2410c)', fontSize: '0.9rem' }}>{error}</div>}
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1rem' }}>
                <div>
                  {editingToken && (
                    <button type="button" className="btn btn--ghost btn--sm" onClick={() => handleDelete(editingToken)}>
                      Revoke token
                    </button>
                  )}
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button type="button" className="btn btn--ghost btn--sm" onClick={closeDialog}>Cancel</button>
                  <button type="submit" className="btn btn--sm">Save</button>
                </div>
              </div>
            </form>
          )}
        </Dialog>
      )}
    </>
  );
}
