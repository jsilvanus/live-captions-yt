import { useState, useEffect, useCallback } from 'react';
import { useSessionContext } from '../../contexts/SessionContext';
import { SetupCard, SetupItemRow } from './SetupCard.jsx';
import { WebRadioIcon } from './icons.jsx';
import { Dialog } from '../Dialog.jsx';

/**
 * WebRadioSection — audio-only HLS "radio" stream, per the mockup's
 * `WebRadioCard.dc.html`. Wired against `GET/PUT /radio/config` as specced
 * in `docs/plans/plan_selfservice_config_backend.md` §3/§3a — not
 * implemented server-side yet, so this fails soft against a real backend.
 *
 * The mock's single item-row toggle maps to `autoplay`, not `radio_enabled`
 * — that admin entitlement flag stays read-only per §3's own reasoning
 * (nascent abuse surface, no site-feature-policy tri-state system yet).
 */
export function WebRadioSection() {
  const session = useSessionContext();
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);

  const authedFetch = useCallback((path, opts = {}) => {
    const token = session.getSessionToken?.();
    return fetch(`${session.backendUrl}${path}`, {
      ...opts,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(opts.headers || {}) },
    });
  }, [session]);

  const load = useCallback(async () => {
    if (!session?.connected) return;
    setLoading(true);
    try {
      const r = await authedFetch('/radio/config');
      if (r.ok) setConfig((await r.json()) || null);
    } catch { /* backend not implemented yet — leave config null */ }
    finally { setLoading(false); }
  }, [session?.connected, authedFetch]);

  useEffect(() => { load(); }, [load]);

  function openDialog() {
    setDraft({
      title: config?.title || '',
      description: config?.description || '',
      coverImageUrl: config?.coverImageUrl || '',
      autoplay: !!config?.autoplay,
    });
    setOpen(true);
  }

  async function save(patch) {
    const next = { ...draft, ...patch };
    setDraft(next);
    setSaving(true);
    try {
      const r = await authedFetch('/radio/config', { method: 'PUT', body: JSON.stringify(next) });
      if (r.ok) setConfig(await r.json());
    } catch { /* ignore — backend not implemented yet */ }
    finally { setSaving(false); }
  }

  async function toggleAutoplay() {
    const next = !config?.autoplay;
    setConfig(c => c ? { ...c, autoplay: next } : c);
    try {
      const r = await authedFetch('/radio/config', { method: 'PUT', body: JSON.stringify({ autoplay: next }) });
      if (r.ok) setConfig(await r.json());
    } catch { /* optimistic update stands */ }
  }

  const configured = !!config?.title;

  return (
    <SetupCard
      id="radio"
      icon={WebRadioIcon}
      color="cyan"
      title="Web Radio"
      description="Audio-only HLS output with CORS-controlled listener access."
      status="ready"
      headerAction={!configured ? { label: 'Configure', onClick: openDialog } : undefined}
    >
      {!session?.connected ? (
        <p className="setup-card__empty">Connect to a project to configure Web Radio.</p>
      ) : loading ? (
        <p className="setup-card__empty">Loading…</p>
      ) : config && !config.enabled ? (
        <p className="setup-card__empty">Not enabled for this project — contact an admin.</p>
      ) : !configured ? (
        <p className="setup-card__empty">Not configured — click Configure to create a Web Radio stream.</p>
      ) : (
        <SetupItemRow
          name={config.title}
          meta={config.description || (config.live ? 'Live' : 'Configured, not currently streaming')}
          statusDot={config.live ? 'var(--color-success)' : 'var(--color-text-muted)'}
          toggleOn={!!config.autoplay}
          onToggle={toggleAutoplay}
          onSettings={openDialog}
        />
      )}

      {open && draft && (
        <Dialog title="Web Radio" onClose={() => setOpen(false)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="settings-field">
              <label className="settings-field__label">Title *</label>
              <input className="settings-field__input" value={draft.title}
                onChange={e => setDraft(d => ({ ...d, title: e.target.value }))} placeholder="Sunday Service Audio" autoFocus />
            </div>
            <div className="settings-field">
              <label className="settings-field__label">Description</label>
              <input className="settings-field__input" value={draft.description}
                onChange={e => setDraft(d => ({ ...d, description: e.target.value }))} placeholder="Live audio feed" />
            </div>
            <div className="settings-field">
              <label className="settings-field__label">Cover image URL</label>
              <input className="settings-field__input" value={draft.coverImageUrl}
                onChange={e => setDraft(d => ({ ...d, coverImageUrl: e.target.value }))} placeholder="https://…" />
            </div>
            <label className="settings-checkbox">
              <input type="checkbox" checked={draft.autoplay} onChange={e => setDraft(d => ({ ...d, autoplay: e.target.checked }))} />
              Autoplay (muted, per browser autoplay policy)
            </label>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn--ghost" onClick={() => setOpen(false)}>Cancel</button>
              <button className="btn btn--primary" onClick={() => save(draft).then(() => setOpen(false))} disabled={!draft.title.trim() || saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </Dialog>
      )}
    </SetupCard>
  );
}
