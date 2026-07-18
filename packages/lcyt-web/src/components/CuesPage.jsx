import { useState, useEffect, useCallback, useContext } from 'react';
import { Link } from 'wouter';
import { SessionContext } from '../contexts/SessionContext';
import { useProjectRequired } from '../hooks/useProjectRequired';
import { Dialog } from './Dialog.jsx';
import { SetupItemRow } from './setup-hub/SetupCard.jsx';

// Phase 10 (plan_cues.md) scope: only today's simple, synchronous rule types
// are authorable here. `semantic`/`event_cue`/`music_start`/`music_stop`/
// `silence`/`composite` rules can exist (created via direct API calls, or —
// once Phase 9 ships — the named-condition tree builder) but aren't editable
// from this form; they still show up in the list (toggle/delete only).
const EDITABLE_MATCH_TYPES = [
  { value: 'phrase', label: 'Phrase', hint: 'Case-insensitive substring match. Use * as a wildcard (e.g. "Let us *").' },
  { value: 'regex', label: 'Regex', hint: 'JavaScript regular expression tested against the caption text.' },
  { value: 'section', label: 'Section', hint: 'Fires when the active <!-- section: --> name matches this value.' },
  { value: 'fuzzy', label: 'Fuzzy', hint: 'Jaro-Winkler similarity match — catches STT spelling variations.' },
];
const EDITABLE_TYPE_VALUES = EDITABLE_MATCH_TYPES.map(t => t.value);

const EMPTY_DRAFT = { name: '', match_type: 'phrase', pattern: '', enabled: true, cooldown_ms: 0, fuzzy_threshold: 0.75, actionLabel: '' };

function matchTypeLabel(matchType) {
  return EDITABLE_MATCH_TYPES.find(t => t.value === matchType)?.label || matchType;
}

function ruleMeta(rule) {
  const parts = [matchTypeLabel(rule.match_type)];
  if (rule.pattern) parts.push(rule.pattern);
  return parts.join(' · ');
}

/**
 * CuesManager — editor for `cue_rules` (plan_cues.md Phase 10, scoped to
 * phrase/regex/section/fuzzy per the roadmap — composite trees + named
 * conditions land once Phase 9 ships). Reads/writes the existing
 * `GET/POST/PUT/DELETE /cues/rules` API, unchanged.
 *
 * Two homes: the standalone `/cues` page (`CuesPage`, below — reached from
 * the Assets page's "Global cues" card) and, embedded (`embedded` prop, same
 * convention as `LanguagesManager`), the Planner's right-column
 * `PlannerAssistPanel` Cues tab.
 */
export function CuesManager({ embedded = false }) {
  const session = useContext(SessionContext);
  const backendUrl = session?.backendUrl || '';

  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [formError, setFormError] = useState(null);

  const [editing, setEditing] = useState(null); // null | 'new' | rule object
  const [draft, setDraft] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);

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
      const r = await authedFetch('/cues/rules');
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      setRules(Array.isArray(data.rules) ? data.rules : []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [session?.connected, authedFetch]);

  useEffect(() => { load(); }, [load]);

  function openNew() {
    setFormError(null);
    setEditing('new');
    setDraft({ ...EMPTY_DRAFT });
  }

  function openEdit(rule) {
    setFormError(null);
    setEditing(rule);
    setDraft({
      name: rule.name || '',
      match_type: EDITABLE_TYPE_VALUES.includes(rule.match_type) ? rule.match_type : rule.match_type,
      pattern: rule.pattern || '',
      enabled: rule.enabled !== false,
      cooldown_ms: rule.cooldown_ms ?? 0,
      fuzzy_threshold: rule.fuzzy_threshold ?? 0.75,
      actionLabel: rule.action?.label || '',
    });
  }

  function closeDialog() {
    setEditing(null);
    setDraft(null);
    setFormError(null);
  }

  async function handleSave() {
    if (!draft || !draft.name || !draft.pattern) return;
    setFormError(null);

    if (draft.match_type === 'regex') {
      try { new RegExp(draft.pattern); } catch {
        setFormError('Invalid regular expression.');
        return;
      }
    }

    const isNew = editing === 'new';
    const body = {
      name: draft.name,
      match_type: draft.match_type,
      pattern: draft.pattern,
      enabled: draft.enabled,
      cooldown_ms: Number(draft.cooldown_ms) || 0,
      action: draft.actionLabel ? { type: 'event', label: draft.actionLabel } : {},
    };
    if (draft.match_type === 'fuzzy') body.fuzzy_threshold = Number(draft.fuzzy_threshold);

    try {
      const r = await authedFetch(isNew ? '/cues/rules' : `/cues/rules/${editing.id}`, {
        method: isNew ? 'POST' : 'PUT',
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      closeDialog();
      load();
    } catch (e) {
      setFormError(e.message);
    }
  }

  async function handleDelete(rule) {
    try {
      const r = await authedFetch(`/cues/rules/${rule.id}`, { method: 'DELETE' });
      if (!r.ok) { const data = await r.json().catch(() => ({})); throw new Error(data.error || `HTTP ${r.status}`); }
      setConfirmDelete(null);
      load();
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleToggleEnabled(rule) {
    setRules(list => list.map(r => r.id === rule.id ? { ...r, enabled: !(rule.enabled !== false) } : r));
    try {
      const r = await authedFetch(`/cues/rules/${rule.id}`, {
        method: 'PUT',
        body: JSON.stringify({ enabled: !(rule.enabled !== false) }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
    } catch (e) {
      setError(e.message);
      load();
    }
  }

  const editingIsCustomType = editing && editing !== 'new' && !EDITABLE_TYPE_VALUES.includes(editing.match_type);
  const selectedType = draft ? EDITABLE_MATCH_TYPES.find(t => t.value === draft.match_type) : null;

  return (
    <div style={embedded ? { padding: 12, display: 'flex', flexDirection: 'column', gap: 8 } : { padding: 20, maxWidth: 720, margin: '0 auto' }}>
      {embedded ? (
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button className="btn btn--primary btn--sm" onClick={openNew} disabled={!!editing}>
            + Add rule
          </button>
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4, gap: 12 }}>
            <h1 style={{ margin: 0, fontSize: 20 }}>Cue Rules</h1>
            <button className="btn btn--primary btn--sm" onClick={openNew} disabled={!!editing}>
              + Add rule
            </button>
          </div>
          <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--color-text-muted)' }}>
            Persistent cue rules that trigger on spoken phrases, sections, or fuzzy matches — independent of any
            rundown file. See <Link href="/assets">Assets</Link> for the full cue count.
          </p>
        </>
      )}

      {error && <div style={{ color: 'var(--color-error)', margin: '0 0 12px', fontSize: 13 }}>{error}</div>}

      {editing && draft && (
        <Dialog title={editing === 'new' ? 'Add cue rule' : (editing.name || 'Edit cue rule')} onClose={closeDialog} width={520}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {formError && <div style={{ color: 'var(--color-error)', fontSize: 13 }}>{formError}</div>}

            <div className="settings-field">
              <label className="settings-field__label">Name</label>
              <input
                className="settings-field__input"
                type="text"
                value={draft.name}
                onChange={e => setDraft({ ...draft, name: e.target.value })}
                placeholder="e.g. Prayer response"
              />
            </div>

            {editingIsCustomType ? (
              <div className="settings-field">
                <label className="settings-field__label">Match type</label>
                <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)' }}>
                  {`"${editing.match_type}" rules aren't editable from this form yet — only name, enabled, and cooldown can be changed here. Delete and recreate the rule to change its pattern or type.`}
                </p>
              </div>
            ) : (
              <>
                <div className="settings-field">
                  <label className="settings-field__label">Match type</label>
                  <select
                    className="settings-field__input"
                    value={draft.match_type}
                    onChange={e => setDraft({ ...draft, match_type: e.target.value })}
                  >
                    {EDITABLE_MATCH_TYPES.map(t => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                  {selectedType && <span className="settings-field__hint">{selectedType.hint}</span>}
                </div>

                <div className="settings-field">
                  <label className="settings-field__label">
                    {draft.match_type === 'section' ? 'Section name' : 'Pattern'}
                  </label>
                  <input
                    className="settings-field__input"
                    type="text"
                    value={draft.pattern}
                    onChange={e => setDraft({ ...draft, pattern: e.target.value })}
                    placeholder={draft.match_type === 'regex' ? '\\bamen\\b' : 'we beseech thee'}
                  />
                </div>

                {draft.match_type === 'fuzzy' && (
                  <div className="settings-field">
                    <label className="settings-field__label">
                      Fuzzy threshold ({Math.round((draft.fuzzy_threshold ?? 0.75) * 100)}%)
                    </label>
                    <input
                      type="range"
                      min="0.5"
                      max="1.0"
                      step="0.01"
                      value={draft.fuzzy_threshold ?? 0.75}
                      onChange={e => setDraft({ ...draft, fuzzy_threshold: parseFloat(e.target.value) })}
                      style={{ width: '100%' }}
                    />
                    <span className="settings-field__hint">Lower values match more loosely.</span>
                  </div>
                )}
              </>
            )}

            <div className="settings-field">
              <label className="settings-field__label">Cooldown (ms)</label>
              <input
                className="settings-field__input"
                type="number"
                min="0"
                value={draft.cooldown_ms}
                onChange={e => setDraft({ ...draft, cooldown_ms: e.target.value })}
              />
              <span className="settings-field__hint">Minimum time between repeat firings of this rule. 0 = no cooldown.</span>
            </div>

            <div className="settings-field">
              <label className="settings-field__label">Log label (optional)</label>
              <input
                className="settings-field__input"
                type="text"
                value={draft.actionLabel}
                onChange={e => setDraft({ ...draft, actionLabel: e.target.value })}
                placeholder="Shown in the cue events log when this rule fires"
              />
            </div>

            <div className="settings-field">
              <label className="settings-checkbox">
                <input
                  type="checkbox"
                  checked={draft.enabled}
                  onChange={e => setDraft({ ...draft, enabled: e.target.checked })}
                />
                Enabled
              </label>
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn--ghost" onClick={closeDialog}>Cancel</button>
              <button className="btn btn--primary" onClick={handleSave} disabled={!draft.name || !draft.pattern}>
                {editing === 'new' ? 'Create' : 'Save'}
              </button>
            </div>
          </div>
        </Dialog>
      )}

      {loading ? (
        <p style={{ color: 'var(--color-text-muted)' }}>Loading…</p>
      ) : !session?.connected ? (
        <p style={{ color: 'var(--color-text-muted)' }}>Connect to a project to manage cue rules.</p>
      ) : rules.length === 0 ? (
        <p style={{ color: 'var(--color-text-muted)' }}>No cue rules yet — add one to get started.</p>
      ) : (
        <div className="setup-card">
          {rules.map(rule => (
            <SetupItemRow
              key={rule.id}
              name={rule.name || 'Cue rule'}
              meta={ruleMeta(rule)}
              faded={rule.enabled === false}
              toggleOn={rule.enabled !== false}
              onToggle={() => handleToggleEnabled(rule)}
              onSettings={() => openEdit(rule)}
              onDelete={() => setConfirmDelete(rule)}
            />
          ))}
        </div>
      )}

      {confirmDelete && (
        <Dialog title="Delete cue rule?" onClose={() => setConfirmDelete(null)}>
          <p style={{ margin: '0 0 16px', fontSize: 14 }}>
            Delete the <strong>{confirmDelete.name || 'cue rule'}</strong>?
          </p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn btn--ghost" onClick={() => setConfirmDelete(null)}>Cancel</button>
            <button className="btn btn--danger" onClick={() => handleDelete(confirmDelete)}>Delete</button>
          </div>
        </Dialog>
      )}
    </div>
  );
}

/** CuesPage — `/cues`, the standalone-page wrapper around `CuesManager`. */
export function CuesPage() {
  useProjectRequired();
  return <CuesManager />;
}
