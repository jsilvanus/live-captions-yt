import { useState } from 'react';

const chip = (on, color = '#3ddc84') => ({
  fontSize: 11, padding: '2px 7px', borderRadius: 10, border: `1px solid ${on ? color : 'var(--color-border)'}`,
  color: on ? color : 'var(--color-text-muted)',
});

/** "2 people (preacher) · framing 0.72 · 0.8 s ago" for one camera's detector state. */
export function describeScene(scene) {
  if (!scene) return 'no detector data';
  const age = scene.ageMs < 1000 ? `${scene.ageMs} ms` : `${(scene.ageMs / 1000).toFixed(1)} s`;
  if (!scene.visible) return `not visible · last report ${age} ago`;
  const who = scene.people === 0 ? 'no people' : `${scene.people} ${scene.people === 1 ? 'person' : 'people'}${scene.roles?.length ? ` (${scene.roles.join(', ')})` : ''}`;
  const framing = typeof scene.framingScore === 'number' ? ` · framing ${scene.framingScore.toFixed(2)}` : '';
  return `${who}${framing} · ${age} ago`;
}

/**
 * Camera status panel: is the detector running per camera, is it switched to start automatically, which camera is on
 * program and how the feed attributor knows, and what the detector currently sees. Controls call the existing
 * perception and attribution routes through `onAction(path, body)` (returns an error string or null).
 */
export function PerceptionPanel({ overview, onAction }) {
  const [error, setError] = useState(null);
  if (!overview) return <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Loading camera status…</p>;
  const { cameras = [], shared, attribution } = overview;
  const tag = attribution?.tag;

  async function run(path, body) {
    setError(await onAction(path, body));
  }
  const btn = { fontSize: 11, padding: '2px 8px' };

  return (
    <section aria-label="Camera perception" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <h3 style={{ fontSize: 13, margin: 0 }}>Cameras and perception</h3>
      {error && <p role="alert" style={{ fontSize: 12, color: '#d9534f', margin: 0 }}>{error}</p>}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', fontSize: 12 }}>
        <span data-testid="attribution-line">
          Program feed: {tag?.cameraId ? `${cameras.find((c) => c.id === tag.cameraId)?.name || tag.cameraId} (${tag.method}, ${Math.round((tag.confidence ?? 0) * 100)}%)` : 'source unknown'}
        </span>
        <span style={chip(attribution?.running)}>visual matching {attribution?.running ? 'on' : 'off'}</span>
        <button type="button" style={btn} onClick={() => run(attribution?.running ? '/production/attribution/stop' : '/production/attribution/start')}>
          {attribution?.running ? 'Stop matching' : 'Start matching'}
        </button>
        {tag?.cameraId && <button type="button" style={btn} onClick={() => run('/production/attribution/override', { cameraId: null })}>Clear override</button>}
        <select aria-label="This is camera" value="" onChange={(e) => e.target.value && run('/production/attribution/override', { cameraId: e.target.value })} style={{ fontSize: 11 }}>
          <option value="">This is camera…</option>
          {cameras.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12 }}>
        <span>Program feed job</span>
        <span style={chip(shared?.running)}>{shared?.running ? 'job on' : 'job off'}</span>
        <button type="button" style={btn} onClick={() => run(shared?.running ? '/production/perception/shared/stop' : '/production/perception/shared/start')}>
          {shared?.running ? 'Stop' : 'Start'}
        </button>
        <label style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <input type="checkbox" checked={!!shared?.auto} onChange={(e) => run('/production/perception/shared/auto', { enabled: e.target.checked })} />
          auto
        </label>
      </div>

      {cameras.length === 0 ? (
        <p style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>No cameras configured.</p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {cameras.map((c) => (
            <li key={c.id} data-testid={`camera-${c.id}`} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 12, padding: '6px 8px', border: '1px solid var(--color-border)', borderRadius: 6 }}>
              <strong style={{ minWidth: 90 }}>{c.name}</strong>
              {c.onProgram && <span style={chip(true, '#e8b04a')}>on program</span>}
              <span style={chip(c.jobRunning)}>{c.jobRunning ? 'detector running' : 'detector stopped'}</span>
              <span style={{ color: 'var(--color-text-muted)' }}>{describeScene(c.scene)}</span>
              {c.hasFeed ? (
                <span style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
                  <button type="button" style={btn} onClick={() => run(`/production/cameras/${c.id}/perception/${c.jobRunning ? 'stop' : 'start'}`)}>
                    {c.jobRunning ? 'Stop' : 'Start'}
                  </button>
                  <label style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    <input type="checkbox" checked={c.perceptionEnabled} onChange={(e) => run(`/production/cameras/${c.id}/perception/auto`, { enabled: e.target.checked })} />
                    auto
                  </label>
                </span>
              ) : (
                <span style={{ marginLeft: 'auto', color: 'var(--color-text-muted)' }}>no feed of its own: seen on the program feed</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
