import { useCallback, useContext, useEffect, useState } from 'react';
import { SessionContext } from '../contexts/SessionContext';

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

const btnDangerStyle = {
  ...btnStyle,
  background: '#3a0000',
  border: '1px solid #882222',
  color: '#ffaaaa',
};

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
  // /dsk-control/:apikey (standalone) or /graphics/control (sidebar)
  const apiKey = window.location.pathname.startsWith('/dsk-control/')
    ? (pathParts[2] || session?.apiKey || '')
    : (session?.apiKey || '');
  const params = new URLSearchParams(window.location.search);
  const serverUrl = (params.get('server') || session?.backendUrl || '').replace(/\/$/, '');

  const [templates, setTemplates]         = useState([]);  // { id, name, updated_at, templateJson? }
  const [activeId, setActiveId]           = useState(null); // currently activated template id
  const [liveData, setLiveData]           = useState({});   // { layerId: text }
  const [rendererStatus, setRendererStatus] = useState(null); // { running, template, browserAlive }
  const [statusMsg, setStatusMsg]         = useState('');
  const [activating, setActivating]       = useState(false);
  const [images, setImages]               = useState([]);   // { id, shorthand, mimeType }
  const [activeOverlayImages, setActiveOverlayImages] = useState([]); // shorthands currently shown

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

  useEffect(() => {
    fetchTemplates();
    fetchRendererStatus();
    fetchImages();
    const interval = setInterval(fetchRendererStatus, 10000);
    return () => clearInterval(interval);
  }, [fetchTemplates, fetchRendererStatus, fetchImages]);

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

  // ── Activate template ────────────────────────────────────────────────────

  async function activateTemplate(id) {
    setActivating(true);
    setStatusMsg('Activating…');
    try {
      const res = await apiFetch(`/dsk/${encodeURIComponent(apiKey)}/templates/${id}/activate`, { method: 'POST' });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setActiveId(id);
      setStatusMsg(data.rendererOk === false ? 'Activated (renderer not running).' : 'Activated.');
      // Pre-load the template JSON so we know which fields to show
      const json = await loadTemplateJson(id);
      if (json) {
        // Reset live data fields to template defaults
        const defaults = {};
        for (const layer of json.layers || []) {
          if (layer.type === 'text') defaults[layer.id] = layer.text || '';
        }
        setLiveData(defaults);
      }
      fetchRendererStatus();
    } catch (err) {
      setStatusMsg(`Activate error: ${err.message}`);
    } finally {
      setActivating(false);
    }
  }

  // ── Broadcast live data ──────────────────────────────────────────────────

  async function broadcastData() {
    if (!activeId) { setStatusMsg('No active template. Activate one first.'); return; }
    const updates = Object.entries(liveData)
      .filter(([, v]) => v !== undefined)
      .map(([id, text]) => ({ selector: `#${id}`, text }));
    if (updates.length === 0) { setStatusMsg('No data to broadcast.'); return; }

    setStatusMsg('Broadcasting…');
    try {
      const res = await apiFetch(`/dsk/${encodeURIComponent(apiKey)}/broadcast`, {
        method: 'POST',
        body: JSON.stringify({ updates }),
      });
      if (!res.ok) throw new Error(await res.text());
      setStatusMsg('Broadcast sent.');
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

  const activeTemplate = templates.find(t => t.id === activeId);
  const activeJson = activeTemplate?.templateJson;
  const textLayers = activeJson?.layers?.filter(l => l.type === 'text') || [];

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
          href={`/dsk-viewports?server=${encodeURIComponent(serverUrl)}&apikey=${encodeURIComponent(apiKey)}`}
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
            Templates — click to activate (client-side overlay + server-side renderer)
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
              const isActive = t.id === activeId;
              return (
                <button
                  key={t.id}
                  onClick={() => activateTemplate(t.id)}
                  disabled={activating}
                  style={{
                    ...(isActive ? btnActiveStyle : btnStyle),
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
                  {isActive && <span style={{ fontSize: 11, color: '#44ff88' }}>ACTIVE</span>}
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

          {!activeId && (
            <div style={{ color: '#555', fontSize: 13 }}>Activate a template to edit live data.</div>
          )}

          {textLayers.map(layer => (
            <div key={layer.id}>
              <label style={{ display: 'block', fontSize: 12, color: '#888', marginBottom: 4 }}>
                {layer.id}
              </label>
              <input
                type="text"
                value={liveData[layer.id] ?? layer.text ?? ''}
                onChange={e => setLiveData(d => ({ ...d, [layer.id]: e.target.value }))}
                placeholder={layer.text || layer.id}
                style={inputStyle}
              />
            </div>
          ))}

          {activeId && textLayers.length === 0 && (
            <div style={{ color: '#555', fontSize: 13 }}>This template has no text layers.</div>
          )}

          {activeId && (
            <button onClick={broadcastData} style={{ ...btnPrimaryStyle, marginTop: 8 }}>
              Broadcast
            </button>
          )}

          {/* Client-side overlay */}
          <div style={{ paddingTop: 16, borderTop: '1px solid #222' }}>
            <div style={{ fontSize: 12, color: '#666', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
              Client-side Overlay
            </div>

            {images.length === 0 && (
              <div style={{ color: '#555', fontSize: 13 }}>No images uploaded.</div>
            )}

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
              {images.map(img => {
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

            {images.length > 0 && (
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
