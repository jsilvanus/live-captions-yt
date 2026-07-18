import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useProductionData } from '../workspace/useProductionData.js';

// ---------------------------------------------------------------------------
// useCropEditor — data + actions for the Vertical Crop operator page
// (plan_vertical_crop.md Phase 3), layered on top of useProductionData for
// credentials/cameras/mixers/jfetch (single source of truth for the
// Production surface's server calls).
//
// Sources are camera-centric: each camera contributes a coarse "whole
// camera" source plus one row per configured PTZ preset (AMX/VISCA), so a
// (camera, preset) combo can be bound to its own crop position exactly like
// plan_vertical_crop.md §4 describes. AMX presets carry no numeric preset
// id in this schema, so their array index is used as `cameraPreset` (VISCA
// presets already carry a real `presetNumber`).
// ---------------------------------------------------------------------------

const CROP = '/crop';
const DEFAULT_SET_KEY = '__default__';
const setKeyOf = (id) => (id === null || id === undefined ? DEFAULT_SET_KEY : id);

export function cameraPresetSources(camera) {
  const presets = camera.controlConfig?.presets || [];
  const rows = [{ cameraId: camera.id, cameraPreset: null, label: camera.name, presetName: null }];
  presets.forEach((p, i) => {
    rows.push({
      cameraId: camera.id,
      cameraPreset: Number.isInteger(p.presetNumber) ? p.presetNumber : i,
      label: `${camera.name} · ${p.name || `Preset ${i + 1}`}`,
      presetName: p.name || `Preset ${i + 1}`,
    });
  });
  return rows;
}

export function sourceMatchesEntry(source, entry) {
  return entry.cameraId === source.cameraId
    && (entry.cameraPreset ?? null) === (source.cameraPreset ?? null);
}

export function useCropEditor() {
  const D = useProductionData();
  const { jfetch, creds, cameras, connected } = D;
  const { backendUrl, apiKey } = creds;

  const [config, setConfig] = useState(null); // crop_config fields + live status
  const [sets, setSets] = useState([]);
  const [presetsBySet, setPresetsBySet] = useState({}); // { [setKeyOf(id)]: preset[] }
  const [sourceMap, setSourceMap] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(null);
  const [viewSetId, setViewSetId] = useState(null); // null = the implicit default/unsorted set
  const [editingPresetId, setEditingPresetId] = useState(null);
  const [selectedSource, setSelectedSource] = useState(null); // { cameraId, cameraPreset, label } | null
  const [draftPos, setDraftPos] = useState({ xNorm: 0.5, yNorm: 0 });
  const [busy, setBusy] = useState(false);
  const [previewTick, setPreviewTick] = useState(0);

  const dragThrottle = useRef({ timer: null, pending: null });

  const loadConfig = useCallback(async () => {
    const r = await jfetch(`${CROP}/config`);
    if (r.ok) { const d = await r.json(); setConfig(d); return d; }
    if (r.status === 403) setError('feature-disabled');
    return null;
  }, [jfetch]);

  const loadSets = useCallback(async () => {
    const r = await jfetch(`${CROP}/sets`);
    if (r.ok) { const d = await r.json(); setSets(d.sets || []); return d.sets || []; }
    return [];
  }, [jfetch]);

  const loadPresets = useCallback(async (setId) => {
    const qs = setId === null ? 'setId=' : `setId=${encodeURIComponent(setId)}`;
    const r = await jfetch(`${CROP}/presets?${qs}`);
    if (r.ok) {
      const d = await r.json();
      setPresetsBySet((prev) => ({ ...prev, [setKeyOf(setId)]: d.presets || [] }));
      return d.presets || [];
    }
    return [];
  }, [jfetch]);

  const loadSourceMap = useCallback(async () => {
    const r = await jfetch(`${CROP}/source-map`);
    if (r.ok) { const d = await r.json(); setSourceMap(d.entries || []); }
  }, [jfetch]);

  const loadAll = useCallback(async () => {
    if (!backendUrl || !apiKey) { setLoaded(true); return; }
    setError(null);
    try {
      const cfg = await loadConfig();
      await Promise.all([loadSets(), loadSourceMap()]);
      const initialSet = cfg?.activeSetId ?? null;
      setViewSetId(initialSet);
      await loadPresets(initialSet);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoaded(true);
    }
  }, [backendUrl, apiKey, loadConfig, loadSets, loadSourceMap, loadPresets]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Poll status while mounted so the running/repositionMode chip and the
  // free-position (non-preset) readout stay current.
  useEffect(() => {
    if (!backendUrl || !apiKey) return;
    const id = setInterval(loadConfig, 5000);
    return () => clearInterval(id);
  }, [backendUrl, apiKey, loadConfig]);

  // Refresh the incoming-preview cache-buster periodically.
  useEffect(() => {
    const id = setInterval(() => setPreviewTick((t) => t + 1), 4000);
    return () => clearInterval(id);
  }, []);

  const presets = presetsBySet[setKeyOf(viewSetId)] || [];
  const editingPreset = presets.find((p) => p.id === editingPresetId) || null;

  // Keep the draft position in sync with whichever preset is selected.
  useEffect(() => {
    if (editingPreset) setDraftPos({ xNorm: editingPreset.xNorm, yNorm: editingPreset.yNorm });
  }, [editingPreset?.id, editingPreset?.xNorm, editingPreset?.yNorm]);

  const selectSet = useCallback(async (setId) => {
    setViewSetId(setId);
    setEditingPresetId(null);
    setSelectedSource(null);
    if (!presetsBySet[setKeyOf(setId)]) await loadPresets(setId);
  }, [presetsBySet, loadPresets]);

  const selectPreset = useCallback((presetId) => {
    setEditingPresetId(presetId);
  }, []);

  const boundEntryFor = useCallback((source) => (
    source ? sourceMap.find((e) => sourceMatchesEntry(source, e) && presets.some((p) => p.id === e.presetId)) : null
  ), [sourceMap, presets]);

  const selectSource = useCallback((source) => {
    setSelectedSource(source);
    const entry = boundEntryFor(source);
    if (entry) setEditingPresetId(entry.presetId);
  }, [boundEntryFor]);

  // ── position (drag) ──────────────────────────────────────────────────
  const setPositionLive = useCallback((xNorm, yNorm) => {
    setDraftPos({ xNorm, yNorm });
    if (!config?.running) return;
    const t = dragThrottle.current;
    t.pending = { xNorm, yNorm };
    if (t.timer) return;
    t.timer = setTimeout(async () => {
      const p = t.pending; t.timer = null; t.pending = null;
      if (!p) return;
      try {
        const r = await jfetch(`${CROP}/position`, {
          method: 'POST',
          body: JSON.stringify({ xNorm: p.xNorm, yNorm: p.yNorm }),
        });
        if (r.ok) {
          const d = await r.json();
          setConfig((c) => c && { ...c, xNorm: d.xNorm, yNorm: d.yNorm, activePresetId: null });
        }
      } catch { /* best-effort while dragging */ }
    }, 120);
  }, [config?.running, jfetch]);

  // ── config ────────────────────────────────────────────────────────────
  const saveConfig = useCallback(async (patch) => {
    setBusy(true);
    try {
      const r = await jfetch(`${CROP}/config`, { method: 'PUT', body: JSON.stringify(patch) });
      if (r.ok) { setConfig(await r.json()); return { ok: true }; }
      const d = await r.json().catch(() => ({}));
      return { ok: false, error: d.error || `HTTP ${r.status}` };
    } finally {
      setBusy(false);
    }
  }, [jfetch]);

  // ── sets ──────────────────────────────────────────────────────────────
  const createSet = useCallback(async (name, cloneFromSetId = null) => {
    const r = await jfetch(`${CROP}/sets`, { method: 'POST', body: JSON.stringify({ name, cloneFromSetId }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, error: d.error || `HTTP ${r.status}` };
    await loadSets();
    if (cloneFromSetId !== null) await loadSourceMap();
    await selectSet(d.set.id);
    return { ok: true, set: d.set };
  }, [jfetch, loadSets, loadSourceMap, selectSet]);

  const renameSet = useCallback(async (id, name) => {
    const r = await jfetch(`${CROP}/sets/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify({ name }) });
    if (r.ok) await loadSets();
    return r.ok;
  }, [jfetch, loadSets]);

  const deleteSet = useCallback(async (id) => {
    const r = await jfetch(`${CROP}/sets/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (r.ok) {
      setPresetsBySet((prev) => { const next = { ...prev }; delete next[setKeyOf(id)]; return next; });
      await loadSets();
      await loadSourceMap();
      if (viewSetId === id) await selectSet(null);
    }
    return r.ok;
  }, [jfetch, loadSets, loadSourceMap, viewSetId, selectSet]);

  const activateSet = useCallback(async (id) => {
    setBusy(true);
    try {
      if (id === null) {
        const res = await saveConfig({ activeSetId: null });
        return res;
      }
      const r = await jfetch(`${CROP}/sets/${encodeURIComponent(id)}/activate`, { method: 'POST' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) return { ok: false, error: d.error || `HTTP ${r.status}` };
      await loadConfig();
      return { ok: true };
    } finally {
      setBusy(false);
    }
  }, [jfetch, saveConfig, loadConfig]);

  // ── presets ───────────────────────────────────────────────────────────
  const createPreset = useCallback(async (name, pos = draftPos) => {
    const r = await jfetch(`${CROP}/presets`, {
      method: 'POST',
      body: JSON.stringify({ name, xNorm: pos.xNorm, yNorm: pos.yNorm, setId: viewSetId }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, error: d.error || `HTTP ${r.status}` };
    await loadPresets(viewSetId);
    setEditingPresetId(d.preset.id);
    return { ok: true, preset: d.preset };
  }, [jfetch, viewSetId, draftPos, loadPresets]);

  const updatePreset = useCallback(async (id, patch) => {
    const r = await jfetch(`${CROP}/presets/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(patch) });
    if (r.ok) await loadPresets(viewSetId);
    return r.ok;
  }, [jfetch, viewSetId, loadPresets]);

  const deletePreset = useCallback(async (id) => {
    const r = await jfetch(`${CROP}/presets/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (r.ok) {
      await Promise.all([loadPresets(viewSetId), loadSourceMap()]);
      if (editingPresetId === id) setEditingPresetId(null);
    }
    return r.ok;
  }, [jfetch, viewSetId, loadPresets, loadSourceMap, editingPresetId]);

  const activatePreset = useCallback(async (id, transitionMs) => {
    setBusy(true);
    try {
      const r = await jfetch(`${CROP}/presets/${encodeURIComponent(id)}/activate`, {
        method: 'POST',
        body: JSON.stringify(transitionMs != null ? { transitionMs } : {}),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) return { ok: false, error: d.error || `HTTP ${r.status}` };
      setConfig((c) => c && { ...c, running: true, xNorm: d.xNorm, yNorm: d.yNorm, activePresetId: id });
      return { ok: true };
    } finally {
      setBusy(false);
    }
  }, [jfetch]);

  // ── source map ────────────────────────────────────────────────────────
  const bindSource = useCallback(async (source, presetId) => {
    if (!source || !presetId) return { ok: false, error: 'Pick a source and a preset first' };
    setBusy(true);
    try {
      const existing = boundEntryFor(source);
      if (existing) await jfetch(`${CROP}/source-map/${encodeURIComponent(existing.id)}`, { method: 'DELETE' });
      const r = await jfetch(`${CROP}/source-map`, {
        method: 'POST',
        body: JSON.stringify({ cameraId: source.cameraId, cameraPreset: source.cameraPreset, presetId }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) return { ok: false, error: d.error || `HTTP ${r.status}` };
      await loadSourceMap();
      return { ok: true };
    } finally {
      setBusy(false);
    }
  }, [jfetch, boundEntryFor, loadSourceMap]);

  const unbindSource = useCallback(async (source) => {
    const entry = boundEntryFor(source);
    if (!entry) return false;
    const r = await jfetch(`${CROP}/source-map/${encodeURIComponent(entry.id)}`, { method: 'DELETE' });
    if (r.ok) await loadSourceMap();
    return r.ok;
  }, [jfetch, boundEntryFor, loadSourceMap]);

  // ── derived: source rows for the right column ───────────────────────
  const sources = useMemo(() => cameras.flatMap(cameraPresetSources), [cameras]);

  const previewUrl = backendUrl && apiKey
    ? `${backendUrl}/preview/${encodeURIComponent(apiKey)}/incoming.jpg?t=${previewTick}`
    : null;
  const monitorUrl = backendUrl && apiKey
    ? `${backendUrl}/stream-hls/${encodeURIComponent(apiKey)}-crop/index.m3u8`
    : null;

  return {
    D, connected, creds, cameras,
    loaded, error, busy,
    config, sets, presets, sourceMap, sources,
    viewSetId, editingPreset, editingPresetId, selectedSource, draftPos,
    previewUrl, monitorUrl,
    boundEntryFor,
    actions: {
      refresh: loadAll,
      selectSet, selectPreset, selectSource,
      setPositionLive, saveConfig,
      createSet, renameSet, deleteSet, activateSet,
      createPreset, updatePreset, deletePreset, activatePreset,
      bindSource, unbindSource,
    },
  };
}
