import { useState, useEffect, useCallback, useRef } from 'react';
import { C } from '../theme.js';
import { Empty } from './parts.jsx';
import { notifyActiveBroadcastChanged } from '../../../../hooks/useActiveBroadcast.js';
import { STATUS_LABELS, actionsFor, pickUpcoming, canForce, outputRows, toggleOutput, canEditOutputs } from '../../../../lib/broadcast-lifecycle-ui.js';

const POLL_MS = 5000;
const KIND = {
  primary: { background: '#2e5fa3', border: '#2e5fa3', color: '#fff' },
  danger: { background: '#5a1d22', border: '#a33', color: '#ffb3b3' },
  plain: { background: C.btnBg, border: C.panelBorder, color: '#dcdcdc' },
};

/**
 * Which egress outputs the broadcast puts on air (GET/PUT /broadcasts/:id/outputs). Nothing ticked = the project's
 * outputs as configured. A change counts the next time the broadcast is staged.
 */
function BroadcastOutputs({ jfetch, broadcast, onError }) {
  const [all, setAll] = useState(null);
  const [linked, setLinked] = useState([]);
  const id = broadcast.id;
  const load = useCallback(async () => {
    try {
      const [a, l] = await Promise.all([jfetch('/outputs'), jfetch(`/broadcasts/${encodeURIComponent(id)}/outputs`)]);
      setAll(a.ok ? ((await a.json().catch(() => ({})))?.outputs || []) : []);
      setLinked(l.ok ? ((await l.json().catch(() => ({})))?.outputs || []) : []);
    } catch { /* keep what is shown */ }
  }, [jfetch, id]);
  useEffect(() => { load(); }, [load]);

  const toggle = useCallback(async (outputId, checked) => {
    try {
      const r = await jfetch(`/broadcasts/${encodeURIComponent(id)}/outputs`, { method: 'PUT', body: JSON.stringify(toggleOutput(linked, outputId, checked)) });
      const d = await r.json().catch(() => ({}));
      if (r.ok) setLinked(d.outputs || []); else onError(d.error || `Failed (${r.status})`);
    } catch (e) { onError(e.message); }
  }, [jfetch, id, linked, onError]);

  const rows = outputRows(all, linked);
  if (!rows.length) return null;
  const editable = canEditOutputs(broadcast.status);
  return (
    <fieldset style={{ border: `1px solid ${C.panelBorder}`, borderRadius: 6, margin: 0, padding: '6px 8px' }}>
      <legend style={{ fontSize: '.66rem', color: '#888', padding: '0 4px' }}>Outputs on air</legend>
      {rows.map((r) => (
        <label key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0', opacity: r.projectDisabled || r.missing ? 0.6 : 1 }}>
          <input type="checkbox" checked={r.checked} disabled={!editable} onChange={(e) => toggle(r.id, e.target.checked)} />
          <span>{r.name}{r.projectDisabled ? ' (disabled)' : ''}{r.missing ? ' (removed)' : ''}</span>
        </label>
      ))}
      <div style={{ color: '#888', fontSize: '.66rem', marginTop: 4 }}>
        {linked.length ? 'Only the ticked outputs go on air.' : 'None ticked: the project\'s outputs as configured.'}{broadcast.status === 'live' || broadcast.status === 'staging' ? ' Changes apply the next time it is staged.' : ''}
      </div>
    </fieldset>
  );
}

/**
 * Broadcast pane: the one broadcast of the project (the running one, else the one
 * scheduled around now, else a typed title) with a button per status change.
 * The title is information only. Staging runs the pre-flight; a warning-only
 * pre-flight can be overridden ("Go anyway").
 */
export function BroadcastPane({ D }) {
  const { jfetch, connected } = D;
  const [current, setCurrent] = useState(null);
  const [upcoming, setUpcoming] = useState(null);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(null);
  const [problem, setProblem] = useState(null); // { message, findings?, retry? }
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const load = useCallback(async () => {
    if (!connected) return;
    try {
      const r = await jfetch('/broadcasts/current');
      const cur = r.ok ? (await r.json()).broadcast ?? null : null;
      let up = null;
      if (!cur) {
        const l = await jfetch('/broadcasts');
        if (l.ok) up = pickUpcoming((await l.json()).broadcasts || []);
      }
      if (alive.current) { setCurrent(cur); setUpcoming(up); }
    } catch { /* keep what is shown */ }
  }, [jfetch, connected]);

  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  const shown = current || upcoming;

  const run = useCallback(async (id, action, force = false) => {
    setBusy(action);
    setProblem(null);
    try {
      const r = await jfetch(`/broadcasts/${encodeURIComponent(id)}/${action}`, { method: 'POST', body: JSON.stringify({ force }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setProblem({ message: d.error || `Failed (${r.status})`, findings: d.findings, retry: canForce(d.findings) ? () => run(id, action, true) : null });
      } else if (d.report?.warnings?.length) {
        setProblem({ message: `Done with warnings: ${d.report.warnings.map((w) => `${w.step}: ${w.error}`).join('; ')}` });
      }
    } catch (e) {
      setProblem({ message: e.message });
    } finally {
      if (alive.current) setBusy(null);
      await load();
      notifyActiveBroadcastChanged();
    }
  }, [jfetch, load]);

  const create = useCallback(async () => {
    const t = title.trim();
    if (!t) return;
    setBusy('create');
    try {
      const r = await jfetch('/broadcasts', { method: 'POST', body: JSON.stringify({ title: t }) });
      if (r.ok) setTitle(''); else setProblem({ message: (await r.json().catch(() => ({}))).error || 'Could not create' });
    } finally { setBusy(null); await load(); }
  }, [jfetch, title, load]);

  if (!connected) return <Empty>Connect to a project to control its broadcast.</Empty>;

  const status = shown?.status;
  const sync = current?.status === 'live' && current.lastSyncedAt;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 10, fontSize: '.78rem', color: C.text }}>
      {shown ? (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontWeight: 700, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={shown.title}>{shown.title || 'Untitled broadcast'}</span>
            <span style={{ fontSize: '.62rem', fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', padding: '3px 8px', borderRadius: 5, background: status === 'live' ? 'rgba(204,0,34,.25)' : C.chipBg, color: status === 'live' ? '#ff7788' : '#aaa' }}>
              {STATUS_LABELS[status] || status}
            </span>
          </div>
          {shown.scheduledStart && <div style={{ color: '#888', fontSize: '.7rem' }}>Scheduled {new Date(shown.scheduledStart).toLocaleString()}</div>}
          {current && <div style={{ color: '#888', fontSize: '.7rem' }}>Caption number {current.captionSequence ?? 0}{sync ? ` · clock synced ${new Date(current.lastSyncedAt.replace(' ', 'T') + (/Z|[+-]\d\d:?\d\d$/.test(current.lastSyncedAt) ? '' : 'Z')).toLocaleTimeString()}` : ''}{current.syncFailures > 0 ? ` · ${current.syncFailures} sync failure(s)` : ''}</div>}
          <BroadcastOutputs key={shown.id} jfetch={jfetch} broadcast={shown} onError={(message) => setProblem({ message })} />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {current?.status === 'live' && (
              <button disabled={!!busy} onClick={() => run(current.id, 'sync')} title="Sync the caption clock now (done automatically while live)"
                style={{ padding: '7px 12px', borderRadius: 6, fontWeight: 600, fontSize: '.74rem', background: KIND.plain.background, border: `1px solid ${KIND.plain.border}`, color: KIND.plain.color }}>
                {busy === 'sync' ? '…' : 'Sync clock'}
              </button>
            )}
            {actionsFor(status).map((a) => (
              <button key={a.action} disabled={!!busy} onClick={() => run(shown.id, a.action)}
                style={{ padding: '7px 12px', borderRadius: 6, fontWeight: 600, fontSize: '.74rem', opacity: busy ? 0.6 : 1, background: KIND[a.kind].background, border: `1px solid ${KIND[a.kind].border}`, color: KIND[a.kind].color }}>
                {busy === a.action ? '…' : a.label}
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <div style={{ color: '#888' }}>No broadcast running or scheduled around now. Type a title to start one.</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <input value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && create()} placeholder="Broadcast title"
              style={{ flex: 1, minWidth: 0, padding: '6px 8px', borderRadius: 6, border: `1px solid ${C.panelBorder}`, background: C.btnBg, color: C.text }} />
            <button disabled={!title.trim() || !!busy} onClick={create} style={{ padding: '6px 12px', borderRadius: 6, background: KIND.primary.background, border: `1px solid ${KIND.primary.border}`, color: '#fff', fontWeight: 600 }}>Create</button>
          </div>
        </>
      )}
      {problem && (
        <div role="alert" style={{ padding: 8, borderRadius: 6, background: '#2a1517', border: '1px solid #a33', color: '#ffb3b3' }}>
          <div>{problem.message}</div>
          {problem.findings?.length > 0 && (
            <ul style={{ margin: '6px 0 0 16px', padding: 0 }}>
              {problem.findings.map((f, i) => <li key={i}>{f.severity === 'warn' ? 'Warning: ' : ''}{f.message}</li>)}
            </ul>
          )}
          {problem.retry && <button onClick={problem.retry} style={{ marginTop: 6, padding: '5px 10px', borderRadius: 6, background: KIND.danger.background, border: `1px solid ${KIND.danger.border}`, color: KIND.danger.color }}>Go anyway</button>}
        </div>
      )}
    </div>
  );
}
