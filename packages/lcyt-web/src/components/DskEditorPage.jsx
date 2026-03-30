import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { SessionContext } from '../contexts/SessionContext';
import { useToastContext } from '../contexts/ToastContext';
import { templateSlug } from '../lib/formatting.js';
import { ImageSettingsTable } from './DskViewportsPage';

/**
 * DSK Graphics Template Editor
 *
 * URL: /dsk-editor?server=<backendUrl>&apikey=<key>
 *
 * Phase 1: template CRUD, layer property editor.
 * Phase 2: drag-to-move, 8-point resize handles, keyboard nudge.
 * Phase 3: undo/redo, multi-selection, snap to grid, snap to layer edges,
 *           ellipse shape type, shape grouping (group/ungroup).
 * Phase 4: Media Library — image upload, browse, insert, delete (PNG/JPEG/WebP/SVG).
 * Phase 5: Animations — preset picker, per-layer CSS animation shorthand, live preview.
 */

// ── Constants ─────────────────────────────────────────────────────────────────

const SCALE         = 0.5;   // preview is 50% of 1920×1080
const GRID_SIZE     = 20;    // template px; used by snap-to-grid
const SNAP_THRESH   = 10;    // template px; used by snap-to-layer-edges
const MAX_HISTORY   = 50;

// ── Resize handles ────────────────────────────────────────────────────────────

const HANDLE_LIST = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const HANDLE_CURSORS = {
  nw: 'nw-resize', n: 'n-resize',  ne: 'ne-resize',
  e:  'e-resize',  se: 'se-resize', s:  's-resize',
  sw: 'sw-resize', w:  'w-resize',
};

import { handleAnchor, applyResize, gridSnap, snapToLayerEdges, getLayerViewportPos } from '../lib/dskEditorGeometry.js';
import TemplatePreview from './dsk-editor/TemplatePreview.jsx';
import LayerPropertyEditor from './dsk-editor/LayerPropertyEditor.jsx';
import AnimationEditor from './dsk-editor/AnimationEditor.jsx';


// ── Preset templates ──────────────────────────────────────────────────────────

import { PRESETS } from '../lib/dskEditorPresets.js';

const EMPTY_TEMPLATE = {
  background: 'transparent',
  width: 1920,
  height: 1080,
  groups: [],
  layers: [],
};

// ── Animation support ─────────────────────────────────────────────────────────

// Inject LCYT keyframes into the browser document once (for the live preview).
const LCYT_KEYFRAMES_CSS = `
@keyframes lcyt-fadeIn       { from { opacity: 0 } to { opacity: 1 } }
@keyframes lcyt-fadeOut      { from { opacity: 1 } to { opacity: 0 } }
@keyframes lcyt-slideInLeft  { from { transform: translateX(-100%) } to { transform: translateX(0) } }
@keyframes lcyt-slideInRight { from { transform: translateX(100%)  } to { transform: translateX(0) } }
@keyframes lcyt-slideInUp    { from { transform: translateY(100%)  } to { transform: translateY(0) } }
@keyframes lcyt-slideInDown  { from { transform: translateY(-100%) } to { transform: translateY(0) } }
@keyframes lcyt-slideOutLeft  { from { transform: translateX(0) } to { transform: translateX(-100%) } }
@keyframes lcyt-slideOutRight { from { transform: translateX(0) } to { transform: translateX(100%)  } }
@keyframes lcyt-zoomIn  { from { transform: scale(0); opacity: 0 } to { transform: scale(1); opacity: 1 } }
@keyframes lcyt-zoomOut { from { transform: scale(1); opacity: 1 } to { transform: scale(0); opacity: 0 } }
@keyframes lcyt-pulse   { 0%, 100% { transform: scale(1) } 50% { transform: scale(1.05) } }
@keyframes lcyt-blink   { 0%, 100% { opacity: 1 } 50% { opacity: 0 } }
@keyframes lcyt-typewriter { from { clip-path: inset(0 100% 0 0) } to { clip-path: inset(0 0% 0 0) } }
`;

if (typeof document !== 'undefined' && !document.getElementById('lcyt-anim-keyframes')) {
  const s = document.createElement('style');
  s.id = 'lcyt-anim-keyframes';
  s.textContent = LCYT_KEYFRAMES_CSS;
  document.head.appendChild(s);
}

const ANIM_PRESETS = [
  { value: '',                   label: 'None' },
  { value: 'lcyt-fadeIn',        label: 'Fade In' },
  { value: 'lcyt-fadeOut',       label: 'Fade Out' },
  { value: 'lcyt-slideInLeft',   label: 'Slide In ←' },
  { value: 'lcyt-slideInRight',  label: 'Slide In →' },
  { value: 'lcyt-slideInUp',     label: 'Slide In ↑' },
  { value: 'lcyt-slideInDown',   label: 'Slide In ↓' },
  { value: 'lcyt-slideOutLeft',  label: 'Slide Out ←' },
  { value: 'lcyt-slideOutRight', label: 'Slide Out →' },
  { value: 'lcyt-zoomIn',        label: 'Zoom In' },
  { value: 'lcyt-zoomOut',       label: 'Zoom Out' },
  { value: 'lcyt-pulse',         label: 'Pulse' },
  { value: 'lcyt-blink',         label: 'Blink' },
  { value: 'lcyt-typewriter',    label: 'Typewriter' },
];


// ── Layer property editor ─────────────────────────────────────────────────────

const COMMON_FIELDS = [
  { key: 'x', label: 'X', type: 'number' },
  { key: 'y', label: 'Y', type: 'number' },
  { key: 'width',  label: 'Width',  type: 'number' },
  { key: 'height', label: 'Height', type: 'number' },
];

const STYLE_FIELDS_RECT = [
  { key: 'background',   label: 'Background',   type: 'color-text' },
  { key: 'border-radius',label: 'Border radius',type: 'text', placeholder: '8px' },
];

const STYLE_FIELDS_ELLIPSE = [
  { key: 'background', label: 'Background', type: 'color-text' },
];

const STYLE_FIELDS_TEXT = [
  { key: 'font-family',  label: 'Font family',   type: 'text',   placeholder: 'Arial, sans-serif' },
  { key: 'font-size',    label: 'Font size',      type: 'text',   placeholder: '48px' },
  { key: 'font-weight',  label: 'Font weight',    type: 'select', options: ['normal', 'bold', '100', '200', '300', '400', '500', '600', '700', '800', '900'] },
  { key: 'font-style',   label: 'Italic',         type: 'select', options: ['normal', 'italic'] },
  { key: 'color',        label: 'Color',          type: 'color-text' },
  { key: 'letter-spacing', label: 'Letter spacing', type: 'text', placeholder: '2px' },
  { key: 'text-align',   label: 'Text align',     type: 'select', options: ['left', 'center', 'right'] },
  { key: 'white-space',  label: 'White space',    type: 'select', options: ['normal', 'nowrap', 'pre'] },
  { key: 'text-shadow',       label: 'Text shadow',  type: 'text', placeholder: '1px 1px 4px #000' },
  { key: '-webkit-text-stroke', label: 'Text stroke', type: 'text', placeholder: '1px #000' },
];

// Shared for all layer types
const STYLE_FIELDS_BORDER = [
  { key: 'border',     label: 'Border',  type: 'text', placeholder: '2px solid #fff' },
  { key: 'box-shadow', label: 'Shadow',  type: 'text', placeholder: '0 2px 8px rgba(0,0,0,0.5)' },
];

// ── Styles ────────────────────────────────────────────────────────────────────

const inputStyle = {
  background: '#1e1e1e', border: '1px solid #444', color: '#eee',
  borderRadius: 3, padding: '3px 6px', fontSize: 13,
  flex: 1, minWidth: 0, boxSizing: 'border-box',
};
const fieldRowStyle    = { display: 'flex', alignItems: 'center', gap: 8 };
const labelStyle       = { color: '#999', fontSize: 12, width: 90, flexShrink: 0, textAlign: 'right' };
const sectionLabelStyle = {
  borderTop: '1px solid #333', paddingTop: 6, marginTop: 2,
  color: '#777', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1,
};
const btnStyle = {
  background: '#2a2a2a', border: '1px solid #555', color: '#ddd',
  borderRadius: 4, padding: '4px 10px', fontSize: 13, cursor: 'pointer',
};
const btnPrimaryStyle = { ...btnStyle, background: '#2255aa', border: '1px solid #4488dd', color: '#fff' };
const btnDangerStyle  = { ...btnStyle, background: '#550000', border: '1px solid #882222', color: '#ffaaaa' };
const btnActiveStyle  = { ...btnStyle, background: '#1a3a1a', border: '1px solid #44aa44', color: '#88ee88' };

// ── Counters ──────────────────────────────────────────────────────────────────

let _layerCounter = 0, _groupCounter = 0;
function newLayerId(type) { _layerCounter += 1; return `${type}-${_layerCounter}`; }
function newGroupId()     { _groupCounter += 1; return `grp-${_groupCounter}`; }

// ── Main component ────────────────────────────────────────────────────────────

export function DskEditorPage() {
  const session   = useContext(SessionContext);
  const params    = new URLSearchParams(window.location.search);
  const apiKey    = session?.apiKey || params.get('apikey') || '';
  const serverUrl = (session?.backendUrl || params.get('server') || '').replace(/\/$/, '');

  const [templates, setTemplates]     = useState([]);
  const [selectedId, setSelectedId]   = useState(null);   // backend template id
  const [templateName, setTemplateName] = useState('');
  const [template, setTemplate]       = useState(EMPTY_TEMPLATE);
  const [viewportsList, setViewportsList] = useState([]);
  const [selectedViewport, setSelectedViewport] = useState('landscape');
  const [selectedIds, setSelectedIds] = useState(new Set()); // canvas multi-selection
  const [primaryId, setPrimaryId]     = useState(null);    // property-panel target
  const [snapGrid, setSnapGrid]       = useState(false);
  const [showSafeArea, setShowSafeArea] = useState(false);
  const [aspectLock, setAspectLock]   = useState(true);
  const [status, setStatus]           = useState('');
  const [loading, setLoading]         = useState(false);

  // Media Library state
  const [images, setImages]               = useState([]);
  const [imgPending, setImgPending]       = useState(null);   // File awaiting shorthand
  const [shorthandInput, setShorthandInput] = useState('');
  const [imgLibOpen, setImgLibOpen]       = useState(true);
  const { showToast } = useToastContext();
  const [imgUploading, setImgUploading]   = useState(false);
  const [imgUploadErr, setImgUploadErr]   = useState('');

  const isDirty      = useRef(false);
  const imgInputRef  = useRef(null);
  const clipboardRef = useRef(null);
  const selectedIdsRef = useRef(selectedIds);
  useEffect(() => { selectedIdsRef.current = selectedIds; }, [selectedIds]);
  const historyRef = useRef({ past: [], future: [] });
  const templateRef = useRef(template); // mirror for use inside event listeners
  const lastClickedIdRef = useRef(null); // anchor for shift-range layer selection
  useEffect(() => { templateRef.current = template; }, [template]);

  // ── Undo / redo ─────────────────────────────────────────────────────────

  function pushHistory(tmpl) {
    historyRef.current.past.push(JSON.stringify(tmpl));
    historyRef.current.future = [];
    if (historyRef.current.past.length > MAX_HISTORY) historyRef.current.past.shift();
  }

  // Global keyboard handler — attached once so it always has the latest template
  useEffect(() => {
    function onGlobalKey(e) {
      const mod = e.ctrlKey || e.metaKey;
      // Delete / Backspace — remove selected layers (only when no text input is focused)
      if (!mod && (e.key === 'Delete' || e.key === 'Backspace')) {
        const tag = document.activeElement?.tagName?.toLowerCase();
        if (tag === 'input' || tag === 'textarea' || document.activeElement?.isContentEditable) return;
        const ids = selectedIdsRef.current;
        if (!ids.size) return;
        e.preventDefault();
        historyRef.current.past.push(JSON.stringify(templateRef.current));
        historyRef.current.future = [];
        if (historyRef.current.past.length > MAX_HISTORY) historyRef.current.past.shift();
        setTemplate(t => ({ ...t, layers: t.layers.filter(l => !ids.has(l.id)) }));
        setSelectedIds(new Set());
        setPrimaryId(null);
        isDirty.current = true;
        return;
      }
      if (!mod) return;
      if (e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        const { past, future } = historyRef.current;
        if (!past.length) return;
        future.push(JSON.stringify(templateRef.current));
        setTemplate(JSON.parse(past.pop()));
        isDirty.current = true;
      }
      if (e.key === 'y' || (e.key === 'z' && e.shiftKey)) {
        e.preventDefault();
        const { past, future } = historyRef.current;
        if (!future.length) return;
        past.push(JSON.stringify(templateRef.current));
        setTemplate(JSON.parse(future.pop()));
        isDirty.current = true;
      }
      if (e.key === 'c') {
        const ids = selectedIdsRef.current;
        if (!ids.size) return;
        clipboardRef.current = templateRef.current.layers
          .filter(l => ids.has(l.id))
          .map(l => JSON.parse(JSON.stringify(l)));
      }
      if (e.key === 'v') {
        e.preventDefault();
        if (!clipboardRef.current?.length) return;
        const tmpl = templateRef.current;
        const pasted = clipboardRef.current.map(l => ({
          ...l, id: newLayerId(l.type), x: (l.x || 0) + 20, y: (l.y || 0) + 20,
        }));
        historyRef.current.past.push(JSON.stringify(tmpl));
        historyRef.current.future = [];
        setTemplate(t => ({ ...t, layers: [...t.layers, ...pasted] }));
        setSelectedIds(new Set(pasted.map(l => l.id)));
        setPrimaryId(pasted[pasted.length - 1].id);
        isDirty.current = true;
      }
    }
    window.addEventListener('keydown', onGlobalKey);
    return () => window.removeEventListener('keydown', onGlobalKey);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const canUndo = historyRef.current.past.length > 0;
  const canRedo = historyRef.current.future.length > 0;

  function undo() {
    const { past, future } = historyRef.current;
    if (!past.length) return;
    future.push(JSON.stringify(templateRef.current));
    setTemplate(JSON.parse(past.pop()));
    isDirty.current = true;
  }
  function redo() {
    const { past, future } = historyRef.current;
    if (!future.length) return;
    past.push(JSON.stringify(templateRef.current));
    setTemplate(JSON.parse(future.pop()));
    isDirty.current = true;
  }

  // ── API ──────────────────────────────────────────────────────────────────

  function apiFetch(path, opts = {}) {
    return fetch(`${serverUrl}${path}`, {
      ...opts,
      headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey, ...(opts.headers || {}) },
    });
  }

  const fetchTemplates = useCallback(async () => {
    if (!serverUrl || !apiKey) return;
    try {
      const res = await apiFetch(`/dsk/${encodeURIComponent(apiKey)}/templates`);
      if (!res.ok) throw new Error(await res.text());
      setTemplates((await res.json()).templates || []);
    } catch (err) { setStatus(`Error loading templates: ${err.message}`); }
  }, [serverUrl, apiKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchTemplates(); }, [fetchTemplates]);

  const loadImages = useCallback(async () => {
    if (!serverUrl || !apiKey) return;
    try {
      const res = await fetch(`${serverUrl}/dsk/${encodeURIComponent(apiKey)}/images`);
      const data = await res.json();
      setImages(data.images || []);
    } catch {}
  }, [serverUrl, apiKey]);

  useEffect(() => { loadImages(); }, [loadImages]);

  // Image viewport settings helpers (re-used from Viewports page)
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
      if (!res.ok) { setStatus('Save failed'); return; }
      setImages(imgs => imgs.map(i => i.id === img.id ? { ...i, settingsJson: merged } : i));
    } catch { setStatus('Network error'); }
  }

  // Load available viewports (public list) for this key
  useEffect(() => {
    async function loadVps() {
      if (!serverUrl || !apiKey) return;
      try {
        const res = await fetch(`${serverUrl}/dsk/${encodeURIComponent(apiKey)}/viewports/public`);
        if (!res.ok) return;
        const data = await res.json();
        setViewportsList(data.viewports || []);
      } catch {}
    }
    loadVps();
  }, [serverUrl, apiKey]);

  // ── Template lifecycle ───────────────────────────────────────────────────

  async function loadTemplate(id) {
    try {
      const res = await apiFetch(`/dsk/${encodeURIComponent(apiKey)}/templates/${id}`);
      if (!res.ok) throw new Error(await res.text());
      const { template: row } = await res.json();
      setSelectedId(row.id);
      setTemplateName(row.name);
      setTemplate(row.templateJson || EMPTY_TEMPLATE);
      clearSelection();
      historyRef.current = { past: [], future: [] };
      isDirty.current = false;
      setStatus('');
    } catch (err) { setStatus(`Error loading template: ${err.message}`); }
  }

  function newFromPreset(presetName) {
    setSelectedId(null);
    setTemplateName(presetName);
    setTemplate(JSON.parse(JSON.stringify(PRESETS[presetName])));
    clearSelection();
    historyRef.current = { past: [], future: [] };
    isDirty.current = true;
    setStatus('');
  }

  function newBlank() {
    setSelectedId(null);
    setTemplateName('New Template');
    setTemplate(JSON.parse(JSON.stringify(EMPTY_TEMPLATE)));
    clearSelection();
    historyRef.current = { past: [], future: [] };
    isDirty.current = true;
    setStatus('');
  }

  async function saveTemplate() {
    if (!templateName.trim()) { setStatus('Template name is required'); return; }
    setLoading(true); setStatus('Saving…');
    try {
      let res;
      if (selectedId) {
        res = await apiFetch(`/dsk/${encodeURIComponent(apiKey)}/templates/${selectedId}`, {
          method: 'PUT', body: JSON.stringify({ name: templateName.trim(), template }),
        });
      } else {
        res = await apiFetch(`/dsk/${encodeURIComponent(apiKey)}/templates`, {
          method: 'POST', body: JSON.stringify({ name: templateName.trim(), template }),
        });
      }
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      if (!selectedId) setSelectedId(data.id);
      // If server renamed any element ids, apply them locally and notify the user
      if (data.renames && typeof data.renames === 'object') {
        const renameMap = data.renames;
        // Apply renames to template layers ids and groupIds
        function applyRenamesToObj(obj) {
          if (!obj || typeof obj !== 'object') return;
          for (const [k, v] of Object.entries(obj)) {
            if (k === 'id' && typeof v === 'string' && renameMap[v]) obj[k] = renameMap[v];
            else if (k === 'groupId' && typeof v === 'string' && renameMap[v]) obj[k] = renameMap[v];
            else applyRenamesToObj(v);
          }
        }
        const updated = JSON.parse(JSON.stringify(template));
        applyRenamesToObj(updated);
        setTemplate(updated);
        // Update selection state
        setSelectedIds(prev => {
          const next = new Set();
          for (const id of prev) next.add(renameMap[id] || id);
          return next;
        });
        setPrimaryId(prev => (prev ? (renameMap[prev] || prev) : prev));
        const msg = `Saved. Renamed IDs: ${Object.entries(renameMap).map(([a,b])=>`${a}→${b}`).join(', ')}`;
        setStatus(msg);
        try { showToast(msg, 'info', 7000); } catch (e) { /* noop if toast not available */ }
      } else {
        isDirty.current = false; setStatus('Saved.');
      }
      await fetchTemplates();
    } catch (err) { setStatus(`Save error: ${err.message}`);
    } finally { setLoading(false); }
  }

  async function duplicateTemplate() {
    if (!templateName.trim()) { setStatus('Template name is required'); return; }
    const newName = window.prompt('Name for duplicate:', `${templateName.trim()} copy`);
    if (!newName || !newName.trim()) return;
    setLoading(true); setStatus('Saving duplicate…');
    try {
      const res = await apiFetch(`/dsk/${encodeURIComponent(apiKey)}/templates`, {
        method: 'POST', body: JSON.stringify({ name: newName.trim(), template }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setSelectedId(data.id);
      setTemplateName(newName.trim());
      // Apply renames if provided
      if (data.renames && typeof data.renames === 'object') {
        const renameMap = data.renames;
        const updated = JSON.parse(JSON.stringify(template));
        function applyRenamesToObj(obj) {
          if (!obj || typeof obj !== 'object') return;
          for (const [k, v] of Object.entries(obj)) {
            if (k === 'id' && typeof v === 'string' && renameMap[v]) obj[k] = renameMap[v];
            else if (k === 'groupId' && typeof v === 'string' && renameMap[v]) obj[k] = renameMap[v];
            else applyRenamesToObj(v);
          }
        }
        applyRenamesToObj(updated);
        setTemplate(updated);
        const dmsg = `Duplicate saved. Renamed IDs: ${Object.entries(renameMap).map(([a,b])=>`${a}→${b}`).join(', ')}`;
        setStatus(dmsg);
        try { showToast(dmsg, 'info', 7000); } catch (e) { /* noop */ }
      } else {
        isDirty.current = false; setStatus('Duplicate saved.');
      }
      await fetchTemplates();
    } catch (err) { setStatus(`Save error: ${err.message}`);
    } finally { setLoading(false); }
  }

  async function deleteTemplateById(id, name) {
    if (!window.confirm(`Delete template "${name}"?`)) return;
    try {
      const res = await apiFetch(`/dsk/${encodeURIComponent(apiKey)}/templates/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(await res.text());
      if (selectedId === id) { setSelectedId(null); setTemplateName(''); setTemplate(EMPTY_TEMPLATE); clearSelection(); }
      await fetchTemplates(); setStatus('Deleted.');
    } catch (err) { setStatus(`Delete error: ${err.message}`); }
  }

  // ── Selection ────────────────────────────────────────────────────────────

  function clearSelection() {
    setSelectedIds(new Set());
    setPrimaryId(null);
  }

  /** Called by TemplatePreview on click. id=null = deselect all. */
  function handleCanvasSelect(id, additive) {
    if (!id) { clearSelection(); return; }
    const layer = template.layers.find(l => l.id === id);
    const groupMemberIds = layer?.groupId
      ? template.layers.filter(l => l.groupId === layer.groupId).map(l => l.id)
      : [id];

    if (additive) {
      setSelectedIds(prev => {
        const next = new Set(prev);
        const allIn = groupMemberIds.every(mid => next.has(mid));
        if (allIn) groupMemberIds.forEach(mid => next.delete(mid));
        else       groupMemberIds.forEach(mid => next.add(mid));
        return next;
      });
    } else {
      setSelectedIds(new Set(groupMemberIds));
    }
    setPrimaryId(id);
  }

  function selectLayerFromList(id, { ctrlKey = false, shiftKey = false, metaKey = false } = {}) {
    function resolveIds(layerId) {
      const l = template.layers.find(x => x.id === layerId);
      return l?.groupId
        ? template.layers.filter(x => x.groupId === l.groupId).map(x => x.id)
        : [layerId];
    }

    if (shiftKey && lastClickedIdRef.current) {
      // Range select: pick all layers between anchor and clicked (in display order)
      const displayOrder = [...(template.layers || [])].reverse().map(l => l.id);
      const a = displayOrder.indexOf(lastClickedIdRef.current);
      const b = displayOrder.indexOf(id);
      const [lo, hi] = a <= b ? [a, b] : [b, a];
      const rangeIds = displayOrder.slice(lo, hi + 1);
      const expanded = new Set(rangeIds.flatMap(resolveIds));
      setSelectedIds(expanded);
      setPrimaryId(id);
      // anchor stays fixed; don't update lastClickedIdRef
    } else if (ctrlKey || metaKey) {
      // Toggle: add or remove clicked layer (and its group) from selection
      const ids = resolveIds(id);
      const alreadySelected = ids.every(x => selectedIds.has(x));
      const next = new Set(selectedIds);
      if (alreadySelected) {
        ids.forEach(x => next.delete(x));
      } else {
        ids.forEach(x => next.add(x));
      }
      setSelectedIds(next);
      setPrimaryId(alreadySelected ? ([...next][0] ?? null) : id);
      lastClickedIdRef.current = id;
    } else {
      // Normal click: replace selection
      const ids = resolveIds(id);
      setSelectedIds(new Set(ids));
      setPrimaryId(id);
      lastClickedIdRef.current = id;
    }
  }

  // ── Layer mutations ──────────────────────────────────────────────────────

  function addLayer(type) {
    pushHistory(template);
    const id = newLayerId(type);
    const defaults = {
      rect:    { id, type: 'rect',    x: 100, y: 100, width: 400, height: 100, style: { background: '#333333', opacity: '0.9' } },
      ellipse: { id, type: 'ellipse', x: 200, y: 200, width: 200, height: 200, style: { background: '#336699' } },
      text:    { id, type: 'text',    x: 100, y: 100, text: 'Text', style: { 'font-size': '48px', 'font-family': 'Arial, sans-serif', color: '#ffffff' } },
      image:   { id, type: 'image',   x: 0,   y: 0,   width: 400, height: 300, src: '' },
    };
    const newLayer = defaults[type] || defaults.rect;
    setTemplate(t => ({ ...t, layers: [...(t.layers || []), newLayer] }));
    setSelectedIds(new Set([id]));
    setPrimaryId(id);
    isDirty.current = true;
  }

  function updateLayer(updated, prevId) {
    const searchId = prevId ?? updated.id;
    pushHistory(template);
    setTemplate(t => ({ ...t, layers: t.layers.map(l => l.id === searchId ? updated : l) }));
    // If the ID was changed, update selection state to use the new ID
    if (prevId && prevId !== updated.id) {
      setSelectedIds(prev => {
        const next = new Set(prev);
        if (next.has(prevId)) { next.delete(prevId); next.add(updated.id); }
        return next;
      });
      if (primaryId === prevId) setPrimaryId(updated.id);
    }
    isDirty.current = true;
  }

  function deleteLayer(id) {
    pushHistory(template);
    setTemplate(t => ({ ...t, layers: t.layers.filter(l => l.id !== id) }));
    if (primaryId === id) clearSelection();
    isDirty.current = true;
  }

  function reorderLayer(id, dir) {
    pushHistory(template);
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

  function toggleLayerVisibility(id) {
    const layer = template.layers.find(l => l.id === id);
    if (!layer) return;
    updateLayer({ ...layer, visible: layer.visible === false ? undefined : false });
  }

  function duplicateLayer(id) {
    pushHistory(template);
    const src = template.layers.find(l => l.id === id);
    if (!src) return;
    const newId = newLayerId(src.type);
    const copy = { ...JSON.parse(JSON.stringify(src)), id: newId, x: (src.x || 0) + 20, y: (src.y || 0) + 20 };
    setTemplate(t => ({ ...t, layers: [...t.layers, copy] }));
    setSelectedIds(new Set([newId]));
    setPrimaryId(newId);
    isDirty.current = true;
  }

  function alignLayers(axis, anchor) {
    if (selectedIds.size < 1) return;
    pushHistory(template);
    const sel = template.layers.filter(l => selectedIds.has(l.id));
    const minX = Math.min(...sel.map(l => l.x || 0));
    const maxX = Math.max(...sel.map(l => (l.x || 0) + (l.width || 0)));
    const minY = Math.min(...sel.map(l => l.y || 0));
    const maxY = Math.max(...sel.map(l => (l.y || 0) + (l.height || 0)));
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    setTemplate(t => ({
      ...t,
      layers: t.layers.map(l => {
        if (!selectedIds.has(l.id)) return l;
        const w = l.width || 0, h = l.height || 0;
        if (axis === 'x') {
          const nx = anchor === 'min' ? minX : anchor === 'center' ? cx - w / 2 : maxX - w;
          return { ...l, x: Math.round(nx) };
        } else {
          const ny = anchor === 'min' ? minY : anchor === 'center' ? cy - h / 2 : maxY - h;
          return { ...l, y: Math.round(ny) };
        }
      }),
    }));
    isDirty.current = true;
  }

  // ── Phase 2 direct-manipulation callbacks ────────────────────────────────

  /** Called by TemplatePreview when a drag begins (push undo before first move). */
  function handleDragStart() {
    pushHistory(template);
  }

  /** Called continuously during drag with updated positions for all moving layers. */
  function handleMoveSelected(updates) {
    setTemplate(t => ({
      ...t,
      layers: t.layers.map(l => {
        const upd = updates.find(u => u.id === l.id);
        if (!upd) return l;
        if (selectedViewport && selectedViewport !== 'landscape') {
          const existingVp = (l.viewports && l.viewports[selectedViewport]) || {};
          const curW = existingVp.width != null ? existingVp.width : (l.width != null ? l.width : undefined);
          const curH = existingVp.height != null ? existingVp.height : (l.height != null ? l.height : undefined);
          const vp = { ...(l.viewports || {}) };
          vp[selectedViewport] = { x: upd.x, y: upd.y, width: curW, height: curH };
          return { ...l, viewports: vp };
        }
        return { ...l, x: upd.x, y: upd.y };
      }),
    }));
    isDirty.current = true;
  }

  function handleResizeLayer(id, rect) {
    let final = rect;
    if (aspectLock && primaryLayer?.type === 'image' && primaryLayer.id === id) {
      const orig = primaryLayer;
      const ratio = (orig.width || 1) / (orig.height || 1);
      if (rect.width !== (orig.width || 0)) {
        final = { ...rect, height: Math.max(4, Math.round(rect.width / ratio)) };
      } else {
        final = { ...rect, width: Math.max(4, Math.round(rect.height * ratio)) };
      }
    }
    setTemplate(t => ({
      ...t,
      layers: t.layers.map(l => {
        if (l.id !== id) return l;
        if (selectedViewport && selectedViewport !== 'landscape') {
          const vp = { ...(l.viewports || {}) };
          vp[selectedViewport] = { x: final.x, y: final.y, width: final.width, height: final.height };
          return { ...l, viewports: vp };
        }
        return { ...l, ...final };
      }),
    }));
    isDirty.current = true;
  }

  // ── Phase 3 group management ─────────────────────────────────────────────

  /** Group all currently selected layers into a new named group. */
  function groupSelected() {
    if (selectedIds.size < 2) return;
    // Don't group if they already all belong to the same group
    const existingGroupIds = new Set(
      template.layers.filter(l => selectedIds.has(l.id) && l.groupId).map(l => l.groupId),
    );
    if (existingGroupIds.size === 1 &&
        template.layers.filter(l => l.groupId === [...existingGroupIds][0]).every(l => selectedIds.has(l.id))) {
      return; // already one coherent group
    }
    pushHistory(template);
    const gid  = newGroupId();
    const name = `Group ${_groupCounter}`;
    setTemplate(t => ({
      ...t,
      groups: [...(t.groups || []), { id: gid, name }],
      layers: t.layers.map(l => selectedIds.has(l.id) ? { ...l, groupId: gid } : l),
    }));
    isDirty.current = true;
  }

  /** Remove group membership from all selected layers. */
  function ungroupSelected() {
    const groupIds = new Set(
      template.layers.filter(l => selectedIds.has(l.id) && l.groupId).map(l => l.groupId),
    );
    if (!groupIds.size) return;
    pushHistory(template);
    setTemplate(t => ({
      ...t,
      groups: (t.groups || []).filter(g => !groupIds.has(g.id)),
      layers: t.layers.map(l => {
        if (!groupIds.has(l.groupId)) return l;
        const { groupId: _gid, ...rest } = l;
        return rest;
      }),
    }));
    clearSelection();
    isDirty.current = true;
  }

  // ── Media Library ────────────────────────────────────────────────────────

  async function uploadImage(file, shorthand) {
    setImgUploading(true); setImgUploadErr('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('shorthand', shorthand);
      const res = await fetch(`${serverUrl}/images`, {
        method: 'POST',
        headers: { 'X-API-Key': apiKey },
        body: fd,
      });
      if (!res.ok) { const txt = await res.text(); throw new Error(txt); }
      setImgPending(null); setShorthandInput('');
      await loadImages();
    } catch (err) { setImgUploadErr(err.message); }
    finally { setImgUploading(false); }
  }

  async function deleteImageById(id) {
    try {
      await fetch(`${serverUrl}/images/${id}`, {
        method: 'DELETE',
        headers: { 'X-API-Key': apiKey },
      });
      await loadImages();
    } catch {}
  }

  function handleFileInputChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const base = file.name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 32);
    setShorthandInput(base || 'image');
    setImgPending(file);
    e.target.value = '';
  }

  function useImageFromLibrary(img) {
    const url = `${serverUrl}/images/${img.id}`;
    if (primaryLayer?.type === 'image') {
      updateLayer({ ...primaryLayer, src: url });
    } else {
      pushHistory(template);
      const id = newLayerId('image');
      const newLayer = { id, type: 'image', x: 0, y: 0, width: 400, height: 300, src: url };
      setTemplate(t => ({ ...t, layers: [...(t.layers || []), newLayer] }));
      setSelectedIds(new Set([id]));
      setPrimaryId(id);
      isDirty.current = true;
    }
  }

  // ── Derived ──────────────────────────────────────────────────────────────

  const primaryLayer    = template.layers?.find(l => l.id === primaryId) || null;
  const canGroup        = selectedIds.size >= 2;
  const canUngroup      = [...selectedIds].some(id => template.layers.find(l => l.id === id)?.groupId);

  // Group name lookup
  const groupNameById = Object.fromEntries((template.groups || []).map(g => [g.id, g.name]));

  // ── Guard ─────────────────────────────────────────────────────────────────

  if (!serverUrl || !apiKey) {
    return (
      <div style={{ padding: 32, color: 'var(--color-text-muted, #888)', fontFamily: 'sans-serif', fontSize: 16 }}>
        {session
          ? 'Connect to a backend first (click Connect in the top bar).'
          : 'Missing ?server= and ?apikey= URL parameters.'}
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', height: '100vh', background: '#111', color: '#ddd', fontFamily: 'sans-serif', overflow: 'hidden' }}>

      {/* ── Left: template list ── */}
      <div style={{ width: 220, borderRight: '1px solid #333', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
        <div style={{ padding: '10px 12px', borderBottom: '1px solid #333', fontWeight: 'bold', fontSize: 14, color: '#bbb' }}>Templates</div>
        <div style={{ padding: '8px 10px', borderBottom: '1px solid #333', display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontSize: 11, color: '#666', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 2 }}>New from preset</div>
          {Object.keys(PRESETS).map(name => (
            <button key={name} onClick={() => newFromPreset(name)} style={{ ...btnStyle, textAlign: 'left', fontSize: 12 }}>{name}</button>
          ))}
          <button onClick={newBlank} style={{ ...btnStyle, textAlign: 'left', fontSize: 12 }}>Blank</button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {templates.length === 0 && <div style={{ padding: 12, color: '#555', fontSize: 13 }}>No templates yet.</div>}
          {templates.map(t => (
            <div key={t.id} style={{
              display: 'flex', alignItems: 'center', padding: '8px 10px', cursor: 'pointer',
              background: t.id === selectedId ? '#1e3a5f' : 'transparent', borderBottom: '1px solid #222',
            }} onClick={() => loadTemplate(t.id)}>
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
                <div style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</div>
                <div style={{ fontSize: 10, color: '#556', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{templateSlug(t.name)}</div>
              </span>
              <button onClick={e => { e.stopPropagation(); deleteTemplateById(t.id, t.name); }}
                      title="Delete" style={{ ...btnDangerStyle, padding: '2px 6px', fontSize: 11, marginLeft: 4 }}>✕</button>
            </div>
          ))}
        </div>
      </div>

      {/* ── Main area ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Toolbar */}
        <div style={{ padding: '8px 12px', borderBottom: '1px solid #333', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, flexWrap: 'wrap' }}>
          <input type="text" value={templateName}
            onChange={e => { setTemplateName(e.target.value); isDirty.current = true; }}
            placeholder="Template name" style={{ ...inputStyle, width: 160 }} />
          {templateName && (
            <span style={{ fontSize: 11, color: '#556', fontFamily: 'monospace' }}
                  title="Template slug — use in metacodes: &lt;!-- template:slug --&gt;">
              {templateSlug(templateName)}
            </span>
          )}

          {/* Viewport selector: affects preview size */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <select value={selectedViewport} onChange={e => setSelectedViewport(e.target.value)} style={{ ...inputStyle, width: 140 }}>
              {([{ name: 'landscape', label: 'Landscape', width: 1920, height: 1080 }]).concat(viewportsList).map(vp => (
                <option key={vp.name} value={vp.name}>{vp.label || vp.name} — {vp.width}×{vp.height}</option>
              ))}
            </select>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: 12, color: '#888' }}>BG:</span>
            <input type="color"
              value={template.background && template.background !== 'transparent' ? template.background.slice(0, 7) : '#000000'}
              onChange={e => { setTemplate(t => ({ ...t, background: e.target.value })); isDirty.current = true; }}
              style={{ width: 28, height: 22, padding: 0, border: 'none', cursor: 'pointer' }} />
            <input type="text" value={template.background || 'transparent'}
              onChange={e => { setTemplate(t => ({ ...t, background: e.target.value })); isDirty.current = true; }}
              style={{ ...inputStyle, width: 110 }} />
          </div>

          {/* Undo / Redo */}
          <button onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)" style={{ ...btnStyle, opacity: canUndo ? 1 : 0.4 }}>↩</button>
          <button onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Y)" style={{ ...btnStyle, opacity: canRedo ? 1 : 0.4 }}>↪</button>

          {/* Snap to grid */}
          <button onClick={() => setSnapGrid(v => !v)} title="Snap to grid"
                  style={snapGrid ? btnActiveStyle : btnStyle}>
            ⊞ {snapGrid ? 'Grid on' : 'Grid'}
          </button>

          {/* Safe area guides */}
          <button onClick={() => setShowSafeArea(v => !v)} title="Safe area guides"
                  style={showSafeArea ? btnActiveStyle : btnStyle}>
            ⬜ Safe
          </button>

          <span style={{ flex: 1 }} />
          {status && <span style={{ fontSize: 12, color: status.startsWith('Error') || status.startsWith('Save error') ? '#f88' : '#8d8' }}>{status}</span>}
          <button onClick={duplicateTemplate} disabled={loading} style={btnStyle} title="Save as a new copy with a different name">Duplicate</button>
          <button onClick={saveTemplate} disabled={loading} style={btnPrimaryStyle}>{loading ? 'Saving…' : 'Save'}</button>
        </div>

        {/* Content area */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

          {/* Preview + layer list */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 12, gap: 10, overflow: 'auto' }}>

            <TemplatePreview
              template={template}
              selectedIds={selectedIds}
              primaryId={primaryId}
              selectedViewport={selectedViewport}
              onSelect={handleCanvasSelect}
              onDragStart={handleDragStart}
              onMoveSelected={handleMoveSelected}
              onResizeLayer={handleResizeLayer}
              snapGrid={snapGrid}
              showSafeArea={showSafeArea}
              vpWidth={(selectedViewport === 'landscape' ? 1920 : (viewportsList.find(v => v.name === selectedViewport)?.width)) || 1920}
              vpHeight={(selectedViewport === 'landscape' ? 1080 : (viewportsList.find(v => v.name === selectedViewport)?.height)) || 1080}
            />

            {/* Layer list header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, color: '#bbb', fontWeight: 'bold' }}>Layers</span>
              <span style={{ flex: 1 }} />
              <button onClick={() => addLayer('ellipse')} style={{ ...btnStyle, fontSize: 12 }}>+ Ellipse</button>
              <button onClick={() => addLayer('rect')}    style={{ ...btnStyle, fontSize: 12 }}>+ Rect</button>
              <button onClick={() => addLayer('text')}    style={{ ...btnStyle, fontSize: 12 }}>+ Text</button>
              <button onClick={() => addLayer('image')}   style={{ ...btnStyle, fontSize: 12 }}>+ Image</button>
              {canGroup   && <button onClick={groupSelected}   title="Group selected layers" style={{ ...btnStyle, fontSize: 12 }}>Group</button>}
              {canUngroup && <button onClick={ungroupSelected} title="Remove from group"     style={{ ...btnDangerStyle, fontSize: 12 }}>Ungroup</button>}
            </div>
            {/* Alignment tools — shown when ≥2 layers selected */}
            {selectedIds.size >= 2 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 11, color: '#666', marginRight: 2 }}>Align:</span>
                <button onClick={() => alignLayers('x', 'min')}    title="Align left"            style={{ ...btnStyle, padding: '2px 7px', fontSize: 12 }}>⬅L</button>
                <button onClick={() => alignLayers('x', 'center')} title="Align center (H)"      style={{ ...btnStyle, padding: '2px 7px', fontSize: 12 }}>⬛C</button>
                <button onClick={() => alignLayers('x', 'max')}    title="Align right"           style={{ ...btnStyle, padding: '2px 7px', fontSize: 12 }}>R➡</button>
                <span style={{ width: 4 }} />
                <button onClick={() => alignLayers('y', 'min')}    title="Align top"             style={{ ...btnStyle, padding: '2px 7px', fontSize: 12 }}>⬆T</button>
                <button onClick={() => alignLayers('y', 'center')} title="Align middle (V)"      style={{ ...btnStyle, padding: '2px 7px', fontSize: 12 }}>⬛M</button>
                <button onClick={() => alignLayers('y', 'max')}    title="Align bottom"          style={{ ...btnStyle, padding: '2px 7px', fontSize: 12 }}>B⬇</button>
              </div>
            )}

            {(template.layers || []).length === 0 && (
              <div style={{ color: '#555', fontSize: 13 }}>No layers yet.</div>
            )}

            {[...(template.layers || [])].reverse().map((layer) => {
              const isInSel   = selectedIds.has(layer.id);
              const isPrimary = layer.id === primaryId;
              const gName     = layer.groupId ? groupNameById[layer.groupId] || layer.groupId : null;
              const isHidden  = layer.visible === false;
              return (
                <div key={layer.id} style={{
                  display: 'flex', alignItems: 'center', padding: '4px 8px', marginBottom: 2,
                  background: isInSel ? '#1e3a5f' : '#1a1a1a', borderRadius: 3, cursor: 'pointer',
                  border: isPrimary ? '1px solid #4488dd' : isInSel ? '1px solid #336' : '1px solid transparent',
                  opacity: isHidden ? 0.4 : 1,
                }} onClick={e => selectLayerFromList(layer.id, e)}>
                  <button onClick={e => { e.stopPropagation(); toggleLayerVisibility(layer.id); }}
                          title={isHidden ? 'Show layer' : 'Hide layer'}
                          style={{ ...btnStyle, padding: '1px 5px', fontSize: 11, marginRight: 4, flexShrink: 0 }}>
                    {isHidden ? '○' : '●'}
                  </button>
                  <span style={{ fontSize: 11, color: '#666', width: 44, flexShrink: 0 }}>{layer.type}</span>
                  <span style={{ flex: 1, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {layer.id}
                    {layer.type === 'text' && layer.binding
                      ? <span style={{ color: '#44bb88', marginLeft: 6 }}>⟳{layer.binding}</span>
                      : layer.type === 'text' && layer.text
                        ? <span style={{ color: '#777', marginLeft: 6 }}>"{layer.text}"</span>
                        : null}
                  </span>
                  {gName && (
                    <span style={{ fontSize: 10, color: '#6af', background: '#1a2a3a', borderRadius: 3,
                                   padding: '1px 5px', marginRight: 4, flexShrink: 0, maxWidth: 80,
                                   overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                          title={gName}>
                      {gName}
                    </span>
                  )}
                  <button onClick={e => { e.stopPropagation(); reorderLayer(layer.id,  1); }}  title="Move up"   style={{ ...btnStyle, padding: '1px 5px', fontSize: 11 }}>↑</button>
                  <button onClick={e => { e.stopPropagation(); reorderLayer(layer.id, -1); }}  title="Move down" style={{ ...btnStyle, padding: '1px 5px', fontSize: 11 }}>↓</button>
                  <button onClick={e => { e.stopPropagation(); duplicateLayer(layer.id); }}    title="Duplicate" style={{ ...btnStyle, padding: '1px 5px', fontSize: 11 }}>⧉</button>
                  <button onClick={e => { e.stopPropagation(); deleteLayer(layer.id); }}       title="Delete"    style={{ ...btnDangerStyle, padding: '1px 5px', fontSize: 11, marginLeft: 4 }}>✕</button>
                </div>
              );
            })}

            {/* ── Media Library ── */}
            <div style={{ borderTop: '1px solid #333', marginTop: 4, paddingTop: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                <span style={{ fontSize: 13, color: '#bbb', fontWeight: 'bold', flex: 1 }}>Media Library</span>
                <button onClick={() => imgInputRef.current?.click()} style={{ ...btnStyle, fontSize: 12 }}>Upload</button>
                <button onClick={() => setImgLibOpen(v => !v)} style={{ ...btnStyle, fontSize: 12, padding: '4px 8px' }}>
                  {imgLibOpen ? '▲' : '▼'}
                </button>
                <input ref={imgInputRef} type="file"
                       accept="image/png,image/jpeg,image/webp,image/svg+xml"
                       style={{ display: 'none' }} onChange={handleFileInputChange} />
              </div>

              {imgLibOpen && (
                <>
                  {imgPending && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0 6px', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 12, color: '#aaa' }}>{imgPending.name}</span>
                      <input type="text" value={shorthandInput}
                             onChange={e => setShorthandInput(e.target.value)}
                             placeholder="shorthand" style={{ ...inputStyle, width: 120 }} />
                      <button onClick={() => uploadImage(imgPending, shorthandInput)}
                              disabled={imgUploading || !shorthandInput.trim()}
                              style={{ ...btnPrimaryStyle, fontSize: 12 }}>
                        {imgUploading ? '…' : 'OK'}
                      </button>
                      <button onClick={() => { setImgPending(null); setShorthandInput(''); setImgUploadErr(''); }}
                              style={{ ...btnStyle, fontSize: 12 }}>Cancel</button>
                      {imgUploadErr && <span style={{ color: '#f88', fontSize: 12 }}>{imgUploadErr}</span>}
                    </div>
                  )}

                  {images.length === 0 && !imgPending && (
                    <div style={{ color: '#555', fontSize: 13, paddingBottom: 4 }}>No images yet. Click Upload to add one.</div>
                  )}

                  {images.map(img => (
                    <div key={img.id} style={{
                      display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0',
                      borderBottom: '1px solid #1e1e1e',
                    }}>
                      <img src={`${serverUrl}/images/${img.id}`} alt={img.shorthand}
                           style={{ width: 40, height: 40, objectFit: 'contain', background: '#222', borderRadius: 3, flexShrink: 0 }} />
                      <span style={{ flex: 1, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                            title={img.shorthand}>{img.shorthand}</span>
                      <span style={{ fontSize: 11, color: '#666', flexShrink: 0 }}>
                        {img.mimeType?.split('/')[1]?.toUpperCase()}
                      </span>
                      <button onClick={() => useImageFromLibrary(img)} title="Insert into canvas"
                              style={{ ...btnStyle, padding: '2px 6px', fontSize: 11 }}>Use</button>
                      <button onClick={() => { if (window.confirm(`Delete image "${img.shorthand}"?`)) deleteImageById(img.id); }}
                              title="Delete" style={{ ...btnDangerStyle, padding: '2px 6px', fontSize: 11 }}>✕</button>
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>

          {/* Properties panel */}
          <div style={{ width: 280, borderLeft: '1px solid #333', padding: 12, overflowY: 'auto', flexShrink: 0 }}>
            <div style={{ fontSize: 13, color: '#bbb', fontWeight: 'bold', marginBottom: 10 }}>Properties</div>
            <LayerPropertyEditor
              layer={primaryLayer}
              selectionCount={selectedIds.size}
              aspectLock={aspectLock}
              onAspectLock={() => setAspectLock(v => !v)}
              onChange={updateLayer}
            />

            {/* Viewport-specific image settings (moved from Viewports page) */}
            <div style={{ marginTop: 18 }}>
              <div style={{ fontSize: 12, color: '#aaa', fontWeight: 'bold', marginBottom: 8 }}>Viewport Image Settings</div>
              <ImageSettingsTable
                images={images}
                viewportName={selectedViewport}
                getImgVpSettings={getImgVpSettings}
                saveImgVpSettings={saveImgVpSettings}
                serverUrl={serverUrl}
              />
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
