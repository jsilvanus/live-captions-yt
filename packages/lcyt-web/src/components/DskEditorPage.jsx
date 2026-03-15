import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * DSK Graphics Template Editor
 *
 * URL: /dsk-editor?server=<backendUrl>&apikey=<key>
 *
 * Allows designing lower-third, bug, and full-screen graphic templates stored
 * as JSON on the backend. Preview mirrors the Playwright renderer output.
 */

// ── Preset templates ────────────────────────────────────────────────────────

const PRESETS = {
  'Lower Third': {
    background: 'transparent',
    width: 1920,
    height: 1080,
    layers: [
      {
        id: 'bg',
        type: 'rect',
        x: 0, y: 790, width: 1920, height: 290,
        style: { background: '#1a1a2e', opacity: '0.92', 'border-radius': '0' },
      },
      {
        id: 'name',
        type: 'text',
        x: 80, y: 840, width: 1760,
        text: 'Speaker Name',
        style: { 'font-size': '56px', 'font-family': 'Arial, sans-serif', color: '#ffffff', 'font-weight': 'bold', 'white-space': 'nowrap' },
      },
      {
        id: 'title',
        type: 'text',
        x: 80, y: 930, width: 1760,
        text: 'Title / Organisation',
        style: { 'font-size': '38px', 'font-family': 'Arial, sans-serif', color: '#cccccc', 'white-space': 'nowrap' },
      },
    ],
  },
  'Corner Bug': {
    background: 'transparent',
    width: 1920,
    height: 1080,
    layers: [
      {
        id: 'bug-bg',
        type: 'rect',
        x: 40, y: 40, width: 320, height: 100,
        style: { background: '#000000', opacity: '0.75', 'border-radius': '8px' },
      },
      {
        id: 'bug-text',
        type: 'text',
        x: 60, y: 62,
        text: 'LIVE',
        style: { 'font-size': '48px', 'font-family': 'Arial, sans-serif', color: '#ff3300', 'font-weight': 'bold', 'letter-spacing': '4px' },
      },
    ],
  },
  'Full-screen Title': {
    background: '#000000',
    width: 1920,
    height: 1080,
    layers: [
      {
        id: 'title',
        type: 'text',
        x: 0, y: 420, width: 1920,
        text: 'Event Title',
        style: { 'font-size': '96px', 'font-family': 'Arial, sans-serif', color: '#ffffff', 'font-weight': 'bold', 'text-align': 'center' },
      },
      {
        id: 'subtitle',
        type: 'text',
        x: 0, y: 560, width: 1920,
        text: 'Subtitle or Date',
        style: { 'font-size': '52px', 'font-family': 'Arial, sans-serif', color: '#aaaaaa', 'text-align': 'center' },
      },
    ],
  },
};

const EMPTY_TEMPLATE = {
  background: 'transparent',
  width: 1920,
  height: 1080,
  layers: [],
};

// ── Preview rendering ────────────────────────────────────────────────────────

/**
 * Renders template JSON layers as React JSX in a scaled container.
 * Mirrors the logic in packages/plugins/lcyt-dsk/src/renderer.js renderTemplateToHtml().
 */
function TemplatePreview({ template, selectedLayerId, onSelectLayer }) {
  const t = template || EMPTY_TEMPLATE;
  const layers = Array.isArray(t.layers) ? t.layers : [];

  return (
    <div style={{
      width: 960,
      height: 540,
      position: 'relative',
      overflow: 'hidden',
      flexShrink: 0,
      border: '2px solid #444',
      borderRadius: 4,
      cursor: 'default',
    }}>
      {/* Canvas at 1920×1080 scaled to 50% */}
      <div style={{
        width: 1920,
        height: 1080,
        position: 'absolute',
        top: 0,
        left: 0,
        transform: 'scale(0.5)',
        transformOrigin: 'top left',
        background: t.background || 'transparent',
        backgroundImage: t.background === 'transparent' || !t.background
          ? 'repeating-conic-gradient(#2a2a2a 0% 25%, #1a1a1a 0% 50%) 0 0 / 40px 40px'
          : undefined,
      }}>
        {layers.map((layer) => {
          const isSelected = layer.id === selectedLayerId;
          const base = {
            position: 'absolute',
            left: Number(layer.x) || 0,
            top: Number(layer.y) || 0,
            ...(layer.width != null ? { width: Number(layer.width) } : {}),
            ...(layer.height != null ? { height: Number(layer.height) } : {}),
            outline: isSelected ? '3px solid #4af' : undefined,
            cursor: 'pointer',
            boxSizing: 'border-box',
          };

          // Apply style object (CSS property names as-is from template JSON)
          const styleProps = {};
          if (layer.style) {
            for (const [k, v] of Object.entries(layer.style)) {
              // Convert kebab-case to camelCase for React
              const camel = k.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
              styleProps[camel] = v;
            }
          }

          const merged = { ...base, ...styleProps };

          const handleClick = (e) => {
            e.stopPropagation();
            onSelectLayer(layer.id);
          };

          if (layer.type === 'text') {
            return (
              <div key={layer.id} style={merged} onClick={handleClick}>
                {layer.text || ''}
              </div>
            );
          } else if (layer.type === 'rect') {
            return <div key={layer.id} style={merged} onClick={handleClick} />;
          } else if (layer.type === 'image') {
            return (
              <img
                key={layer.id}
                src={layer.src || ''}
                alt=""
                style={merged}
                onClick={handleClick}
              />
            );
          }
          return null;
        })}
      </div>
    </div>
  );
}

// ── Layer property editor ────────────────────────────────────────────────────

const COMMON_FIELDS = [
  { key: 'x', label: 'X', type: 'number' },
  { key: 'y', label: 'Y', type: 'number' },
  { key: 'width', label: 'Width', type: 'number' },
  { key: 'height', label: 'Height', type: 'number' },
];

const STYLE_FIELDS_RECT = [
  { key: 'background', label: 'Background', type: 'color-text' },
  { key: 'opacity', label: 'Opacity', type: 'text', placeholder: '0.9' },
  { key: 'border-radius', label: 'Border radius', type: 'text', placeholder: '8px' },
];

const STYLE_FIELDS_TEXT = [
  { key: 'font-family', label: 'Font family', type: 'text', placeholder: 'Arial, sans-serif' },
  { key: 'font-size', label: 'Font size', type: 'text', placeholder: '48px' },
  { key: 'font-weight', label: 'Font weight', type: 'text', placeholder: 'bold' },
  { key: 'color', label: 'Color', type: 'color-text' },
  { key: 'letter-spacing', label: 'Letter spacing', type: 'text', placeholder: '2px' },
  { key: 'text-align', label: 'Text align', type: 'select', options: ['left', 'center', 'right'] },
  { key: 'white-space', label: 'White space', type: 'select', options: ['normal', 'nowrap', 'pre'] },
];

function ColorTextInput({ value, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
      <input
        type="color"
        value={value && value.startsWith('#') ? value.slice(0, 7) : '#000000'}
        onChange={e => onChange(e.target.value)}
        style={{ width: 32, height: 24, padding: 0, border: 'none', cursor: 'pointer', flexShrink: 0 }}
      />
      <input
        type="text"
        value={value || ''}
        onChange={e => onChange(e.target.value)}
        style={inputStyle}
      />
    </div>
  );
}

function LayerPropertyEditor({ layer, onChange }) {
  if (!layer) {
    return (
      <div style={{ color: '#888', fontSize: 13, padding: '16px 0' }}>
        Select a layer to edit its properties.
      </div>
    );
  }

  function setField(key, value) {
    onChange({ ...layer, [key]: value === '' ? undefined : (key === 'x' || key === 'y' || key === 'width' || key === 'height' ? Number(value) : value) });
  }

  function setStyle(cssKey, value) {
    const style = { ...(layer.style || {}) };
    if (value === '' || value === undefined) {
      delete style[cssKey];
    } else {
      style[cssKey] = value;
    }
    onChange({ ...layer, style });
  }

  const styleFields = layer.type === 'text' ? STYLE_FIELDS_TEXT : layer.type === 'rect' ? STYLE_FIELDS_RECT : [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {/* ID & type (read-only display) */}
      <div style={fieldRowStyle}>
        <span style={labelStyle}>ID</span>
        <input
          type="text"
          value={layer.id || ''}
          onChange={e => setField('id', e.target.value)}
          style={inputStyle}
        />
      </div>
      <div style={fieldRowStyle}>
        <span style={labelStyle}>Type</span>
        <span style={{ color: '#aaa', fontSize: 13 }}>{layer.type}</span>
      </div>

      {/* Text content */}
      {layer.type === 'text' && (
        <div style={fieldRowStyle}>
          <span style={labelStyle}>Text</span>
          <input
            type="text"
            value={layer.text || ''}
            onChange={e => setField('text', e.target.value)}
            style={inputStyle}
          />
        </div>
      )}

      {/* Position/size */}
      <div style={{ borderTop: '1px solid #333', paddingTop: 6, marginTop: 2, color: '#777', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1 }}>Position & Size</div>
      {COMMON_FIELDS.map(f => (
        <div key={f.key} style={fieldRowStyle}>
          <span style={labelStyle}>{f.label}</span>
          <input
            type="number"
            value={layer[f.key] ?? ''}
            onChange={e => setField(f.key, e.target.value)}
            style={{ ...inputStyle, width: 100 }}
          />
        </div>
      ))}

      {/* Style fields */}
      {styleFields.length > 0 && (
        <div style={{ borderTop: '1px solid #333', paddingTop: 6, marginTop: 2, color: '#777', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1 }}>Style</div>
      )}
      {styleFields.map(f => (
        <div key={f.key} style={fieldRowStyle}>
          <span style={labelStyle}>{f.label}</span>
          {f.type === 'color-text'
            ? <ColorTextInput value={layer.style?.[f.key] || ''} onChange={v => setStyle(f.key, v)} />
            : f.type === 'select'
              ? (
                <select value={layer.style?.[f.key] || ''} onChange={e => setStyle(f.key, e.target.value)} style={inputStyle}>
                  <option value="">—</option>
                  {f.options.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              )
              : (
                <input
                  type="text"
                  value={layer.style?.[f.key] || ''}
                  placeholder={f.placeholder || ''}
                  onChange={e => setStyle(f.key, e.target.value)}
                  style={inputStyle}
                />
              )
          }
        </div>
      ))}
    </div>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────

const inputStyle = {
  background: '#1e1e1e',
  border: '1px solid #444',
  color: '#eee',
  borderRadius: 3,
  padding: '3px 6px',
  fontSize: 13,
  flex: 1,
  minWidth: 0,
  boxSizing: 'border-box',
};

const fieldRowStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
};

const labelStyle = {
  color: '#999',
  fontSize: 12,
  width: 90,
  flexShrink: 0,
  textAlign: 'right',
};

const btnStyle = {
  background: '#2a2a2a',
  border: '1px solid #555',
  color: '#ddd',
  borderRadius: 4,
  padding: '4px 10px',
  fontSize: 13,
  cursor: 'pointer',
};

const btnPrimaryStyle = {
  ...btnStyle,
  background: '#2255aa',
  border: '1px solid #4488dd',
  color: '#fff',
};

const btnDangerStyle = {
  ...btnStyle,
  background: '#550000',
  border: '1px solid #882222',
  color: '#ffaaaa',
};

// ── Main component ───────────────────────────────────────────────────────────

let _layerCounter = 0;
function newLayerId(type) {
  _layerCounter += 1;
  return `${type}-${_layerCounter}`;
}

export function DskEditorPage() {
  const params = new URLSearchParams(window.location.search);
  const apiKey = params.get('apikey') || '';
  const serverUrl = (params.get('server') || '').replace(/\/$/, '');

  const [templates, setTemplates]       = useState([]);   // { id, name, updated_at }[]
  const [selectedId, setSelectedId]     = useState(null); // currently loaded template id
  const [templateName, setTemplateName] = useState('');
  const [template, setTemplate]         = useState(EMPTY_TEMPLATE);
  const [selectedLayerId, setSelectedLayerId] = useState(null);
  const [status, setStatus]             = useState('');   // save feedback
  const [loading, setLoading]           = useState(false);

  const isDirty = useRef(false);

  // ── API helpers ──────────────────────────────────────────────────────────

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

  // ── Template list ────────────────────────────────────────────────────────

  const fetchTemplates = useCallback(async () => {
    if (!serverUrl || !apiKey) return;
    try {
      const res = await apiFetch(`/dsk/${encodeURIComponent(apiKey)}/templates`);
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setTemplates(data.templates || []);
    } catch (err) {
      setStatus(`Error loading templates: ${err.message}`);
    }
  }, [serverUrl, apiKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchTemplates(); }, [fetchTemplates]);

  // ── Load template for editing ────────────────────────────────────────────

  async function loadTemplate(id) {
    try {
      const res = await apiFetch(`/dsk/${encodeURIComponent(apiKey)}/templates/${id}`);
      if (!res.ok) throw new Error(await res.text());
      const { template: row } = await res.json();
      setSelectedId(row.id);
      setTemplateName(row.name);
      setTemplate(row.templateJson || EMPTY_TEMPLATE);
      setSelectedLayerId(null);
      isDirty.current = false;
      setStatus('');
    } catch (err) {
      setStatus(`Error loading template: ${err.message}`);
    }
  }

  // ── New template from preset ─────────────────────────────────────────────

  function newFromPreset(presetName) {
    const preset = PRESETS[presetName];
    setSelectedId(null);
    setTemplateName(presetName);
    setTemplate(JSON.parse(JSON.stringify(preset))); // deep copy
    setSelectedLayerId(null);
    isDirty.current = true;
    setStatus('');
  }

  function newBlank() {
    setSelectedId(null);
    setTemplateName('New Template');
    setTemplate(JSON.parse(JSON.stringify(EMPTY_TEMPLATE)));
    setSelectedLayerId(null);
    isDirty.current = true;
    setStatus('');
  }

  // ── Save ─────────────────────────────────────────────────────────────────

  async function saveTemplate() {
    if (!templateName.trim()) { setStatus('Template name is required'); return; }
    setLoading(true);
    setStatus('Saving…');
    try {
      let res;
      if (selectedId) {
        // Update existing by id
        res = await apiFetch(`/dsk/${encodeURIComponent(apiKey)}/templates/${selectedId}`, {
          method: 'PUT',
          body: JSON.stringify({ name: templateName.trim(), template }),
        });
      } else {
        // Create new
        res = await apiFetch(`/dsk/${encodeURIComponent(apiKey)}/templates`, {
          method: 'POST',
          body: JSON.stringify({ name: templateName.trim(), template }),
        });
      }
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      if (!selectedId) setSelectedId(data.id);
      isDirty.current = false;
      setStatus('Saved.');
      await fetchTemplates();
    } catch (err) {
      setStatus(`Save error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  // ── Delete template ──────────────────────────────────────────────────────

  async function deleteTemplate(id, name) {
    if (!window.confirm(`Delete template "${name}"?`)) return;
    try {
      const res = await apiFetch(`/dsk/${encodeURIComponent(apiKey)}/templates/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(await res.text());
      if (selectedId === id) {
        setSelectedId(null);
        setTemplateName('');
        setTemplate(EMPTY_TEMPLATE);
        setSelectedLayerId(null);
      }
      await fetchTemplates();
      setStatus('Deleted.');
    } catch (err) {
      setStatus(`Delete error: ${err.message}`);
    }
  }

  // ── Layer management ─────────────────────────────────────────────────────

  function addLayer(type) {
    const id = newLayerId(type);
    const newLayer = type === 'rect'
      ? { id, type: 'rect', x: 100, y: 100, width: 400, height: 100, style: { background: '#333333', opacity: '0.9' } }
      : type === 'text'
        ? { id, type: 'text', x: 100, y: 100, text: 'Text', style: { 'font-size': '48px', 'font-family': 'Arial, sans-serif', color: '#ffffff' } }
        : { id, type: 'image', x: 0, y: 0, width: 400, height: 300, src: '' };

    setTemplate(t => ({ ...t, layers: [...(t.layers || []), newLayer] }));
    setSelectedLayerId(id);
    isDirty.current = true;
  }

  function updateLayer(updated) {
    setTemplate(t => ({
      ...t,
      layers: t.layers.map(l => l.id === updated.id ? updated : l),
    }));
    isDirty.current = true;
  }

  function deleteLayer(id) {
    setTemplate(t => ({ ...t, layers: t.layers.filter(l => l.id !== id) }));
    if (selectedLayerId === id) setSelectedLayerId(null);
    isDirty.current = true;
  }

  function moveLayer(id, dir) {
    setTemplate(t => {
      const layers = [...t.layers];
      const idx = layers.findIndex(l => l.id === id);
      if (idx < 0) return t;
      const target = idx + dir;
      if (target < 0 || target >= layers.length) return t;
      [layers[idx], layers[target]] = [layers[target], layers[idx]];
      return { ...t, layers };
    });
    isDirty.current = true;
  }

  // ── Derived ──────────────────────────────────────────────────────────────

  const selectedLayer = template.layers?.find(l => l.id === selectedLayerId) || null;

  // ── Guard ────────────────────────────────────────────────────────────────

  if (!serverUrl || !apiKey) {
    return (
      <div style={{ background: '#111', color: '#fff', width: '100vw', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'sans-serif', fontSize: 16 }}>
        Missing <code>?server=</code> and <code>?apikey=</code> URL parameters.
      </div>
    );
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', height: '100vh', background: '#111', color: '#ddd', fontFamily: 'sans-serif', overflow: 'hidden' }}>

      {/* Left panel — template list */}
      <div style={{ width: 220, borderRight: '1px solid #333', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
        <div style={{ padding: '10px 12px', borderBottom: '1px solid #333', fontWeight: 'bold', fontSize: 14, color: '#bbb' }}>
          Templates
        </div>

        {/* Preset buttons */}
        <div style={{ padding: '8px 10px', borderBottom: '1px solid #333', display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontSize: 11, color: '#666', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 2 }}>New from preset</div>
          {Object.keys(PRESETS).map(name => (
            <button key={name} onClick={() => newFromPreset(name)} style={{ ...btnStyle, textAlign: 'left', fontSize: 12 }}>
              {name}
            </button>
          ))}
          <button onClick={newBlank} style={{ ...btnStyle, textAlign: 'left', fontSize: 12 }}>
            Blank
          </button>
        </div>

        {/* Template list */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {templates.length === 0 && (
            <div style={{ padding: 12, color: '#555', fontSize: 13 }}>No templates yet.</div>
          )}
          {templates.map(t => (
            <div
              key={t.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: '8px 10px',
                cursor: 'pointer',
                background: t.id === selectedId ? '#1e3a5f' : 'transparent',
                borderBottom: '1px solid #222',
              }}
              onClick={() => loadTemplate(t.id)}
            >
              <span style={{ flex: 1, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span>
              <button
                onClick={e => { e.stopPropagation(); deleteTemplate(t.id, t.name); }}
                title="Delete"
                style={{ ...btnDangerStyle, padding: '2px 6px', fontSize: 11, marginLeft: 4 }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Main area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Toolbar */}
        <div style={{ padding: '8px 12px', borderBottom: '1px solid #333', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <input
            type="text"
            value={templateName}
            onChange={e => { setTemplateName(e.target.value); isDirty.current = true; }}
            placeholder="Template name"
            style={{ ...inputStyle, width: 220 }}
          />

          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: 12, color: '#888' }}>Background:</span>
            <input
              type="color"
              value={template.background && template.background !== 'transparent' ? template.background.slice(0, 7) : '#000000'}
              onChange={e => { setTemplate(t => ({ ...t, background: e.target.value })); isDirty.current = true; }}
              style={{ width: 32, height: 24, padding: 0, border: 'none', cursor: 'pointer' }}
            />
            <input
              type="text"
              value={template.background || 'transparent'}
              onChange={e => { setTemplate(t => ({ ...t, background: e.target.value })); isDirty.current = true; }}
              style={{ ...inputStyle, width: 120 }}
            />
          </div>

          <span style={{ flex: 1 }} />
          {status && <span style={{ fontSize: 12, color: status.startsWith('Error') ? '#f88' : '#8d8' }}>{status}</span>}
          <button onClick={saveTemplate} disabled={loading} style={btnPrimaryStyle}>
            {loading ? 'Saving…' : 'Save'}
          </button>
        </div>

        {/* Content area */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

          {/* Preview + layers panel */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 12, gap: 10, overflow: 'auto' }}>

            {/* Preview */}
            <TemplatePreview
              template={template}
              selectedLayerId={selectedLayerId}
              onSelectLayer={id => setSelectedLayerId(id === selectedLayerId ? null : id)}
            />

            {/* Layer list */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 13, color: '#bbb', fontWeight: 'bold' }}>Layers</span>
                <span style={{ flex: 1 }} />
                <button onClick={() => addLayer('rect')} style={{ ...btnStyle, fontSize: 12 }}>+ Rect</button>
                <button onClick={() => addLayer('text')} style={{ ...btnStyle, fontSize: 12 }}>+ Text</button>
              </div>

              {(template.layers || []).length === 0 && (
                <div style={{ color: '#555', fontSize: 13 }}>No layers. Add a rect or text layer above.</div>
              )}

              {[...(template.layers || [])].reverse().map((layer, revIdx) => {
                const realIdx = (template.layers.length - 1) - revIdx;
                const isSelected = layer.id === selectedLayerId;
                return (
                  <div
                    key={layer.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      padding: '4px 8px',
                      marginBottom: 2,
                      background: isSelected ? '#1e3a5f' : '#1a1a1a',
                      borderRadius: 3,
                      cursor: 'pointer',
                      border: isSelected ? '1px solid #4488dd' : '1px solid transparent',
                    }}
                    onClick={() => setSelectedLayerId(isSelected ? null : layer.id)}
                  >
                    <span style={{ fontSize: 11, color: '#666', width: 40, flexShrink: 0 }}>{layer.type}</span>
                    <span style={{ flex: 1, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {layer.id}
                      {layer.type === 'text' && layer.text ? <span style={{ color: '#777', marginLeft: 8 }}>"{layer.text}"</span> : null}
                    </span>
                    <button onClick={e => { e.stopPropagation(); moveLayer(layer.id, -1); }} title="Move up (higher z-index)" style={{ ...btnStyle, padding: '1px 5px', fontSize: 11 }}>↑</button>
                    <button onClick={e => { e.stopPropagation(); moveLayer(layer.id, 1); }} title="Move down (lower z-index)" style={{ ...btnStyle, padding: '1px 5px', fontSize: 11 }}>↓</button>
                    <button onClick={e => { e.stopPropagation(); deleteLayer(layer.id); }} title="Delete layer" style={{ ...btnDangerStyle, padding: '1px 5px', fontSize: 11, marginLeft: 4 }}>✕</button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Properties panel */}
          <div style={{ width: 280, borderLeft: '1px solid #333', padding: 12, overflowY: 'auto', flexShrink: 0 }}>
            <div style={{ fontSize: 13, color: '#bbb', fontWeight: 'bold', marginBottom: 10 }}>Properties</div>
            <LayerPropertyEditor
              layer={selectedLayer}
              onChange={updateLayer}
            />
          </div>

        </div>
      </div>
    </div>
  );
}
