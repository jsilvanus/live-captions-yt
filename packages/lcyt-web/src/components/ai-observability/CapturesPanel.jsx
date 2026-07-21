import { useEffect, useState } from 'react';

function formatResult(entry) {
  if (!entry) return '—';
  if (entry.error) return `error: ${entry.error}`;
  if (!entry.result) return '(no result)';
  if (entry.result.json != null) return JSON.stringify(entry.result.json, null, 2);
  return entry.result.text ?? '(empty)';
}

/**
 * Capture browse list + prompt sandbox/replay (plan_ai_observability.md
 * Stage 1 §2/§3). Lists the ring buffer for one role, lets the user pick a
 * capture, edit its prompt, replay it against the same captured frame, and
 * diffs the replay result against what was actually produced live. The
 * edited prompt is never persisted back to harness_config — sandbox only.
 */
export function CapturesPanel({ hook, roleCode }) {
  const list = hook.captures[roleCode] || [];
  const [selectedId, setSelectedId] = useState(null);
  const [promptDraft, setPromptDraft] = useState('');
  const [replaying, setReplaying] = useState(false);
  const [replayError, setReplayError] = useState('');
  const [replayResult, setReplayResult] = useState(null);

  const selected = list.find((c) => c.id === selectedId) || null;

  useEffect(() => {
    setPromptDraft(selected?.prompt || '');
    setReplayResult(null);
    setReplayError('');
  }, [selected?.id]);

  // The selected capture id may fall out of the list on refresh (buffer
  // eviction) — fall back to nothing selected rather than stale data.
  useEffect(() => {
    if (selectedId && !list.some((c) => c.id === selectedId)) setSelectedId(null);
  }, [list, selectedId]);

  async function runReplay() {
    if (!selected) return;
    setReplaying(true);
    setReplayError('');
    try {
      const res = await hook.actions.replay(roleCode, selected.id, promptDraft);
      if (!res.ok) { setReplayError(res.error || 'Replay failed'); return; }
      setReplayResult(res);
    } finally {
      setReplaying(false);
    }
  }

  return (
    <div style={{ display: 'flex', gap: 16, flex: 1, minHeight: 0 }}>
      <div style={{ width: 220, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <strong style={{ fontSize: 12 }}>Captures ({list.length})</strong>
          <button
            type="button"
            onClick={() => hook.actions.refreshCaptures(roleCode)}
            title="Refresh"
            style={{ fontSize: 11, padding: '2px 6px', borderRadius: 4, border: '1px solid var(--color-border)', background: 'transparent', color: 'inherit' }}
          >
            ↻
          </button>
        </div>
        <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6, minHeight: 0 }}>
          {list.length === 0 && (
            <p style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
              No captures yet — start {roleCode} and wait for a poll.
            </p>
          )}
          {list.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setSelectedId(c.id)}
              style={{
                display: 'flex', gap: 8, alignItems: 'center', textAlign: 'left', padding: 6, borderRadius: 6,
                border: `1px solid ${c.id === selectedId ? BOX_ACCENT : 'var(--color-border)'}`,
                background: c.id === selectedId ? 'var(--color-surface, rgba(255,255,255,.05))' : 'transparent',
                color: 'inherit', cursor: 'pointer',
              }}
            >
              <img
                src={hook.frameUrl(roleCode, c.id)}
                alt=""
                style={{ width: 48, height: 27, objectFit: 'cover', borderRadius: 4, background: '#000', flexShrink: 0 }}
              />
              <span style={{ fontSize: 11 }}>
                {new Date(c.ts).toLocaleTimeString()}
                {c.error ? <span style={{ color: 'var(--color-error, #e55)' }}> · error</span> : null}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10, overflow: 'auto' }}>
        {!selected ? (
          <p style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Pick a capture to inspect and replay.</p>
        ) : (
          <>
            <img
              src={hook.frameUrl(roleCode, selected.id)}
              alt="Captured frame"
              style={{ maxWidth: 320, borderRadius: 6, border: '1px solid var(--color-border)' }}
            />

            <div>
              <label htmlFor="ai-obs-prompt" style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                Prompt (editable — sandbox only, never saved to the role's config)
              </label>
              <textarea
                id="ai-obs-prompt"
                value={promptDraft}
                onChange={(e) => setPromptDraft(e.target.value)}
                rows={5}
                style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'monospace', fontSize: 12, padding: 8, borderRadius: 6, border: '1px solid var(--color-border)', background: 'var(--color-surface, transparent)', color: 'inherit' }}
              />
            </div>

            <button type="button" onClick={runReplay} disabled={replaying} className="btn btn--primary" style={{ alignSelf: 'flex-start' }}>
              {replaying ? 'Replaying…' : 'Replay against this frame'}
            </button>
            {replayError && <p style={{ color: 'var(--color-error, #e55)', fontSize: 12, margin: 0 }}>{replayError}</p>}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <h4 style={{ fontSize: 12, margin: '0 0 4px' }}>Original (live)</h4>
                <pre style={{ fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-word', background: 'var(--color-surface, rgba(255,255,255,.04))', padding: 8, borderRadius: 6, margin: 0 }}>
                  {formatResult(selected)}
                </pre>
              </div>
              <div>
                <h4 style={{ fontSize: 12, margin: '0 0 4px' }}>Replay (sandbox)</h4>
                <pre style={{ fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-word', background: 'var(--color-surface, rgba(255,255,255,.04))', padding: 8, borderRadius: 6, margin: 0 }}>
                  {replayResult ? formatResult(replayResult.replay) : '—'}
                </pre>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const BOX_ACCENT = '#3b6fb0';
