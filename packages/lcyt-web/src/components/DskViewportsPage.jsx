import { useContext, useEffect, useState, useCallback, useId } from 'react';
import { SessionContext } from '../contexts/SessionContext';

/**
 * DSK Viewports Management Page
 *
 * URL: /dsk-viewports?server=<backendUrl>&apikey=<key>
 *
 * Manage named viewport targets for DSK graphics:
 *   - Built-in "Landscape (default)" (1920×1080, not deletable — existing /dsk/:key behaviour)
 *   - User-defined viewports: vertical screens, viewer, etc.
 *
 * For each viewport:
 *   - Edit label, type, dimensions
 *   - Get the display URL (open in OBS / HDMI output browser)
 *   - "Present to screen" — open display URL on a specific connected monitor (Window Placement API)
 *   - Per-image settings: visible toggle, x/y/width/height position override, animation
 *
 * Auth: X-API-Key header (same as DskControlPage — no live session required).
 */

// ── Shared styles ─────────────────────────────────────────────────────────────

const dark = {
  bg:       '#121212',
  panel:    '#1a1a1a',
  card:     '#222',
  cardHover:'#2a2a2a',
  border:   '#333',
  text:     '#ddd',
  muted:    '#888',
  accent:   '#44ff88',
  accentDim:'#2d8a52',
  danger:   '#ff6666',
};

const btnBase = {
  background: dark.card,
  border: `1px solid ${dark.border}`,
  color: dark.text,
  borderRadius: 6,
  padding: '7px 14px',
  fontSize: 13,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};
const btnPrimary  = { ...btnBase, background: '#1a4a2e', border: `1px solid ${dark.accentDim}`, color: '#cfffdc' };
const btnDanger   = { ...btnBase, background: '#3a0000', border: '1px solid #882222', color: '#ffaaaa' };
const btnSmall    = { ...btnBase, padding: '4px 10px', fontSize: 12 };

const inputStyle = {
  background: '#1a1a1a',
  border: `1px solid ${dark.border}`,
  color: '#eee',
  borderRadius: 4,
  padding: '6px 10px',
  fontSize: 13,
  boxSizing: 'border-box',
};

const labelStyle = { display: 'block', marginBottom: 4, color: dark.muted, fontSize: 12 };

// ── Component ─────────────────────────────────────────────────────────────────

export function DskViewportsPage() {
  const session   = useContext(SessionContext);
  const params    = new URLSearchParams(window.location.search);
  const serverUrl = (session?.backendUrl || params.get('server') || '').replace(/\/$/, '');
  const apiKey    = session?.apiKey || params.get('apikey') || '';

  const [viewports, setViewports]       = useState([]);     // user-defined
  const [selected, setSelected]         = useState(null);   // viewport name or 'landscape'
  const [images, setImages]             = useState([]);     // all images for this key
  const [msg, setMsg]                   = useState('');
  const [screens, setScreens]           = useState(null);   // ScreenDetailed[] | null
  const [screenApiSupported, setScreenApiSupported] = useState(null); // null=unknown

  // ── API helpers ──────────────────────────────────────────────────────────

  const apiFetch = useCallback((path, opts = {}) =>
    fetch(`${serverUrl}${path}`, {
      ...opts,
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
        ...(opts.headers || {}),
      },
    }),
  [serverUrl, apiKey]);

  function flash(text) {
    setMsg(text);
    setTimeout(() => setMsg(''), 3000);
  }

  // ── Load data ────────────────────────────────────────────────────────────

  const loadViewports = useCallback(async () => {
    if (!serverUrl || !apiKey) return;
    try {
      const res = await apiFetch(`/dsk/${encodeURIComponent(apiKey)}/viewports`);
      if (!res.ok) return;
      const data = await res.json();
      setViewports(data.viewports || []);
    } catch {}
  }, [apiKey, serverUrl, apiFetch]);

  const loadImages = useCallback(async () => {
    if (!serverUrl || !apiKey) return;
    try {
      const res = await apiFetch('/images');
      if (!res.ok) return;
      const data = await res.json();
      setImages(data.images || []);
    } catch {}
  }, [apiKey, serverUrl, apiFetch]);

  useEffect(() => {
    loadViewports();
    loadImages();
    setScreenApiSupported('getScreenDetails' in window);
  }, [loadViewports, loadImages]);

  // ── Selected viewport data ───────────────────────────────────────────────

  const LANDSCAPE = { name: 'landscape', label: 'Landscape (default)', viewportType: 'landscape', width: 1920, height: 1080, textLayers: [], _builtin: true };

  const allViewports = [LANDSCAPE, ...viewports];
  const selectedVp   = selected ? (allViewports.find(v => v.name === selected) ?? null) : null;

  // ── Viewport creation ────────────────────────────────────────────────────

  const [creating, setCreating] = useState(false);
  const [newVp, setNewVp]       = useState({ name: '', label: '', viewportType: 'vertical', width: 1080, height: 1920 });

  async function handleCreate(e) {
    e.preventDefault();
    try {
      const res = await apiFetch(`/dsk/${encodeURIComponent(apiKey)}/viewports`, {
        method: 'POST',
        body:   JSON.stringify(newVp),
      });
      const data = await res.json();
      if (!res.ok) { flash(data.error || 'Create failed'); return; }
      await loadViewports();
      setSelected(newVp.name);
      setCreating(false);
      setNewVp({ name: '', label: '', viewportType: 'vertical', width: 1080, height: 1920 });
      flash('Viewport created');
    } catch { flash('Network error'); }
  }

  // ── Viewport edit ────────────────────────────────────────────────────────

  const [editVp, setEditVp] = useState(null); // draft for editing

  useEffect(() => {
    if (selectedVp && !selectedVp._builtin) {
      setEditVp({ label: selectedVp.label ?? '', viewportType: selectedVp.viewportType, width: selectedVp.width, height: selectedVp.height });
    } else {
      setEditVp(null);
    }
  }, [selected]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSaveVp() {
    if (!selectedVp || selectedVp._builtin || !editVp) return;
    try {
      const res = await apiFetch(`/dsk/${encodeURIComponent(apiKey)}/viewports/${encodeURIComponent(selectedVp.name)}`, {
        method: 'PUT',
        body:   JSON.stringify(editVp),
      });
      const data = await res.json();
      if (!res.ok) { flash(data.error || 'Save failed'); return; }
      await loadViewports();
      flash('Saved');
    } catch { flash('Network error'); }
  }

  async function handleDeleteVp() {
    if (!selectedVp || selectedVp._builtin) return;
    if (!confirm(`Delete viewport "${selectedVp.name}"?`)) return;
    try {
      const res = await apiFetch(`/dsk/${encodeURIComponent(apiKey)}/viewports/${encodeURIComponent(selectedVp.name)}`, { method: 'DELETE' });
      if (!res.ok) { flash('Delete failed'); return; }
      setSelected('landscape');
      await loadViewports();
      flash('Deleted');
    } catch { flash('Network error'); }
  }

  // ── Text layers ──────────────────────────────────────────────────────────

  // Local draft of text layers for the selected viewport
  const [draftLayers, setDraftLayers] = useState([]);

  useEffect(() => {
    setDraftLayers(selectedVp?.textLayers ?? []);
  }, [selected]); // eslint-disable-line react-hooks/exhaustive-deps

  function newLayer() {
    return {
      id:         `tl-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      binding:    '',
      x:          0,
      y:          0,
      width:      400,
      height:     120,
      fontSize:   48,
      fontWeight: 'bold',
      color:      '#ffffff',
      textAlign:  'center',
      textShadow: '0 2px 8px rgba(0,0,0,0.8)',
    };
  }

  async function saveTextLayers(layers) {
    if (!selectedVp || selectedVp._builtin) return;
    try {
      const res = await apiFetch(`/dsk/${encodeURIComponent(apiKey)}/viewports/${encodeURIComponent(selectedVp.name)}`, {
        method: 'PUT',
        body:   JSON.stringify({ textLayers: layers }),
      });
      if (!res.ok) { flash('Save failed'); return; }
      await loadViewports();
      flash('Text layers saved');
    } catch { flash('Network error'); }
  }

  // ── Present to screen ────────────────────────────────────────────────────

  async function handleRequestScreens() {
    try {
      const details = await window.getScreenDetails();
      setScreens(details.screens);
    } catch (err) {
      flash(err.message || 'Screen access denied');
    }
  }

  function getDisplayUrl(vp) {
    const base = `${window.location.origin}/dsk/${encodeURIComponent(apiKey)}`;
    if (!vp || vp._builtin) return base;
    const u = new URL(base);
    u.searchParams.set('viewport', vp.name);
    return u.toString();
  }

  function openOnScreen(screen, url) {
    const popup = window.open(
      url, '_blank',
      `left=${screen.left},top=${screen.top},width=${screen.width},height=${screen.height}`
    );
    popup?.addEventListener('load', () => {
      try { popup.document.documentElement.requestFullscreen(); } catch {}
    });
  }

  // ── Image viewport settings ──────────────────────────────────────────────

  function getImgVpSettings(img, vpName) {
    if (!vpName || vpName === 'landscape') return img.settingsJson?.viewports?.landscape ?? {};
    return img.settingsJson?.viewports?.[vpName] ?? {};
  }

  async function saveImgVpSettings(img, vpName, patch) {
    const key = vpName === 'landscape' ? 'landscape' : vpName;
    const existing = img.settingsJson ?? {};
    const merged = {
      ...existing,
      viewports: {
        ...(existing.viewports ?? {}),
        [key]: { ...(getImgVpSettings(img, vpName)), ...patch },
      },
    };
    try {
      const res = await apiFetch(`/images/${img.id}`, {
        method: 'PUT',
        body:   JSON.stringify({ settingsJson: merged }),
      });
      if (!res.ok) { flash('Save failed'); return; }
      // Update local state
      setImages(imgs => imgs.map(i => i.id === img.id ? { ...i, settingsJson: merged } : i));
    } catch { flash('Network error'); }
  }

  // ── Render ───────────────────────────────────────────────────────────────

  if (!serverUrl || !apiKey) {
    return (
      <div style={{ padding: 32, color: 'var(--color-text-muted, #888)', fontFamily: 'sans-serif', fontSize: 16 }}>
        {session
          ? 'Connect to a backend first (click Connect in the top bar).'
          : 'Missing ?server= and ?apikey= URL parameters.'}
      </div>
    );
  }

  return (
    <div style={{ background: dark.bg, minHeight: '100vh', color: dark.text, fontFamily: 'sans-serif', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ background: dark.panel, borderBottom: `1px solid ${dark.border}`, padding: '12px 20px', display: 'flex', alignItems: 'center', gap: 16 }}>
        <span style={{ fontSize: 16, fontWeight: 'bold' }}>DSK Viewports</span>
        <span style={{ color: dark.muted, fontSize: 13 }}>{serverUrl}</span>
        {msg && <span style={{ marginLeft: 'auto', color: dark.accent, fontSize: 13 }}>{msg}</span>}
      </div>

      {/* Body */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        {/* Left panel — viewport list */}
        <div style={{ width: 240, background: dark.panel, borderRight: `1px solid ${dark.border}`, overflowY: 'auto', padding: 12, flexShrink: 0 }}>
          <div style={{ fontSize: 12, color: dark.muted, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Viewports</div>

          {allViewports.map(vp => (
            <div
              key={vp.name}
              onClick={() => { setSelected(vp.name); setCreating(false); }}
              style={{
                background:    selected === vp.name ? dark.cardHover : 'transparent',
                border:        `1px solid ${selected === vp.name ? dark.accentDim : 'transparent'}`,
                borderRadius:  6,
                padding:       '8px 10px',
                marginBottom:  4,
                cursor:        'pointer',
              }}
            >
              <div style={{ fontSize: 13, fontWeight: selected === vp.name ? 'bold' : 'normal' }}>
                {vp.label || vp.name}
              </div>
              <div style={{ fontSize: 11, color: dark.muted, marginTop: 2 }}>
                {vp._builtin ? 'built-in · ' : ''}{vp.width}×{vp.height} · {vp.viewportType}
              </div>
            </div>
          ))}

          <div style={{ marginTop: 12 }}>
            {!creating
              ? <button style={btnSmall} onClick={() => { setCreating(true); setSelected(null); }}>+ New Viewport</button>
              : (
                <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 'bold', color: dark.text }}>New Viewport</div>
                  <div>
                    <label style={labelStyle}>Name (slug)</label>
                    <input
                      style={{ ...inputStyle, width: '100%' }}
                      placeholder="vertical-left"
                      value={newVp.name}
                      onChange={e => setNewVp(v => ({ ...v, name: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '-') }))}
                      required
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>Label</label>
                    <input style={{ ...inputStyle, width: '100%' }} placeholder="Vertical Screen 1" value={newVp.label} onChange={e => setNewVp(v => ({ ...v, label: e.target.value }))} />
                  </div>
                  <div>
                    <label style={labelStyle}>Type</label>
                    <select style={{ ...inputStyle, width: '100%' }} value={newVp.viewportType} onChange={e => {
                      const vt = e.target.value;
                      setNewVp(v => ({ ...v, viewportType: vt, width: vt === 'vertical' ? 1080 : 1920, height: vt === 'vertical' ? 1920 : 1080 }));
                    }}>
                      <option value="landscape">Landscape</option>
                      <option value="vertical">Vertical</option>
                    </select>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <div style={{ flex: 1 }}>
                      <label style={labelStyle}>Width</label>
                      <input style={{ ...inputStyle, width: '100%' }} type="number" value={newVp.width} onChange={e => setNewVp(v => ({ ...v, width: parseInt(e.target.value, 10) || v.width }))} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <label style={labelStyle}>Height</label>
                      <input style={{ ...inputStyle, width: '100%' }} type="number" value={newVp.height} onChange={e => setNewVp(v => ({ ...v, height: parseInt(e.target.value, 10) || v.height }))} />
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button type="submit" style={btnPrimary}>Create</button>
                    <button type="button" style={btnBase} onClick={() => setCreating(false)}>Cancel</button>
                  </div>
                </form>
              )
            }
          </div>
        </div>

        {/* Right panel — viewport details */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
          {!selectedVp && !creating && (
            <div style={{ color: dark.muted }}>Select a viewport on the left to configure it.</div>
          )}

          {selectedVp && (
            <div style={{ maxWidth: 820 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
                <h2 style={{ margin: 0, fontSize: 18 }}>{selectedVp.label || selectedVp.name}</h2>
                {selectedVp._builtin && <span style={{ fontSize: 11, background: '#333', color: dark.muted, borderRadius: 4, padding: '2px 7px' }}>built-in</span>}
              </div>

              {/* Edit form — only for user-defined viewports */}
              {!selectedVp._builtin && editVp && (
                <Section title="Settings" style={{ marginBottom: 24 }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginBottom: 12 }}>
                    <div style={{ flex: '1 1 180px' }}>
                      <label style={labelStyle}>Label</label>
                      <input style={{ ...inputStyle, width: '100%' }} value={editVp.label} onChange={e => setEditVp(v => ({ ...v, label: e.target.value }))} />
                    </div>
                    <div style={{ flex: '0 0 140px' }}>
                      <label style={labelStyle}>Type</label>
                      <select style={{ ...inputStyle, width: '100%' }} value={editVp.viewportType} onChange={e => setEditVp(v => ({ ...v, viewportType: e.target.value }))}>
                        <option value="landscape">Landscape</option>
                        <option value="vertical">Vertical</option>
                      </select>
                    </div>
                    <div style={{ flex: '0 0 100px' }}>
                      <label style={labelStyle}>Width</label>
                      <input style={{ ...inputStyle, width: '100%' }} type="number" value={editVp.width} onChange={e => setEditVp(v => ({ ...v, width: parseInt(e.target.value, 10) || v.width }))} />
                    </div>
                    <div style={{ flex: '0 0 100px' }}>
                      <label style={labelStyle}>Height</label>
                      <input style={{ ...inputStyle, width: '100%' }} type="number" value={editVp.height} onChange={e => setEditVp(v => ({ ...v, height: parseInt(e.target.value, 10) || v.height }))} />
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button style={btnPrimary} onClick={handleSaveVp}>Save</button>
                    <button style={btnDanger}  onClick={handleDeleteVp}>Delete Viewport</button>
                  </div>
                </Section>
              )}

              {/* Display URL */}
              <Section title="Display URL" style={{ marginBottom: 24 }}>
                <div style={{ fontSize: 12, color: dark.muted, marginBottom: 8 }}>
                  Open this URL in a browser and output via HDMI / OBS Browser Source.
                  {selectedVp._builtin && ' (Existing landscape DSK behaviour — no change needed.)'}
                </div>
                <UrlBlock url={getDisplayUrl(selectedVp)} onCopy={() => flash('Copied')} />
              </Section>

              {/* Present to screen */}
              <Section title="Present to Screen" style={{ marginBottom: 24 }}>
                <div style={{ fontSize: 12, color: dark.muted, marginBottom: 10 }}>
                  Open the display URL on a specific connected monitor in fullscreen.
                  Requires browser permission to enumerate screens (Chrome/Chromium 100+).
                </div>
                {screenApiSupported === false && (
                  <div style={{ color: dark.muted, fontSize: 12 }}>
                    Window Placement API not available in this browser. Open the URL manually using the copy button above.
                  </div>
                )}
                {screenApiSupported && !screens && (
                  <button style={btnBase} onClick={handleRequestScreens}>List Connected Screens</button>
                )}
                {screens && (
                  <div>
                    {screens.length === 0 && <div style={{ color: dark.muted, fontSize: 12 }}>No screens found.</div>}
                    {screens.map((sc, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                        <span style={{ fontSize: 13, color: dark.text, minWidth: 180 }}>
                          {sc.label || `Screen ${i + 1}`} ({sc.width}×{sc.height}){sc.isPrimary ? ' · primary' : ''}
                        </span>
                        <button style={btnSmall} onClick={() => openOnScreen(sc, getDisplayUrl(selectedVp))}>
                          Open on this screen
                        </button>
                      </div>
                    ))}
                    <button style={{ ...btnSmall, marginTop: 6, color: dark.muted }} onClick={() => setScreens(null)}>Refresh screen list</button>
                  </div>
                )}
              </Section>

              {/* Per-image settings */}
              <Section title="Image Settings for this Viewport" style={{ marginBottom: 24 }}>
                <div style={{ fontSize: 12, color: dark.muted, marginBottom: 12 }}>
                  Control visibility and position of each uploaded image on <strong>{selectedVp.label || selectedVp.name}</strong>.
                  Blank position fields = full-width default. Animation: CSS shorthand e.g. <code>lcyt-fadeIn 0.5s</code>.
                </div>
                {selectedVp._builtin && (
                  <div style={{ fontSize: 12, color: dark.muted, marginBottom: 12 }}>
                    Metacode aliases for this viewport: <code>landscape</code>, <code>default</code>, <code>main</code>.
                    Use e.g. <code>{'<!-- graphics[landscape]:logo -->'}</code> to target only this display.
                  </div>
                )}
                {images.length === 0 && (
                  <div style={{ color: dark.muted, fontSize: 13 }}>No images uploaded yet.</div>
                )}
                {images.length > 0 && (
                  <ImageSettingsTable
                    images={images}
                    viewportName={selectedVp._builtin ? 'landscape' : selectedVp.name}
                    getImgVpSettings={getImgVpSettings}
                    saveImgVpSettings={saveImgVpSettings}
                    serverUrl={serverUrl}
                  />
                )}
              </Section>

              {/* Text layers — only for user-defined viewports */}
              {!selectedVp._builtin && (
                <Section title="Text Layers">
                  <div style={{ fontSize: 12, color: dark.muted, marginBottom: 12 }}>
                    Text layers display live values from caption <code>codes</code> (section, stanza, speaker, etc.)
                    at fixed positions on this viewport. Use e.g. <code>section:Gospel</code> in a metacode
                    and a text layer bound to <code>section</code> will show <em>Gospel</em>.
                  </div>
                  <TextLayersEditor
                    layers={draftLayers}
                    onChange={setDraftLayers}
                    vpWidth={selectedVp.width}
                    vpHeight={selectedVp.height}
                  />
                  <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
                    <button
                      style={btnPrimary}
                      onClick={() => saveTextLayers(draftLayers)}
                    >
                      Save Text Layers
                    </button>
                    <button
                      style={btnBase}
                      onClick={() => setDraftLayers(d => [...d, newLayer()])}
                    >
                      + Add Layer
                    </button>
                  </div>
                </Section>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Section({ title, children, style }) {
  return (
    <div style={{ background: dark.card, border: `1px solid ${dark.border}`, borderRadius: 8, padding: 16, ...style }}>
      <div style={{ fontSize: 12, fontWeight: 'bold', color: dark.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>{title}</div>
      {children}
    </div>
  );
}

function UrlBlock({ url, onCopy }) {
  async function copy() {
    try { await navigator.clipboard.writeText(url); onCopy(); } catch {}
  }
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <code style={{ flex: 1, background: '#111', border: `1px solid ${dark.border}`, borderRadius: 4, padding: '6px 10px', fontSize: 12, color: '#aef', wordBreak: 'break-all' }}>
        {url}
      </code>
      <button style={btnSmall} onClick={copy}>Copy</button>
      <button style={btnSmall} onClick={() => window.open(url, '_blank')}>Open</button>
    </div>
  );
}

function ImageSettingsTable({ images, viewportName, getImgVpSettings, saveImgVpSettings, serverUrl }) {
  const [expanded, setExpanded] = useState(new Set());

  function toggle(id) {
    setExpanded(s => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  return (
    <div>
      {/* Header row */}
      <div style={{ display: 'grid', gridTemplateColumns: '48px 1fr 80px 80px', gap: 8, padding: '4px 8px', fontSize: 11, color: dark.muted, borderBottom: `1px solid ${dark.border}`, marginBottom: 4 }}>
        <span />
        <span>Shorthand</span>
        <span>Visible</span>
        <span>Position</span>
      </div>
      {images.map(img => {
        const settings = getImgVpSettings(img, viewportName);
        const isExpanded = expanded.has(img.id);
        return (
          <ImageRow
            key={img.id}
            img={img}
            settings={settings}
            isExpanded={isExpanded}
            onToggleExpand={() => toggle(img.id)}
            onSave={patch => saveImgVpSettings(img, viewportName, patch)}
            serverUrl={serverUrl}
          />
        );
      })}
    </div>
  );
}

const COMMON_BINDINGS = ['section', 'stanza', 'speaker', 'song', 'lyrics'];

function TextLayersEditor({ layers, onChange, vpWidth, vpHeight }) {
  function updateLayer(idx, patch) {
    onChange(ls => ls.map((l, i) => i === idx ? { ...l, ...patch } : l));
  }
  function removeLayer(idx) {
    onChange(ls => ls.filter((_, i) => i !== idx));
  }

  if (layers.length === 0) {
    return <div style={{ color: dark.muted, fontSize: 13 }}>No text layers. Click "+ Add Layer" to add one.</div>;
  }

  return (
    <div>
      {layers.map((layer, idx) => (
        <div key={layer.id || idx} style={{ background: '#1a1a1a', border: `1px solid ${dark.border}`, borderRadius: 6, padding: 14, marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 'bold', color: dark.text }}>
              Layer {idx + 1}{layer.binding ? ` — bound to "${layer.binding}"` : ' — static text'}
            </span>
            <button style={{ ...btnDanger, padding: '3px 8px', fontSize: 11 }} onClick={() => removeLayer(idx)}>Remove</button>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            {/* Binding */}
            <div style={{ flex: '1 1 200px' }}>
              <label style={labelStyle}>Binding (code key)</label>
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  list={`bindings-list-${idx}`}
                  style={{ ...inputStyle, flex: 1 }}
                  placeholder="section, stanza, speaker…"
                  value={layer.binding || ''}
                  onChange={e => updateLayer(idx, { binding: e.target.value })}
                />
                <datalist id={`bindings-list-${idx}`}>
                  {COMMON_BINDINGS.map(b => <option key={b} value={b} />)}
                </datalist>
              </div>
            </div>
            {/* Static text (fallback / non-bound) */}
            <div style={{ flex: '1 1 200px' }}>
              <label style={labelStyle}>Static text (shown when no binding value)</label>
              <input
                style={{ ...inputStyle, width: '100%' }}
                placeholder="optional fallback"
                value={layer.text || ''}
                onChange={e => updateLayer(idx, { text: e.target.value })}
              />
            </div>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 10 }}>
            {[['x', 'X (px)'], ['y', 'Y (px)'], ['width', 'Width (px)'], ['height', 'Height (px)']].map(([key, lbl]) => (
              <div key={key} style={{ flex: '0 0 100px' }}>
                <label style={labelStyle}>{lbl}</label>
                <input
                  style={{ ...inputStyle, width: '100%' }}
                  type="number"
                  value={layer[key] ?? ''}
                  onChange={e => updateLayer(idx, { [key]: parseInt(e.target.value, 10) || 0 })}
                />
              </div>
            ))}
            <div style={{ flex: '0 0 80px' }}>
              <label style={labelStyle}>Font size</label>
              <input
                style={{ ...inputStyle, width: '100%' }}
                type="number"
                value={layer.fontSize ?? 48}
                onChange={e => updateLayer(idx, { fontSize: parseInt(e.target.value, 10) || 48 })}
              />
            </div>
            <div style={{ flex: '0 0 80px' }}>
              <label style={labelStyle}>Font weight</label>
              <select
                style={{ ...inputStyle, width: '100%' }}
                value={layer.fontWeight ?? 'bold'}
                onChange={e => updateLayer(idx, { fontWeight: e.target.value })}
              >
                <option value="normal">Normal</option>
                <option value="bold">Bold</option>
                <option value="600">600</option>
              </select>
            </div>
            <div style={{ flex: '0 0 80px' }}>
              <label style={labelStyle}>Color</label>
              <input
                style={{ ...inputStyle, width: '100%', padding: '4px 6px' }}
                type="color"
                value={layer.color || '#ffffff'}
                onChange={e => updateLayer(idx, { color: e.target.value })}
              />
            </div>
            <div style={{ flex: '0 0 100px' }}>
              <label style={labelStyle}>Align</label>
              <select
                style={{ ...inputStyle, width: '100%' }}
                value={layer.textAlign ?? 'center'}
                onChange={e => updateLayer(idx, { textAlign: e.target.value })}
              >
                <option value="left">Left</option>
                <option value="center">Center</option>
                <option value="right">Right</option>
              </select>
            </div>
            <div style={{ flex: '1 1 180px' }}>
              <label style={labelStyle}>Text shadow (CSS)</label>
              <input
                style={{ ...inputStyle, width: '100%' }}
                placeholder="0 2px 8px rgba(0,0,0,0.8)"
                value={layer.textShadow || ''}
                onChange={e => updateLayer(idx, { textShadow: e.target.value })}
              />
            </div>
          </div>
          {/* Mini preview */}
          {(vpWidth && vpHeight) && (
            <div style={{ marginTop: 12 }}>
              <TextLayerMiniPreview layer={layer} vpWidth={vpWidth} vpHeight={vpHeight} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function TextLayerMiniPreview({ layer, vpWidth, vpHeight }) {
  const PREVIEW_W = 280;
  const scale = PREVIEW_W / vpWidth;
  const previewH = vpHeight * scale;
  return (
    <div style={{ position: 'relative', width: PREVIEW_W, height: previewH, background: '#181818', border: `1px solid ${dark.border}`, borderRadius: 4, overflow: 'hidden' }}>
      {/* Grid lines */}
      <div style={{ position: 'absolute', inset: 0, backgroundImage: 'linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)', backgroundSize: `${PREVIEW_W/8}px ${previewH/8}px` }} />
      {/* Text layer preview box */}
      <div style={{
        position: 'absolute',
        left:       (layer.x || 0) * scale,
        top:        (layer.y || 0) * scale,
        width:      (layer.width || 400) * scale,
        height:     (layer.height || 80) * scale,
        border:     '1px dashed rgba(68,255,136,0.6)',
        background: 'rgba(68,255,136,0.05)',
        display:    'flex',
        alignItems: 'center',
        justifyContent: layer.textAlign === 'right' ? 'flex-end' : layer.textAlign === 'center' ? 'center' : 'flex-start',
        fontSize:   Math.max(8, (layer.fontSize || 48) * scale),
        fontWeight: layer.fontWeight || 'bold',
        color:      layer.color || '#ffffff',
        padding:    '0 4px',
        overflow:   'hidden',
        whiteSpace: 'nowrap',
      }}>
        {layer.binding || layer.text || <span style={{ opacity: 0.4, fontStyle: 'italic' }}>binding</span>}
      </div>
    </div>
  );
}

function ImageRow({ img, settings, isExpanded, onToggleExpand, onSave, serverUrl }) {
  const visible   = settings.visible !== false;
  const hasPos    = settings.x != null || settings.y != null || settings.width != null || settings.height != null;
  const hasAnim   = !!settings.animation;

  // Local draft for position editing
  const [draft, setDraft] = useState({
    x:         settings.x         != null ? String(settings.x)         : '',
    y:         settings.y         != null ? String(settings.y)         : '',
    width:     settings.width     != null ? String(settings.width)     : '',
    height:    settings.height    != null ? String(settings.height)    : '',
    animation: settings.animation ?? '',
  });

  // Sync draft when settings change (e.g. after save)
  useEffect(() => {
    setDraft({
      x:         settings.x         != null ? String(settings.x)         : '',
      y:         settings.y         != null ? String(settings.y)         : '',
      width:     settings.width     != null ? String(settings.width)     : '',
      height:    settings.height    != null ? String(settings.height)    : '',
      animation: settings.animation ?? '',
    });
  }, [settings.x, settings.y, settings.width, settings.height, settings.animation]); // eslint-disable-line react-hooks/exhaustive-deps

  function parsePx(val) {
    const n = parseInt(val, 10);
    return isNaN(n) ? null : n;
  }

  function handleSave() {
    onSave({
      x:         parsePx(draft.x),
      y:         parsePx(draft.y),
      width:     parsePx(draft.width),
      height:    parsePx(draft.height),
      animation: draft.animation || null,
    });
  }

  return (
    <div style={{ borderBottom: `1px solid ${dark.border}` }}>
      {/* Summary row */}
      <div style={{ display: 'grid', gridTemplateColumns: '48px 1fr 80px 80px', gap: 8, padding: '6px 8px', alignItems: 'center' }}>
        {/* Thumbnail */}
        <img
          src={`${serverUrl}/images/${img.id}`}
          alt=""
          style={{ width: 40, height: 40, objectFit: 'contain', background: '#111', borderRadius: 4, border: `1px solid ${dark.border}` }}
          crossOrigin="anonymous"
        />
        {/* Shorthand */}
        <div>
          <code style={{ fontSize: 13, color: '#aef' }}>{img.shorthand}</code>
          <span style={{ fontSize: 11, color: dark.muted, marginLeft: 8 }}>{img.mimeType?.split('/')[1]}</span>
        </div>
        {/* Visible toggle */}
        <div>
          <input
            type="checkbox"
            checked={visible}
            onChange={e => onSave({ visible: e.target.checked })}
            style={{ width: 16, height: 16, cursor: 'pointer' }}
          />
        </div>
        {/* Expand button */}
        <button
          style={{ ...btnSmall, background: isExpanded ? dark.cardHover : 'transparent', border: `1px solid ${isExpanded ? dark.border : 'transparent'}` }}
          onClick={onToggleExpand}
          title="Position & animation overrides"
        >
          {hasPos || hasAnim ? '✎' : '+'} pos
        </button>
      </div>

      {/* Expanded position row */}
      {isExpanded && (
        <div style={{ padding: '8px 56px 12px', background: '#1a1a1a', borderTop: `1px solid ${dark.border}` }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 10 }}>
            {[['x', 'X (px)'], ['y', 'Y (px)'], ['width', 'Width (px)'], ['height', 'Height (px)']].map(([key, lbl]) => (
              <div key={key} style={{ flex: '0 0 100px' }}>
                <label style={labelStyle}>{lbl}</label>
                <input
                  style={{ ...inputStyle, width: '100%' }}
                  type="number"
                  placeholder="auto"
                  value={draft[key]}
                  onChange={e => setDraft(d => ({ ...d, [key]: e.target.value }))}
                />
              </div>
            ))}
            <div style={{ flex: '1 1 200px' }}>
              <label style={labelStyle}>Animation</label>
              <input
                style={{ ...inputStyle, width: '100%' }}
                placeholder="e.g. lcyt-fadeIn 0.5s"
                value={draft.animation}
                onChange={e => setDraft(d => ({ ...d, animation: e.target.value }))}
              />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={btnPrimary} onClick={handleSave}>Save</button>
            <button style={btnDanger} onClick={() => onSave({ x: null, y: null, width: null, height: null, animation: null })}>
              Reset position
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
