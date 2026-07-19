import { useState, useEffect, useCallback, useContext } from 'react';
import { Link } from 'wouter';
import { SessionContext } from '../contexts/SessionContext';
import { useProjectRequired } from '../hooks/useProjectRequired';
import { Dialog } from './Dialog.jsx';
import { SetupItemRow } from './setup-hub/SetupCard.jsx';
import { ConditionTreeEditor, summarizeConditionTree } from './ConditionTreeEditor.jsx';

// Phase 10 (plan_cues.md) scope, extended in the Phase 9 frontend follow-up:
// every synchronous/composable rule type is authorable here now that
// /cues/defs and condition_tree exist. `semantic`/`event_cue`/
// `music_start`/`music_stop`/`silence` rules can still exist (created via
// direct API calls, or inline `cue[semantic]:`/`cue[events]:`) but aren't
// editable from this form — they still show up in the list (toggle/delete
// only), since there's no meaningful form to build for them here (semantic/
// event_cue are single-condition-only concepts already covered by their own
// inline metacode syntax, and the sound-cue types are configured by audio
// events, not authored by hand).
const EDITABLE_MATCH_TYPES = [
  { value: 'phrase', label: 'Phrase', hint: 'Case-insensitive substring match. Use * as a wildcard (e.g. "Let us *").' },
  { value: 'regex', label: 'Regex', hint: 'JavaScript regular expression tested against the caption text.' },
  { value: 'section', label: 'Section', hint: 'Fires when the active <!-- section: --> name matches this value.' },
  { value: 'fuzzy', label: 'Fuzzy', hint: 'Jaro-Winkler similarity match — catches STT spelling variations.' },
  { value: 'track', label: 'Track', hint: 'Fires on the most recently reported video-tracker state for this label. Defaults to a 1s cooldown since tracker state can update far more often than captions arrive.' },
  { value: 'composite', label: 'Composite', hint: 'Fires when the condition tree below evaluates true — combine multiple match types with AND/OR/NOT.' },
];
const EDITABLE_TYPE_VALUES = EDITABLE_MATCH_TYPES.map(t => t.value);

const EMPTY_DRAFT = { name: '', match_type: 'phrase', pattern: '', enabled: true, cooldown_ms: 0, fuzzy_threshold: 0.75, actionLabel: '', condition_tree: null };

function matchTypeLabel(matchType) {
  return EDITABLE_MATCH_TYPES.find(t => t.value === matchType)?.label || matchType;
}

function ruleMeta(rule) {
  if (rule.match_type === 'composite') {
    return [matchTypeLabel(rule.match_type), summarizeConditionTree(rule.condition_tree)].join(' · ');
  }
  const parts = [matchTypeLabel(rule.match_type)];
  if (rule.pattern) parts.push(rule.pattern);
  return parts.join(' · ');
}

/** True if any leaf in the tree is a `track` leaf — mirrors the backend's
 * treeContainsTrackLeaf() in routes/cues.js, used only to decide whether to
 * suggest a non-zero cooldown default in the form (the backend applies its
 * own default independently either way). `resolveRef(name)` looks up a named
 * condition's tree so a `track:` leaf hidden behind a `ref` node is still
 * found; `seen` guards against reference cycles. */
function treeContainsTrackLeaf(node, resolveRef = null, seen = new Set()) {
  if (typeof node === 'string') {
    if (!resolveRef || seen.has(node)) return false;
    seen.add(node);
    return treeContainsTrackLeaf(resolveRef(node), resolveRef, seen);
  }
  if (!node || typeof node !== 'object') return false;
  if (node.type === 'ref') {
    const name = node.name || node.ref;
    if (!name || !resolveRef || seen.has(name)) return false;
    seen.add(name);
    return treeContainsTrackLeaf(resolveRef(name), resolveRef, seen);
  }
  if (node.matchType === 'track') return true;
  return (node.children || []).some(child => treeContainsTrackLeaf(child, resolveRef, seen));
}

function SectionHeader({ title, buttonLabel, onAdd, disabled }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <h2 style={{ margin: 0, fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--color-text-muted)' }}>{title}</h2>
      <button className="btn btn--primary btn--sm" onClick={onAdd} disabled={disabled}>{buttonLabel}</button>
    </div>
  );
}

/**
 * CuesManager — editor for `cue_rules` and `cue_named_conditions` (Phase 10 +
 * Phase 9's frontend follow-up, plan_cues.md). Reads/writes the existing
 * `GET/POST/PUT/DELETE /cues/rules` and `/cues/defs` APIs, unchanged.
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

  const [namedConditions, setNamedConditions] = useState([]);
  const [loadingDefs, setLoadingDefs] = useState(true);
  const [defEditing, setDefEditing] = useState(null); // null | 'new' | def object
  const [defDraft, setDefDraft] = useState(null);
  const [defFormError, setDefFormError] = useState(null);
  const [confirmDeleteDef, setConfirmDeleteDef] = useState(null);

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

  const loadDefs = useCallback(async () => {
    if (!session?.connected) { setLoadingDefs(false); return; }
    setLoadingDefs(true);
    try {
      const r = await authedFetch('/cues/defs');
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      setNamedConditions(Array.isArray(data.defs) ? data.defs : []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoadingDefs(false);
    }
  }, [session?.connected, authedFetch]);

  useEffect(() => { load(); loadDefs(); }, [load, loadDefs]);

  // ── Rules ──────────────────────────────────────────────────────────────

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
      match_type: rule.match_type,
      pattern: rule.pattern || '',
      enabled: rule.enabled !== false,
      cooldown_ms: rule.cooldown_ms ?? 0,
      fuzzy_threshold: rule.fuzzy_threshold ?? 0.75,
      actionLabel: rule.action?.label || '',
      condition_tree: rule.condition_tree || null,
    });
  }

  function closeDialog() {
    setEditing(null);
    setDraft(null);
    setFormError(null);
  }

  function setMatchType(nextType) {
    setDraft(d => ({
      ...d,
      match_type: nextType,
      cooldown_ms: nextType === 'track' && Number(d.cooldown_ms) === 0 ? 1000 : d.cooldown_ms,
    }));
  }

  function setConditionTree(nextTree) {
    const resolveRef = name => namedConditions.find(nc => nc.name === name)?.condition_tree || null;
    setDraft(d => ({
      ...d,
      condition_tree: nextTree,
      cooldown_ms: treeContainsTrackLeaf(nextTree, resolveRef) && Number(d.cooldown_ms) === 0 ? 1000 : d.cooldown_ms,
    }));
  }

  async function handleSave() {
    if (!draft || !draft.name) return;
    const isComposite = draft.match_type === 'composite';
    if (isComposite ? !draft.condition_tree : !draft.pattern) return;
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
      pattern: isComposite ? undefined : draft.pattern,
      enabled: draft.enabled,
      cooldown_ms: Number(draft.cooldown_ms) || 0,
      action: draft.actionLabel ? { type: 'event', label: draft.actionLabel } : {},
    };
    if (draft.match_type === 'fuzzy') body.fuzzy_threshold = Number(draft.fuzzy_threshold);
    if (isComposite) body.condition_tree = draft.condition_tree;

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

  // ── Named conditions ──────────────────────────────────────────────────

  function openNewDef() {
    setDefFormError(null);
    setDefEditing('new');
    setDefDraft({ name: '', condition_tree: null });
  }

  function openEditDef(def) {
    setDefFormError(null);
    setDefEditing(def);
    setDefDraft({ name: def.name || '', condition_tree: def.condition_tree || null });
  }

  function closeDefDialog() {
    setDefEditing(null);
    setDefDraft(null);
    setDefFormError(null);
  }

  async function handleSaveDef() {
    if (!defDraft || !defDraft.name.trim() || !defDraft.condition_tree) {
      setDefFormError('Name and at least one condition are required.');
      return;
    }
    setDefFormError(null);
    const isNew = defEditing === 'new';
    const body = { name: defDraft.name.trim(), condition_tree: defDraft.condition_tree };
    try {
      const r = await authedFetch(isNew ? '/cues/defs' : `/cues/defs/${defEditing.id}`, {
        method: isNew ? 'POST' : 'PUT',
        body: JSON.stringify(body),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      closeDefDialog();
      loadDefs();
    } catch (e) {
      setDefFormError(e.message);
    }
  }

  async function handleDeleteDef(def) {
    try {
      const r = await authedFetch(`/cues/defs/${def.id}`, { method: 'DELETE' });
      if (!r.ok) { const data = await r.json().catch(() => ({})); throw new Error(data.error || `HTTP ${r.status}`); }
      setConfirmDeleteDef(null);
      loadDefs();
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleDetach(def) {
    setDefFormError(null);
    try {
      const r = await authedFetch(`/cues/defs/${def.id}`, {
        method: 'PUT',
        body: JSON.stringify({ source: 'api' }),
      });
      if (!r.ok) { const data = await r.json().catch(() => ({})); throw new Error(data.error || `HTTP ${r.status}`); }
      closeDefDialog();
      loadDefs();
    } catch (e) {
      setDefFormError(e.message);
    }
  }

  const editingIsCustomType = editing && editing !== 'new' && !EDITABLE_TYPE_VALUES.includes(editing.match_type);
  const selectedType = draft ? EDITABLE_MATCH_TYPES.find(t => t.value === draft.match_type) : null;
  const isComposite = draft?.match_type === 'composite';

  return (
    <div style={embedded ? { padding: 12, display: 'flex', flexDirection: 'column', gap: 16 } : { padding: 20, maxWidth: 760, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 24 }}>
      {!embedded && (
        <div>
          <h1 style={{ margin: '0 0 4px', fontSize: 20 }}>Cue Rules</h1>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)' }}>
            Persistent cue rules and reusable named conditions that trigger on spoken phrases, sections, fuzzy
            matches, or composite AND/OR/NOT trees — independent of any rundown file. See <Link href="/assets">Assets</Link> for
            the full cue count.
          </p>
        </div>
      )}

      {error && <div style={{ color: 'var(--color-error)', fontSize: 13 }}>{error}</div>}

      {/* ── Rules ────────────────────────────────────────────────────── */}
      <div>
        <SectionHeader title="Rules" buttonLabel="+ Add rule" onAdd={openNew} disabled={!!editing} />

        {editing && draft && (
          <Dialog title={editing === 'new' ? 'Add cue rule' : (editing.name || 'Edit cue rule')} onClose={closeDialog} width={isComposite ? 640 : 520}>
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
                      onChange={e => setMatchType(e.target.value)}
                    >
                      {EDITABLE_MATCH_TYPES.map(t => (
                        <option key={t.value} value={t.value}>{t.label}</option>
                      ))}
                    </select>
                    {selectedType && <span className="settings-field__hint">{selectedType.hint}</span>}
                  </div>

                  {isComposite ? (
                    <div className="settings-field">
                      <label className="settings-field__label">Conditions</label>
                      <ConditionTreeEditor tree={draft.condition_tree} onChange={setConditionTree} namedConditions={namedConditions} />
                    </div>
                  ) : (
                    <div className="settings-field">
                      <label className="settings-field__label">
                        {draft.match_type === 'section' ? 'Section name' : draft.match_type === 'track' ? 'Tracked label' : 'Pattern'}
                      </label>
                      <input
                        className="settings-field__input"
                        type="text"
                        value={draft.pattern}
                        onChange={e => setDraft({ ...draft, pattern: e.target.value })}
                        placeholder={draft.match_type === 'regex' ? '\\bamen\\b' : draft.match_type === 'track' ? 'presenter-standing' : 'we beseech thee'}
                      />
                    </div>
                  )}

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
                <button className="btn btn--primary" onClick={handleSave} disabled={!draft.name || (isComposite ? !draft.condition_tree : !draft.pattern)}>
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

      {/* ── Named Conditions ────────────────────────────────────────── */}
      <div>
        <SectionHeader title="Named Conditions" buttonLabel="+ Add condition" onAdd={openNewDef} disabled={!!defEditing} />
        <p style={{ margin: '4px 0 8px', fontSize: 12, color: 'var(--color-text-muted)' }}>
          Reusable condition trees referenced by name (<code>@name</code>) from any composite rule or inline cue.
        </p>

        {defEditing && defDraft && (
          <Dialog title={defEditing === 'new' ? 'Add named condition' : defEditing.name} onClose={closeDefDialog} width={640}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {defFormError && <div style={{ color: 'var(--color-error)', fontSize: 13 }}>{defFormError}</div>}

              {defEditing !== 'new' && defEditing.source === 'inline' && (
                <div style={{ padding: '8px 10px', borderRadius: 6, background: 'var(--color-surface-elevated)', fontSize: 12, color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'space-between' }}>
                  <span>Defined by a rundown file's <code>cue-def:</code> block — edits here will be overwritten next time that file syncs.</span>
                  <button type="button" className="btn btn--ghost btn--sm" onClick={() => handleDetach(defEditing)}>Detach</button>
                </div>
              )}

              <div className="settings-field">
                <label className="settings-field__label">Name</label>
                <input
                  className="settings-field__input"
                  type="text"
                  value={defDraft.name}
                  disabled={defEditing !== 'new'}
                  onChange={e => setDefDraft({ ...defDraft, name: e.target.value })}
                  placeholder="prayer-ending"
                />
                <span className="settings-field__hint">Referenced elsewhere as @{defDraft.name || 'name'}. Can't be changed after creation.</span>
              </div>

              <div className="settings-field">
                <label className="settings-field__label">Conditions</label>
                <ConditionTreeEditor
                  tree={defDraft.condition_tree}
                  onChange={tree => setDefDraft({ ...defDraft, condition_tree: tree })}
                  namedConditions={namedConditions.filter(nc => defEditing === 'new' || nc.id !== defEditing.id)}
                />
              </div>

              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button className="btn btn--ghost" onClick={closeDefDialog}>Cancel</button>
                <button className="btn btn--primary" onClick={handleSaveDef} disabled={!defDraft.name.trim() || !defDraft.condition_tree}>
                  {defEditing === 'new' ? 'Create' : 'Save'}
                </button>
              </div>
            </div>
          </Dialog>
        )}

        {loadingDefs ? (
          <p style={{ color: 'var(--color-text-muted)' }}>Loading…</p>
        ) : !session?.connected ? (
          <p style={{ color: 'var(--color-text-muted)' }}>Connect to a project to manage named conditions.</p>
        ) : namedConditions.length === 0 ? (
          <p style={{ color: 'var(--color-text-muted)' }}>No named conditions yet — add one to reuse across rules.</p>
        ) : (
          <div className="setup-card">
            {namedConditions.map(def => (
              <SetupItemRow
                key={def.id}
                name={def.name}
                meta={summarizeConditionTree(def.condition_tree)}
                badge={def.source === 'inline' ? 'inline' : 'api'}
                onSettings={() => openEditDef(def)}
                onDelete={() => setConfirmDeleteDef(def)}
              />
            ))}
          </div>
        )}

        {confirmDeleteDef && (
          <Dialog title="Delete named condition?" onClose={() => setConfirmDeleteDef(null)}>
            <p style={{ margin: '0 0 16px', fontSize: 14 }}>
              Delete <strong>@{confirmDeleteDef.name}</strong>? Any rule or condition referencing it will stop matching.
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn--ghost" onClick={() => setConfirmDeleteDef(null)}>Cancel</button>
              <button className="btn btn--danger" onClick={() => handleDeleteDef(confirmDeleteDef)}>Delete</button>
            </div>
          </Dialog>
        )}
      </div>
    </div>
  );
}

/** CuesPage — `/cues`, the standalone-page wrapper around `CuesManager`. */
export function CuesPage() {
  useProjectRequired();
  return <CuesManager />;
}
