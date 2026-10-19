import { useEffect, useState } from 'react';
import {
  screenApiSupported, listScreens, openScreenWindow, displayUrl, screenKey,
  mappingFor, withMapping, loadScreenMappings, saveScreenMappings,
} from '../lib/dskScreens.js';

const LANDSCAPE = 'landscape';

/**
 * Screens on this computer and the DSK viewport shown on each one.
 * Shared by Setup Hub → Screens and Graphics → Viewports. Mappings live in
 * localStorage (per browser), so the list is only meaningful on the computer
 * that has the screens.
 *
 * Props:
 *   viewports  user-defined viewports ({ name, label, displaySettings })
 *   projectSlug, apiKey  build the display URL (slug form preferred)
 */
export function ScreensPanel({ viewports = [], projectSlug = null, apiKey = '' }) {
  const [supported, setSupported] = useState(null);
  const [screens, setScreens] = useState(null);
  const [mappings, setMappings] = useState({});
  const [message, setMessage] = useState('');

  useEffect(() => {
    setSupported(screenApiSupported());
    setMappings(loadScreenMappings(globalThis.localStorage));
  }, []);

  async function refresh() {
    try {
      setScreens(await listScreens());
      setMessage('');
    } catch (err) {
      setMessage(err?.message || 'Screen access denied');
    }
  }

  function update(screen, patch) {
    const next = withMapping(mappings, screen, patch);
    setMappings(next);
    if (!saveScreenMappings(globalThis.localStorage, next)) {
      setMessage('Could not save the mapping in this browser');
    }
  }

  function open(screen) {
    const m = mappingFor(mappings, screen);
    const viewport = m.viewport === LANDSCAPE ? '' : m.viewport;
    const url = displayUrl({ origin: window.location.origin, projectSlug, apiKey, viewport, bg: m.bg });
    if (!openScreenWindow(screen, url)) setMessage('The browser blocked the window. Allow pop-ups for this site.');
  }

  if (supported === false) {
    return (
      <p className="setup-card__empty">
        Screen placement needs Chrome or Edge. Open the display URL manually in the window you want on the screen.
      </p>
    );
  }

  return (
    <div>
      {screens === null ? (
        <button type="button" onClick={refresh}>List connected screens</button>
      ) : (
        <>
          {screens.length === 0 && <p className="setup-card__empty">No screens found.</p>}
          {screens.map((sc, i) => {
            const m = mappingFor(mappings, sc);
            const vp = viewports.find(v => v.name === m.viewport);
            const rtmp = Boolean(vp?.displaySettings?.stream?.enabled);
            return (
              <div key={screenKey(sc)} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                <span style={{ minWidth: 200 }}>
                  {sc.label || `Screen ${i + 1}`} ({sc.width}×{sc.height}){sc.isPrimary ? ' · primary' : ''}
                </span>
                <select aria-label="Viewport" value={m.viewport} onChange={e => update(sc, { viewport: e.target.value })}>
                  <option value="">— none —</option>
                  <option value={LANDSCAPE}>Landscape (default page)</option>
                  {viewports.map(v => <option key={v.name} value={v.name}>{v.label || v.name}</option>)}
                </select>
                <select aria-label="Background" value={m.bg === 'transparent' ? 'transparent' : 'custom'} onChange={e => update(sc, { bg: e.target.value === 'transparent' ? 'transparent' : '#00B140' })}>
                  <option value="transparent">Transparent</option>
                  <option value="custom">Colour</option>
                </select>
                {m.bg !== 'transparent' && (
                  <input type="color" aria-label="Background colour" value={m.bg} onChange={e => update(sc, { bg: e.target.value })} style={{ width: 40, height: 28, padding: 0 }} />
                )}
                {rtmp && <span style={{ fontSize: 12 }}>RTMP stream on</span>}
                <button type="button" disabled={!m.viewport} onClick={() => open(sc)}>Open on this screen</button>
              </div>
            );
          })}
          <button type="button" onClick={refresh}>Refresh screen list</button>
        </>
      )}
      {message && <p style={{ fontSize: 12 }}>{message}</p>}
    </div>
  );
}
