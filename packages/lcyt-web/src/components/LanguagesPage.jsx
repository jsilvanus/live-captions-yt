import { useState, useEffect, useCallback, useContext, forwardRef, useImperativeHandle } from 'react';
import { useLang } from '../contexts/LangContext';
import { SessionContext } from '../contexts/SessionContext';
import { COMMON_LANGUAGES } from '../lib/sttConfig';
import { TRANSLATION_VENDORS } from '../lib/translationConfig';
import { Dialog } from './Dialog.jsx';
import { LanguagePicker } from './LanguagePicker.jsx';
import { SetupItemRow } from './setup-hub/SetupCard.jsx';
import { TranslationRow, TranslationVendorSettings } from './panels/TranslationPanel.jsx';

const EMPTY_NEW = { enabled: true, lang: 'en-US', target: 'captions' };

function langLabel(entry) {
  return COMMON_LANGUAGES.find(l => l.code === entry.lang)?.label || entry.lang;
}

function sourceLangLabel(code) {
  return COMMON_LANGUAGES.find(l => l.code === code)?.label || code;
}

function targetMeta(entry, t) {
  if (entry.target === 'captions') return t('settings.translation.targets.captions');
  const fmt = entry.format || 'youtube';
  const dest = entry.target === 'backend-file' ? t('settings.translation.targets.backendFile') : t('settings.translation.targets.file');
  return `${dest} · ${t('settings.translation.formats.' + fmt)}`;
}

/**
 * LanguagesManager — full add/edit/delete for translation targets, a quick
 * enable/disable toggle per row, a "Source language" row (reads/writes the
 * existing `/stt/config`'s `language` field — a stand-in for
 * `docs/plans/plan_server_stt.md` Phase 5's project-curated predefined list,
 * which doesn't exist server-side yet), and a "Translation provider" row for
 * vendor settings.
 *
 * Server-backed via `GET/PUT /translation/config*`
 * (`docs/plans/plan_selfservice_config_backend.md` §1 — implemented
 * server-side in PR #239, but not consumed here until now: this component
 * previously used localStorage `lib/translationConfig.js` by mistake).
 * Reuses `TranslationRow`/`TranslationVendorSettings` (extracted from
 * `TranslationPanel.jsx`) as Dialog content, same pattern as
 * `CaptionTargetsManager` reusing `TargetRow`.
 */
export const LanguagesManager = forwardRef(function LanguagesManager({ embedded = false }, ref) {
  const { t } = useLang();
  const session = useContext(SessionContext);
  const backendUrl = session?.backendUrl || '';

  const [translations, setTranslations] = useState([]);
  const [vendorConfig, setVendorConfig] = useState({ vendor: 'mymemory', vendorApiKey: '', libreUrl: '', libreKey: '', showOriginal: false });
  const [sttLanguage, setSttLanguage] = useState('en-US');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [editing, setEditing] = useState(null); // null | 'new' | entry object
  const [draft, setDraft] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [providerOpen, setProviderOpen] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [sourceDraft, setSourceDraft] = useState('en-US');

  const hasCaptionTarget = translations.some(r => r.target === 'captions' && (editing === 'new' || r.id !== editing?.id));

  const authedFetch = useCallback((path, opts = {}) => {
    const token = session?.getSessionToken?.();
    return fetch(`${backendUrl}${path}`, {
      ...opts,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(opts.headers || {}) },
    });
  }, [session, backendUrl]);

  const load = useCallback(async () => {
    if (!session?.connected) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const [translationRes, sttRes] = await Promise.all([
        authedFetch('/translation/config'),
        authedFetch('/stt/config'),
      ]);
      const translationData = await translationRes.json();
      if (!translationRes.ok) throw new Error(translationData.error || `HTTP ${translationRes.status}`);
      setTranslations(translationData.targets || []);
      setVendorConfig({ showOriginal: false, ...(translationData.vendor || {}) });

      const sttData = await sttRes.json().catch(() => ({}));
      if (sttRes.ok) setSttLanguage(sttData.config?.language || 'en-US');
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [session?.connected, authedFetch]);

  useEffect(() => { load(); }, [load]);

  useImperativeHandle(ref, () => ({ openAdd: () => { setEditing('new'); setDraft(EMPTY_NEW); } }));

  function openEdit(entry) {
    setEditing(entry);
    setDraft(entry);
  }

  async function handleSave() {
    if (!draft || !draft.lang) return;
    setError(null);
    const isNew = editing === 'new';
    try {
      const r = await authedFetch(isNew ? '/translation/config/targets' : `/translation/config/targets/${editing.id}`, {
        method: isNew ? 'POST' : 'PUT',
        body: JSON.stringify({ enabled: draft.enabled, lang: draft.lang, target: draft.target, format: draft.format ?? null }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      setEditing(null);
      setDraft(null);
      load();
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleDelete(entry) {
    try {
      const r = await authedFetch(`/translation/config/targets/${entry.id}`, { method: 'DELETE' });
      if (!r.ok) { const data = await r.json().catch(() => ({})); throw new Error(data.error || `HTTP ${r.status}`); }
      setConfirmDelete(null);
      load();
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleToggleEnabled(entry) {
    // Optimistic — instant enable/disable without opening the edit dialog.
    setTranslations(list => list.map(r => r.id === entry.id ? { ...r, enabled: !r.enabled } : r));
    try {
      const r = await authedFetch(`/translation/config/targets/${entry.id}`, {
        method: 'PUT',
        body: JSON.stringify({ enabled: !entry.enabled }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
    } catch (e) {
      setError(e.message);
      load(); // revert optimistic update on failure
    }
  }

  async function updateVendorConfig(patch) {
    const next = { ...vendorConfig, ...patch };
    setVendorConfig(next);
    try {
      const r = await authedFetch('/translation/config/vendor', { method: 'PUT', body: JSON.stringify(patch) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
    } catch (e) {
      setError(e.message);
    }
  }

  function openSourcePicker() {
    setSourceDraft(sttLanguage);
    setSourceOpen(true);
  }

  async function handleSourceSave() {
    setError(null);
    try {
      const r = await authedFetch('/stt/config', { method: 'PUT', body: JSON.stringify({ language: sourceDraft }) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      setSttLanguage(sourceDraft);
      setSourceOpen(false);
    } catch (e) {
      setError(e.message);
    }
  }

  const vendorLabel = t(TRANSLATION_VENDORS.find(v => v.value === vendorConfig.vendor)?.labelKey || vendorConfig.vendor);

  return (
    <div style={embedded ? undefined : { padding: 20, maxWidth: 700, margin: '0 auto' }}>
      {!embedded && (
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16, gap: 12 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Languages</h2>
          <button className="btn btn--primary btn--sm" onClick={() => { setEditing('new'); setDraft(EMPTY_NEW); }} disabled={!!editing}>
            + Add language
          </button>
        </div>
      )}
      {error && <div style={{ color: 'var(--color-error)', margin: embedded ? '0 18px 12px' : '0 0 12px', fontSize: 13 }}>{error}</div>}

      {editing && draft && (
        <Dialog title={editing === 'new' ? 'Add language' : langLabel(editing)} onClose={() => { setEditing(null); setDraft(null); }} width={600}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <TranslationRow
              entry={draft}
              onChange={setDraft}
              hasExistingCaptionTarget={hasCaptionTarget}
              t={t}
              hideRemove
            />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn--ghost" onClick={() => { setEditing(null); setDraft(null); }}>Cancel</button>
              <button className="btn btn--primary" onClick={handleSave} disabled={!draft.lang}>
                {editing === 'new' ? 'Create' : 'Save'}
              </button>
            </div>
          </div>
        </Dialog>
      )}

      <div className={embedded ? undefined : 'setup-card'} style={embedded ? undefined : { marginBottom: 12 }}>
        <SetupItemRow
          name="Source language"
          meta={`What's being spoken/transcribed — ${sourceLangLabel(sttLanguage)}`}
          onSettings={openSourcePicker}
        />
      </div>

      {loading ? (
        <p style={{ color: 'var(--color-text-muted)', padding: embedded ? '0 18px 14px' : 0 }}>Loading…</p>
      ) : !session?.connected ? (
        <p className={embedded ? 'setup-card__empty' : undefined} style={embedded ? undefined : { color: 'var(--color-text-muted)' }}>Connect to a project to configure languages.</p>
      ) : translations.length === 0 ? (
        <p className={embedded ? 'setup-card__empty' : undefined} style={embedded ? undefined : { color: 'var(--color-text-muted)' }}>
          {t('settings.translation.noTranslations')}
        </p>
      ) : (
        <div className={embedded ? undefined : 'setup-card'}>
          {translations.map(entry => (
            <SetupItemRow
              key={entry.id}
              name={langLabel(entry)}
              meta={targetMeta(entry, t)}
              badge={vendorLabel}
              faded={!entry.enabled}
              toggleOn={entry.enabled}
              onToggle={() => handleToggleEnabled(entry)}
              onSettings={() => openEdit(entry)}
              onDelete={() => setConfirmDelete(entry)}
            />
          ))}
        </div>
      )}

      <div className={embedded ? undefined : 'setup-card'} style={embedded ? { marginTop: 4 } : { marginTop: 12 }}>
        <SetupItemRow
          name="Translation provider"
          meta={vendorLabel}
          onSettings={() => setProviderOpen(true)}
        />
      </div>

      {sourceOpen && (
        <Dialog title="Source language" onClose={() => setSourceOpen(false)} width={420}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)' }}>
              The language being spoken/transcribed. Changing this restarts server-side STT if it's currently running.
            </p>
            <LanguagePicker value={sourceDraft} onChange={setSourceDraft} />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn--ghost" onClick={() => setSourceOpen(false)}>Cancel</button>
              <button className="btn btn--primary" onClick={handleSourceSave}>Save</button>
            </div>
          </div>
        </Dialog>
      )}

      {providerOpen && (
        <Dialog title="Translation provider" onClose={() => setProviderOpen(false)} width={480}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <TranslationVendorSettings
              vendor={vendorConfig.vendor}
              onVendorChange={v => updateVendorConfig({ vendor: v })}
              vendorKey={vendorConfig.vendorApiKey || ''}
              onVendorKeyChange={k => updateVendorConfig({ vendorApiKey: k })}
              libreUrl={vendorConfig.libreUrl || ''}
              onLibreUrlChange={u => updateVendorConfig({ libreUrl: u })}
              libreKey={vendorConfig.libreKey || ''}
              onLibreKeyChange={k => updateVendorConfig({ libreKey: k })}
            />
            {translations.some(r => r.target === 'captions') && (
              <div className="settings-field">
                <label className="settings-checkbox">
                  <input type="checkbox" checked={vendorConfig.showOriginal} onChange={e => updateVendorConfig({ showOriginal: e.target.checked })} />
                  {t('settings.translation.showOriginal')}
                </label>
                <span className="settings-field__hint">{t('settings.translation.showOriginalHint')}</span>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button className="btn btn--primary" onClick={() => setProviderOpen(false)}>Done</button>
            </div>
          </div>
        </Dialog>
      )}

      {confirmDelete && (
        <Dialog title="Delete language?" onClose={() => setConfirmDelete(null)}>
          <p style={{ margin: '0 0 16px', fontSize: 14 }}>
            Delete the <strong>{langLabel(confirmDelete)}</strong> translation?
          </p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn btn--ghost" onClick={() => setConfirmDelete(null)}>Cancel</button>
            <button className="btn btn--danger" onClick={() => handleDelete(confirmDelete)}>Delete</button>
          </div>
        </Dialog>
      )}
    </div>
  );
});

/** LanguagesPage — standalone route wrapper around LanguagesManager. */
export function LanguagesPage() {
  return <LanguagesManager />;
}
