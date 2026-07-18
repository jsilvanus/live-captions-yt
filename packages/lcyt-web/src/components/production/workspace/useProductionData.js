import { useState, useEffect, useCallback, useRef, useContext } from 'react';
import { SessionContext } from '../../../contexts/SessionContext';
import { SentLogContext } from '../../../contexts/SentLogContext';
import { VariablesContext } from '../../../contexts/VariablesContext.jsx';
import { KEYS } from '../../../lib/storageKeys.js';
import { ACTIVE_BROADCAST_EVENT, notifyActiveBroadcastChanged } from '../../../hooks/useActiveBroadcast.js';

// ---------------------------------------------------------------------------
// useProductionData — single source of truth for the Production workspace.
//
// Centralises credentials, polls the real production/cameras + production/mixers
// endpoints, loads DSK templates / cue rules / relay status, and exposes the
// action set every pane needs (preset recall, thumbnail capture, mixer cut,
// captioning start/stop, DSK broadcast, AI-assistant prompt).
//
// Local UI state that has no server home (preview staging, on-air flag, control
// toggles, mixer-monitor mode, graphics staging, chat log) lives here too so the
// whole surface shares one consistent snapshot.
// ---------------------------------------------------------------------------

const POLL_MS = 5000;

function readCreds(session) {
  const params = new URLSearchParams(window.location.search);
  const backendUrl = (session?.backendUrl || params.get('server') ||
    localStorage.getItem(KEYS.session.backendUrl) || '').replace(/\/$/, '');
  const apiKey = session?.apiKey || params.get('apikey') || '';
  const token = session?.getSessionToken?.() || params.get('token') ||
    localStorage.getItem(KEYS.session.token) || '';
  const streamKey = session?.streamKey || '';
  return { backendUrl, apiKey, token, streamKey };
}

export function useProductionData() {
  const session = useContext(SessionContext);
  const sentLog = useContext(SentLogContext);
  const variablesCtx = useContext(VariablesContext);
  const creds = readCreds(session);
  const { backendUrl, apiKey, token } = creds;

  // Pull out the stable (useCallback) session methods and primitive state.
  // SessionContext hands down a fresh object every render, so depending on the
  // whole `session` in callbacks/effects would refire them on every render.
  const connected = !!session?.connected;
  const getRelayStatus   = session?.getRelayStatus;
  const setRelayActiveFn = session?.setRelayActive;
  const getYouTubeConfig = session?.getYouTubeConfig;
  const startStt = session?.startStt;
  const stopStt  = session?.stopStt;
  const getSttStatus = session?.getSttStatus;

  const headers = useCallback((extra = {}) => ({
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(apiKey ? { 'X-API-Key': apiKey } : {}),
    ...extra,
  }), [token, apiKey]);

  const jfetch = useCallback(async (path, opts = {}) => {
    const res = await fetch(`${backendUrl}${path}`, { ...opts, headers: headers(opts.headers) });
    return res;
  }, [backendUrl, headers]);

  // ─── Server-backed data ───────────────────────────────────────────────
  const [cameras, setCameras] = useState([]);
  const [mixers, setMixers] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [cueRules, setCueRules] = useState([]);
  const [relay, setRelay] = useState(null);      // relay-slot status → YouTube pane
  const [broadcast, setBroadcast] = useState(null); // active broadcast (plan/broadcasts_next E)
  const [thumbTick, setThumbTick] = useState(0); // cache-buster for thumbnails
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(null);

  const loadCore = useCallback(async () => {
    if (!backendUrl) { setLoaded(true); return; }
    try {
      const [camRes, mixRes] = await Promise.all([
        jfetch('/production/cameras'),
        jfetch('/production/mixers'),
      ]);
      if (camRes.ok) setCameras(await camRes.json());
      if (mixRes.ok) setMixers(await mixRes.json());
      setError(camRes.ok || mixRes.ok ? null : `HTTP ${camRes.status}`);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoaded(true);
    }
  }, [backendUrl, jfetch]);

  const pollMixers = useCallback(async () => {
    if (!backendUrl) return;
    try {
      const r = await jfetch('/production/mixers');
      if (r.ok) setMixers(await r.json());
    } catch { /* silent */ }
  }, [backendUrl, jfetch]);

  // Auth-gated extras — best-effort, degrade quietly when not connected / not enabled.
  const loadTemplates = useCallback(async () => {
    if (!backendUrl || !apiKey) return;
    try {
      const r = await jfetch(`/dsk/${encodeURIComponent(apiKey)}/templates`);
      if (r.ok) { const d = await r.json(); setTemplates(Array.isArray(d) ? d : d.templates || []); }
    } catch { /* ignore */ }
  }, [backendUrl, apiKey, jfetch]);

  const loadCues = useCallback(async () => {
    if (!backendUrl || !token) return;
    try {
      const r = await jfetch('/cues/rules');
      if (r.ok) { const d = await r.json(); setCueRules(d.rules || []); }
    } catch { /* ignore */ }
  }, [backendUrl, token, jfetch]);

  const loadRelay = useCallback(async () => {
    if (!getRelayStatus) return;
    try { setRelay(await getRelayStatus()); } catch { /* ignore */ }
  }, [getRelayStatus]);

  const loadBroadcast = useCallback(async () => {
    if (!backendUrl || !token) return;
    try {
      const r = await jfetch('/broadcasts/active');
      if (r.ok) { const d = await r.json(); setBroadcast(d.broadcast ?? null); }
    } catch { /* ignore */ }
  }, [backendUrl, token, jfetch]);

  useEffect(() => { loadCore(); }, [loadCore]);
  useEffect(() => { loadTemplates(); loadCues(); loadRelay(); loadBroadcast(); }, [loadTemplates, loadCues, loadRelay, loadBroadcast]);
  useEffect(() => {
    window.addEventListener(ACTIVE_BROADCAST_EVENT, loadBroadcast);
    return () => window.removeEventListener(ACTIVE_BROADCAST_EVENT, loadBroadcast);
  }, [loadBroadcast]);
  useEffect(() => {
    const id = setInterval(() => { pollMixers(); loadRelay(); }, POLL_MS);
    return () => clearInterval(id);
  }, [pollMixers, loadRelay]);

  // ─── Local UI state ───────────────────────────────────────────────────
  const [ui, setUi] = useState({
    previewId: null,       // camera id staged for preview (client-side)
    localProgramId: null,  // fallback program when no live mixer is present
    onAir: false,
    captioning: false,
    recording: false,
    dsk: true,
    mute: false,
    mixerMode: 'pvwpgm',   // pvwpgm | pgm | multi
    showThumbs: false,     // cameras pane: show inline live thumbnails
    lastPreset: null,      // "camId:presetId" flash key
    presetState: {},       // presetKey → 'pending'|'ok'|'error'
    gfxStaged: null,       // template id staged
    gfxLive: null,         // template id on air
    gfxFields: {},         // { [templateId]: { [layerId]: text } }
    chat: [{ id: 1, role: 'assistant', text: 'Ready. I can draft captions, summarize the rundown, or flag pacing during the service.' }],
    chatBusy: false,
  });
  const patch = useCallback((p) => setUi((s) => ({ ...s, ...(typeof p === 'function' ? p(s) : p) })), []);

  // Sync captioning flag from live STT status once on mount.
  useEffect(() => {
    if (!getSttStatus || !token) return;
    Promise.resolve(getSttStatus()).then((st) => {
      if (st && (st.running || st.active)) patch({ captioning: true });
    }).catch(() => {});
  }, [getSttStatus, token, patch]);

  const flashTimer = useRef(null);

  // ─── Derived: program / preview inputs ────────────────────────────────
  const primaryMixer = mixers[0] || null;
  const activeInput = primaryMixer
    ? primaryMixer.activeSource
    : (cameras.find((c) => c.id === ui.localProgramId)?.mixerInput ?? null);

  const camById = (id) => cameras.find((c) => c.id === id) || null;
  const previewCam = camById(ui.previewId) || cameras[0] || null;
  const programCam = cameras.find((c) => c.mixerInput != null && c.mixerInput === activeInput) || null;

  // ─── Actions ──────────────────────────────────────────────────────────

  const setPreview = useCallback((camId) => patch({ previewId: camId }), [patch]);

  const recallPreset = useCallback(async (camera, presetId) => {
    const key = `${camera.id}:${presetId}`;
    patch((s) => ({ presetState: { ...s.presetState, [key]: 'pending' } }));
    try {
      const r = await jfetch(`/production/cameras/${camera.id}/preset/${encodeURIComponent(presetId)}`, { method: 'POST' });
      const ok = r.ok;
      patch((s) => ({ presetState: { ...s.presetState, [key]: ok ? 'ok' : 'error' }, previewId: camera.id }));
    } catch {
      patch((s) => ({ presetState: { ...s.presetState, [key]: 'error' } }));
    }
    setTimeout(() => patch((s) => {
      const ps = { ...s.presetState }; delete ps[key]; return { presetState: ps };
    }), 1500);
  }, [jfetch, patch]);

  const captureThumbnail = useCallback(async (camera) => {
    const key = `${camera.id}:thumb`;
    patch((s) => ({ presetState: { ...s.presetState, [key]: 'pending' } }));
    try {
      const r = await jfetch(`/production/cameras/${camera.id}/thumbnail/capture`, {
        method: 'POST',
        body: JSON.stringify({ apiKey, mixerId: primaryMixer?.id }),
      });
      patch((s) => ({ presetState: { ...s.presetState, [key]: r.ok ? 'ok' : 'error' } }));
      if (r.ok) { setThumbTick((t) => t + 1); loadCore(); }
    } catch {
      patch((s) => ({ presetState: { ...s.presetState, [key]: 'error' } }));
    }
    setTimeout(() => patch((s) => {
      const ps = { ...s.presetState }; delete ps[key]; return { presetState: ps };
    }), 1600);
  }, [jfetch, apiKey, primaryMixer, patch, loadCore]);

  const switchTo = useCallback(async (input) => {
    if (input == null) return;
    if (!primaryMixer) {
      const cam = cameras.find((c) => c.mixerInput === input);
      patch({ localProgramId: cam?.id ?? null });
      return;
    }
    try {
      const r = await jfetch(`/production/mixers/${primaryMixer.id}/switch/${input}`, { method: 'POST' });
      if (r.ok) {
        const { activeSource } = await r.json();
        setMixers((prev) => prev.map((m) => m.id === primaryMixer.id ? { ...m, activeSource } : m));
      }
    } catch { /* ignore */ }
  }, [primaryMixer, cameras, jfetch, patch]);

  const cut = useCallback(() => {
    const cam = previewCam;
    if (cam?.mixerInput != null) switchTo(cam.mixerInput);
    else if (cam) patch({ localProgramId: cam.id });
  }, [previewCam, switchTo, patch]);

  // Captioning via server-side STT (falls back to a local flag if unavailable).
  const toggleCaptioning = useCallback(async () => {
    const next = !ui.captioning;
    patch({ captioning: next });
    try {
      if (next) await startStt?.();
      else await stopStt?.();
    } catch { /* keep the optimistic flag; server may not have STT wired */ }
  }, [ui.captioning, startStt, stopStt, patch]);

  // ─── DSK / lower-thirds ───────────────────────────────────────────────
  // The templates list only carries { id, name }; a template's text layers
  // come from a per-template fetch, loaded lazily the first time it's staged.
  const loadTemplateJson = useCallback(async (id) => {
    if (!apiKey) return;
    try {
      const r = await jfetch(`/dsk/${encodeURIComponent(apiKey)}/templates/${id}`);
      if (!r.ok) return;
      const { template } = await r.json();
      const tj = template?.templateJson ?? template?.template_json ?? null;
      if (tj) setTemplates((prev) => prev.map((t) => t.id === id ? { ...t, templateJson: tj } : t));
    } catch { /* ignore */ }
  }, [apiKey, jfetch]);

  const stageGraphic = useCallback((templateId) => {
    patch({ gfxStaged: templateId });
    const t = templates.find((x) => x.id === templateId);
    if (t && !t.templateJson) loadTemplateJson(templateId);
  }, [patch, templates, loadTemplateJson]);
  const setGraphicField = useCallback((templateId, layerId, value) => patch((s) => ({
    gfxFields: { ...s.gfxFields, [templateId]: { ...(s.gfxFields[templateId] || {}), [layerId]: value } },
  })), [patch]);

  const cutGraphicLive = useCallback(async () => {
    const id = ui.gfxStaged;
    if (!id || !apiKey) return;
    patch({ gfxLive: id });
    const fields = ui.gfxFields[id] || {};
    const updates = Object.entries(fields).map(([layerId, text]) => ({ selector: `#${layerId}`, text }));
    try {
      await jfetch(`/dsk/${encodeURIComponent(apiKey)}/broadcast`, {
        method: 'POST', body: JSON.stringify({ templateIds: [id], updates }),
      });
    } catch { /* ignore */ }
  }, [ui.gfxStaged, ui.gfxFields, apiKey, jfetch, patch]);

  const clearGraphicLive = useCallback(async () => {
    patch({ gfxLive: null });
    if (!apiKey) return;
    try {
      await jfetch(`/dsk/${encodeURIComponent(apiKey)}/graphics`, {
        method: 'POST', body: JSON.stringify({ default: [] }),
      });
    } catch { /* ignore */ }
  }, [apiKey, jfetch, patch]);

  // ─── AI production assistant ──────────────────────────────────────────
  const sendChat = useCallback(async (text) => {
    const t = text.trim();
    if (!t) return;
    patch((s) => ({ chat: [...s.chat, { id: Date.now(), role: 'user', text: t }], chatBusy: true }));
    try {
      const r = await jfetch('/roles/assistant/prompt', { method: 'POST', body: JSON.stringify({ text: t }) });
      let reply;
      if (r.ok) {
        const d = await r.json().catch(() => ({}));
        reply = d.reply || d.text || d.message ||
          (d.ok ? 'Noted — added to the assistant’s context.' : 'The assistant received your note.');
      } else if (r.status === 503) {
        reply = 'The Production Assistant isn’t enabled for this project yet. Configure an AI provider and enable the Assistant role in Setup → AI models.';
      } else {
        reply = `Assistant error (HTTP ${r.status}).`;
      }
      patch((s) => ({ chat: [...s.chat, { id: Date.now() + 1, role: 'assistant', text: reply }], chatBusy: false }));
    } catch (e) {
      patch((s) => ({ chat: [...s.chat, { id: Date.now() + 1, role: 'assistant', text: `Could not reach the assistant: ${e.message}` }], chatBusy: false }));
    }
  }, [jfetch, patch]);

  // ─── Broadcast status (plan/broadcasts_next Feature E) ────────────────
  const setBroadcastStatus = useCallback(async (status) => {
    if (!broadcast?.id) return;
    const prev = broadcast;
    setBroadcast({ ...broadcast, status }); // optimistic
    try {
      const r = await jfetch(`/broadcasts/${encodeURIComponent(broadcast.id)}`, {
        method: 'PUT', body: JSON.stringify({ status }),
      });
      if (!r.ok) { setBroadcast(prev); return; }
      const d = await r.json().catch(() => ({}));
      setBroadcast(d.broadcast ?? { ...prev, status });
      notifyActiveBroadcastChanged();
    } catch {
      setBroadcast(prev);
    }
  }, [broadcast, jfetch]);

  // ─── Cue creation (rundown "+ Cue") ───────────────────────────────────
  const addCueRule = useCallback(async ({ name, pattern }) => {
    if (!name || !token) return;
    try {
      const r = await jfetch('/cues/rules', {
        method: 'POST',
        body: JSON.stringify({ name, match_type: 'phrase', pattern: pattern || name, action: {} }),
      });
      if (r.ok) loadCues();
    } catch { /* ignore */ }
  }, [token, jfetch, loadCues]);

  useEffect(() => () => clearTimeout(flashTimer.current), []);

  return {
    creds, connected, jfetch,
    loaded, error,
    cameras, mixers, primaryMixer, templates, cueRules, relay, broadcast, thumbTick,
    sentEntries: sentLog?.entries || [],
    variables: variablesCtx?.variables || {},
    activeInput, previewCam, programCam, camById,
    ui, patch,
    refresh: loadCore,
    actions: {
      setPreview, recallPreset, captureThumbnail, switchTo, cut,
      toggleCaptioning, stageGraphic, setGraphicField, cutGraphicLive, clearGraphicLive,
      sendChat, addCueRule, setBroadcastStatus,
    },
    youtube: {
      getConfig: getYouTubeConfig,
      setRelayActive: setRelayActiveFn,
    },
  };
}
