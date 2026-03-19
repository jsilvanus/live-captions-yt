import { useCallback, useContext, useEffect, useState } from 'react';
import { SessionContext } from '../contexts/SessionContext';
import { templateSlug } from '../lib/formatting.js';

/**
 * DSK Broadcast Control Panel
 *
 * URL: /dsk-control/:apikey?server=<backendUrl>
 *
 * Shows saved DSK graphics templates as large clickable buttons.
 * Allows activating a template in the Playwright renderer and injecting
 * live data (name, title etc.) without reloading the renderer page.
 *
 * Auth: X-API-Key header (no live caption session required).
 */

const btnStyle = {
  background: '#1e1e1e',
  border: '1px solid #444',
  color: '#ddd',
  borderRadius: 6,
  padding: '8px 14px',
  fontSize: 14,
  cursor: 'pointer',
};

const btnPrimaryStyle = {
  ...btnStyle,
  background: '#1a4a2e',
  border: '1px solid #2d8a52',
  color: '#cfffdc',
};

const btnActiveStyle = {
  ...btnPrimaryStyle,
  background: '#116633',
  border: '2px solid #44ff88',
  color: '#ffffff',
  fontWeight: 'bold',
};

const btnSelectedStyle = {
  ...btnStyle,
  background: '#0f2b66',
  border: '1px solid #3b6cff',
  color: '#dfe9ff',
  fontWeight: '600',
};

const btnBroadcastedStyle = {
  ...btnPrimaryStyle,
  background: '#116633',
  border: '2px solid #44ff88',
  color: '#ffffff',
  fontWeight: 'bold',
};

const btnDangerStyle = {
  ...btnStyle,
  background: '#3a0000',
  border: '1px solid #882222',
  color: '#ffaaaa',
};

const btnSmall = { ...btnStyle, padding: '4px 8px', fontSize: 12 };

const inputStyle = {
  background: '#1a1a1a',
  border: '1px solid #444',
  color: '#eee',
  borderRadius: 4,
  padding: '6px 10px',
  fontSize: 14,
  width: '100%',
  boxSizing: 'border-box',
};

export function DskControlPage() {
  const session = useContext(SessionContext);
  const pathParts = window.location.pathname.split('/');
  // /dsk-control/:apikey (standalone) or /graphics/control (sidebar) — context takes priority
  const apiKey = session?.apiKey
    || (window.location.pathname.startsWith('/dsk-control/') ? (pathParts[2] || '') : '');
  const params = new URLSearchParams(window.location.search);
  const serverUrl = (session?.backendUrl || params.get('server') || '').replace(/\/$/, '');

  const [templates, setTemplates]         = useState([]);  // { id, name, updated_at, templateJson? }
  const [activeIds, setActiveIds]         = useState([]);  // selected template ids (multi-select)
  const [liveData, setLiveData]           = useState({});  // { layerId: text }
  const [rendererStatus, setRendererStatus] = useState(null); // { running, template, browserAlive }
  const [statusMsg, setStatusMsg]         = useState('');
  const [loading, setLoading]             = useState(false);
  const [images, setImages]               = useState([]);   // { id, shorthand, mimeType }
  const [activeOverlayImages, setActiveOverlayImages] = useState([]); // shorthands currently shown
  const [broadcastedIds, setBroadcastedIds] = useState([]); // ids that were broadcasted recently
  const [viewportsList, setViewportsList] = useState([]);
  const [selectedViewport, setSelectedViewport] = useState('landscape');
  const [previewOpen, setPreviewOpen] = useState(true);

  // ── API helper ──────────────────────────────────────────────────────────

  function apiFetch(path, opts = {}) {
    return fetch(`${serverUrl}${path}`, {
      ...opts,
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
        ...(opts.headers || {}),
      },
    });
  }

  // ── Load data ───────────────────────────────────────────────────────────

  const fetchTemplates = useCallback(async () => {
    if (!serverUrl || !apiKey) return;
    try {
      const res = await apiFetch(`/dsk/${encodeURIComponent(apiKey)}/templates`);
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setTemplates(data.templates || []);
    } catch (err) {
      setStatusMsg(`Error loading templates: ${err.message}`);
    }
  }, [serverUrl, apiKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchRendererStatus = useCallback(async () => {
    if (!serverUrl || !apiKey) return;
    try {
      const res = await apiFetch(`/dsk/${encodeURIComponent(apiKey)}/renderer/status`);
      if (res.ok) setRendererStatus(await res.json());
    } catch { /* non-fatal */ }
  }, [serverUrl, apiKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchImages = useCallback(async () => {
    if (!serverUrl || !apiKey) return;
    try {
      const res = await fetch(`${serverUrl}/dsk/${encodeURIComponent(apiKey)}/images`);
      if (!res.ok) return;
      const data = await res.json();
      setImages(data.images || []);
    } catch { /* non-fatal */ }
  }, [serverUrl, apiKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchPublicViewports = useCallback(async () => {
    if (!serverUrl || !apiKey) return;
    try {
      const res = await fetch(`${serverUrl}/dsk/${encodeURIComponent(apiKey)}/viewports/public`);
      if (!res.ok) return;
      const data = await res.json();
      setViewportsList(data.viewports || []);
    } catch {}
  }, [serverUrl, apiKey]);

  useEffect(() => {
    fetchTemplates();
    fetchRendererStatus();
    fetchImages();
    fetchPublicViewports();
    const interval = setInterval(fetchRendererStatus, 10000);
    return () => clearInterval(interval);
  }, [fetchTemplates, fetchRendererStatus, fetchImages, fetchPublicViewports]);

  // ── Load a template's full JSON to extract text layer ids ───────────────

  async function loadTemplateJson(id) {
    const existing = templates.find(t => t.id === id);
    if (existing?.templateJson) return existing.templateJson;
    try {
      const res = await apiFetch(`/dsk/${encodeURIComponent(apiKey)}/templates/${id}`);
      if (!res.ok) return null;
      const { template: row } = await res.json();
      // Cache in template list
      setTemplates(ts => ts.map(t => t.id === id ? { ...t, templateJson: row.templateJson } : t));
      return row.templateJson;
    } catch { return null; }
  }

  // ── Toggle template selection (multi-select) ────────────────────────────

  async function toggleTemplate(id) {
    const isSelected = activeIds.includes(id);
    if (isSelected) {
      setActiveIds(prev => prev.filter(x => x !== id));
      return;
    }
    // Adding: load JSON to reveal text layers in live data panel
    setLoading(true);
    setActiveIds(prev => [...prev, id]);
    try {
      const json = await loadTemplateJson(id);
      if (json) {
        // Seed liveData with defaults for any new layers not already present
        const defaults = {};
        for (const layer of json.layers || []) {
          if (layer.type === 'text' && !(layer.id in liveData)) {
            defaults[layer.id] = layer.text || '';
          }
        }
        if (Object.keys(defaults).length > 0) {
          setLiveData(d => ({ ...d, ...defaults }));
        }
      }
    } finally {
      setLoading(false);
    }
  }

  // ── Broadcast live data ──────────────────────────────────────────────────

  async function broadcastData() {
    if (activeIds.length === 0) { setStatusMsg('Select at least one template first.'); return; }
    const updates = Object.entries(liveData)
      .filter(([, v]) => v !== undefined)
      .map(([id, text]) => ({ selector: `#${id}`, text }));

    setStatusMsg('Broadcasting…');
    try {
      const res = await apiFetch(`/dsk/${encodeURIComponent(apiKey)}/broadcast`, {
        method: 'POST',
        body: JSON.stringify({ templateIds: activeIds, updates }),
      });
      if (!res.ok) throw new Error(await res.text());
      setStatusMsg('Broadcast sent.');
      // mark templates as broadcasted for UI state
      setBroadcastedIds(prev => Array.from(new Set([...(prev || []), ...activeIds])));
    } catch (err) {
      setStatusMsg(`Broadcast error: ${err.message}`);
    }
  }

  // ── Client-side overlay control ──────────────────────────────────────────

  function toggleOverlayImage(shorthand) {
    setActiveOverlayImages(prev =>
      prev.includes(shorthand) ? prev.filter(n => n !== shorthand) : [...prev, shorthand]
    );
  }

  async function pushOverlay() {
    setStatusMsg('Pushing to overlay…');
    try {
      const res = await apiFetch(`/dsk/${encodeURIComponent(apiKey)}/graphics`, {
        method: 'POST',
        body: JSON.stringify({ default: activeOverlayImages }),
      });
      if (!res.ok) throw new Error(await res.text());
      setStatusMsg('Overlay updated.');
    } catch (err) {
      setStatusMsg(`Overlay error: ${err.message}`);
    }
  }

  async function clearOverlay() {
    setActiveOverlayImages([]);
    setStatusMsg('Clearing overlay…');
    try {
      const res = await apiFetch(`/dsk/${encodeURIComponent(apiKey)}/graphics`, {
        method: 'POST',
        body: JSON.stringify({ default: [] }),
      });
      if (!res.ok) throw new Error(await res.text());
      setStatusMsg('Overlay cleared.');
    } catch (err) {
      setStatusMsg(`Clear error: ${err.message}`);
    }
  }

  // ── Renderer control ─────────────────────────────────────────────────────

  async function startRenderer() {
    setStatusMsg('Starting renderer…');
    try {
      const res = await apiFetch(`/dsk/${encodeURIComponent(apiKey)}/renderer/start`, { method: 'POST' });
      if (!res.ok) throw new Error(await res.text());
      setStatusMsg('Renderer started.');
      fetchRendererStatus();
    } catch (err) {
      setStatusMsg(`Start error: ${err.message}`);
    }
  }

  async function stopRenderer() {
    if (!window.confirm('Stop the renderer? The live DSK overlay will go dark.')) return;
    setStatusMsg('Stopping renderer…');
    try {
      const res = await apiFetch(`/dsk/${encodeURIComponent(apiKey)}/renderer/stop`, { method: 'POST' });
      if (!res.ok) throw new Error(await res.text());
      setStatusMsg('Renderer stopped.');
      fetchRendererStatus();
    } catch (err) {
      setStatusMsg(`Stop error: ${err.message}`);
    }
  }

  // ── Derived ──────────────────────────────────────────────────────────────

  const textLayers = activeIds.flatMap(id => {
    const t = templates.find(t => t.id === id);
    return t?.templateJson?.layers?.filter(l => l.type === 'text') || [];
  });

  function getLayerState(layerId) {
    // on-screen: any broadcasted template contains this layer
    const onScreen = templates.some(t => broadcastedIds.includes(t.id) && t.templateJson?.layers?.some(l => l.id === layerId));
    if (onScreen) return 'on';
    const selected = templates.some(t => activeIds.includes(t.id) && t.templateJson?.layers?.some(l => l.id === layerId));
    if (selected) return 'selected';
    return 'none';
  }

  const LANDSCAPE = { name: 'landscape', label: 'Landscape (default)', viewportType: 'landscape', width: 1920, height: 1080, textLayers: [], _builtin: true };
  const allViewports = [LANDSCAPE, ...viewportsList];
  const selViewportObj = allViewports.find(v => v.name === selectedViewport) || LANDSCAPE;
  const filteredImages = images.filter(img => {
    const vpSettings = img.settingsJson?.viewports?.[selectedViewport] ?? img.settingsJson?.viewports?.landscape;
    if (!vpSettings) return false;
    if (!vpSettings.width || !vpSettings.height) return false;
    return vpSettings.width === selViewportObj.width && vpSettings.height === selViewportObj.height;
  });

  // ── Guard ────────────────────────────────────────────────────────────────

  if (!serverUrl || !apiKey) {
    return (
      <div style={{ padding: 32, color: 'var(--color-text-muted, #888)', fontFamily: 'sans-serif', fontSize: 16 }}>
        {session
          ? 'Connect to a backend first (click Connect in the top bar).'
          : 'Missing API key in URL path or ?server= parameter.'}
      </div>
    );
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#0d0d0d', color: '#ddd', fontFamily: 'sans-serif', overflow: 'hidden' }}>

      {/* Header */}
      <div style={{ padding: '10px 16px', borderBottom: '1px solid #222', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <span style={{ fontWeight: 'bold', fontSize: 16 }}>DSK Control</span>
        <span style={{ color: '#666', fontSize: 13 }}>{apiKey}</span>
        <span style={{ flex: 1 }} />

        {/* Renderer status */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            width: 10, height: 10, borderRadius: '50%',
            background: rendererStatus?.running ? '#44ff88' : rendererStatus?.browserAlive === false ? '#ff4444' : '#888',
            display: 'inline-block',
          }} />
          <span style={{ fontSize: 13, color: '#aaa' }}>
            {rendererStatus?.running ? 'Streaming' : rendererStatus === null ? 'Unknown' : 'Idle'}
          </span>
          {rendererStatus?.running
            ? <button onClick={stopRenderer} style={btnDangerStyle}>Stop server-side renderer</button>
            : <button onClick={startRenderer} style={btnPrimaryStyle}>Start server-side renderer</button>
          }
        </div>

        <a
          href={`/graphics/viewports?server=${encodeURIComponent(serverUrl)}&apikey=${encodeURIComponent(apiKey)}`}
          style={{ ...btnStyle, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', fontSize: 13 }}
        >
          Manage Viewports
        </a>

        {statusMsg && (
          <span style={{ fontSize: 12, color: statusMsg.startsWith('Error') || statusMsg.includes('error') ? '#f88' : '#8d8', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {statusMsg}
          </span>
        )}
      </div>

      {/* Main content */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* Template grid */}
        <div style={{ flex: 1, padding: 16, overflowY: 'auto' }}>
          <div style={{ fontSize: 12, color: '#666', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>
            Templates — click to select, Broadcast to publish
          </div>

          {templates.length === 0 && (
            <div style={{ color: '#555', fontSize: 14 }}>
              No templates found. Create some in the{' '}
              <a href={`/dsk-editor?server=${encodeURIComponent(serverUrl)}&apikey=${encodeURIComponent(apiKey)}`}
                style={{ color: '#4488dd' }}>
                template editor
              </a>.
            </div>
          )}

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            {templates.map(t => {
              const isSelected = activeIds.includes(t.id);
              const isBroadcasted = broadcastedIds.includes(t.id);
              const style = isBroadcasted ? btnBroadcastedStyle : isSelected ? btnSelectedStyle : btnStyle;
              return (
                <button
                  key={t.id}
                  onClick={() => toggleTemplate(t.id)}
                  disabled={loading}
                  style={{
                    ...style,
                    minWidth: 160,
                    minHeight: 80,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 4,
                    textAlign: 'center',
                  }}
                >
                  <span style={{ fontSize: 16, fontWeight: 'bold' }}>{t.name}</span>
                  <span style={{ fontSize: 11, color: isSelected || isBroadcasted ? '#aef' : '#556', fontFamily: 'monospace' }}>{templateSlug(t.name)}</span>
                  {isBroadcasted && <span style={{ fontSize: 11, color: '#44ff88' }}>BROADCASTED</span>}
                  {!isBroadcasted && isSelected && <span style={{ fontSize: 11, color: '#66aaff' }}>SELECTED</span>}
                </button>
              );
            })}
          </div>
        </div>

        {/* Live data panel */}
        <div style={{ width: 300, borderLeft: '1px solid #222', padding: 16, display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto', flexShrink: 0 }}>
          <div style={{ fontSize: 12, color: '#666', textTransform: 'uppercase', letterSpacing: 1 }}>
            Live Data
          </div>

          {/* Collapsible client-side viewport preview */}
          <div style={{ marginTop: 8, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
            <button onClick={() => setPreviewOpen(p => !p)} style={{ ...btnSmall, padding: '4px 8px' }}>{previewOpen ? '▾' : '▸'} Preview</button>
            <div style={{ fontSize: 12, color: '#888' }}>{selViewportObj.label || selViewportObj.name} — {selViewportObj.width}×{selViewportObj.height}</div>
            <div style={{ flex: 1 }} />
          </div>
          {previewOpen && (
            <div style={{ width: '100%', display: 'flex', justifyContent: 'center', marginBottom: 8 }}>
              <div style={{ border: '1px solid #222', background: '#0a0a0a', padding: 8 }}>
                {(() => {
                  const PREVIEW_W = 260;
                  const scale = PREVIEW_W / selViewportObj.width;
                  const PREVIEW_H = Math.round(selViewportObj.height * scale);
                  return (
                    <div style={{ width: PREVIEW_W, height: PREVIEW_H, position: 'relative', background: '#101010' }}>
                      {/* grid */}
                      <div style={{ position: 'absolute', inset: 0, backgroundImage: 'linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px)', backgroundSize: `${PREVIEW_W/8}px ${PREVIEW_H/8}px` }} />
                      {/* Draw layers from selected templates */}
                      {activeIds.flatMap(id => templates.find(t => t.id === id)?.templateJson?.layers || []).filter(l => l.type === 'text').map((layer, i) => {
                        const state = getLayerState(layer.id);
                        const border = state === 'on' ? '2px solid #44ff88' : state === 'selected' ? '1px solid #3b6cff' : '1px dashed rgba(255,255,255,0.05)';
                        return (
                          <div key={`${layer.id}-${i}`} style={{ position: 'absolute', left: (layer.x || 0) * scale, top: (layer.y || 0) * scale, width: (layer.width || 400) * scale, height: (layer.height || 120) * scale, border, boxSizing: 'border-box', background: state === 'on' ? 'rgba(68,255,136,0.06)' : 'transparent', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: Math.max(10, (layer.fontSize || 48) * scale), overflow: 'hidden', padding: '2px' }}>{layer.binding || layer.text || layer.id}</div>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>
            </div>
          )}

          {activeIds.length === 0 && (
            <div style={{ color: '#555', fontSize: 13 }}>Select a template to edit live data.</div>
          )}

          {textLayers.map(layer => (
            <div key={layer.id}>
              {(() => {
                const st = getLayerState(layer.id);
                const lblColor = st === 'on' ? '#44ff88' : st === 'selected' ? '#66aaff' : '#888';
                return (
                  <label style={{ display: 'block', fontSize: 12, color: lblColor, marginBottom: 4 }}>
                    {layer.id}
                  </label>
                );
              })()}
              <input
                type="text"
                value={liveData[layer.id] ?? layer.text ?? ''}
                onChange={e => setLiveData(d => ({ ...d, [layer.id]: e.target.value }))}
                placeholder={layer.text || layer.id}
                style={inputStyle}
              />
            </div>
          ))}

          {activeIds.length > 0 && textLayers.length === 0 && (
            <div style={{ color: '#555', fontSize: 13 }}>Selected templates have no text layers.</div>
          )}

          {activeIds.length > 0 && (
            <button onClick={broadcastData} style={{ ...btnPrimaryStyle, marginTop: 8 }}>
              Broadcast
            </button>
          )}

          {/* Client-side overlay */}
          <div style={{ paddingTop: 16, borderTop: '1px solid #222' }}>
            <div style={{ fontSize: 12, color: '#666', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
              Full Image Overlays
              <select value={selectedViewport} onChange={e => setSelectedViewport(e.target.value)} style={{ marginLeft: 8, background: '#111', color: '#ddd', border: '1px solid #333', padding: '4px 8px', borderRadius: 4 }}>
                <option value="landscape">Landscape (default)</option>
                {viewportsList.map(v => <option key={v.name} value={v.name}>{v.label || v.name} ({v.width}×{v.height})</option>)}
              </select>
            </div>

            {filteredImages.length === 0 && (
              <div style={{ color: '#555', fontSize: 13 }}>No matching images for selected viewport.</div>
            )}

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
              {filteredImages.map(img => {
                const isOn = activeOverlayImages.includes(img.shorthand);
                return (
                  <button
                    key={img.id}
                    onClick={() => toggleOverlayImage(img.shorthand)}
                    style={{ ...(isOn ? btnActiveStyle : btnStyle), fontSize: 12, padding: '4px 10px', minWidth: 0 }}
                    title={img.shorthand}
                  >
                    {img.shorthand}
                  </button>
                );
              })}
            </div>

            {filteredImages.length > 0 && (
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={pushOverlay} style={{ ...btnPrimaryStyle, flex: 1, fontSize: 13 }}>
                  Push to overlay
                </button>
                <button onClick={clearOverlay} style={{ ...btnStyle, fontSize: 13 }}>
                  Clear
                </button>
              </div>
            )}
          </div>

          {/* Link to editor */}
          <div style={{ paddingTop: 16, borderTop: '1px solid #222' }}>
            <a
              href={`/dsk-editor?server=${encodeURIComponent(serverUrl)}&apikey=${encodeURIComponent(apiKey)}`}
              style={{ color: '#4488dd', fontSize: 13, textDecoration: 'none' }}
            >
              Open template editor →
            </a>
          </div>
        </div>

      </div>
    </div>
  );
}
