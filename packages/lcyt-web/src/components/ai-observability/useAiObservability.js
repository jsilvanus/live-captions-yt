import { useState, useEffect, useCallback } from 'react';
import { useSessionContext } from '../../contexts/SessionContext.jsx';
import { useEventStream } from '../../hooks/useEventStream.js';

// ---------------------------------------------------------------------------
// useAiObservability — data + actions for the AI Observability page
// (plan_ai_observability.md Stage 1): a single-feed live overlay (tracker/
// describer events off the shared /events/stream, over the project's
// existing polled preview-JPEG feed), a browse view over each vision role's
// capture ring buffer (GET /roles/:roleCode/captures), and the prompt
// sandbox/replay endpoint. Layered directly on the project session
// (useSessionContext) rather than useProductionData — this page needs
// backendUrl/apiKey/getSessionToken/connected and nothing else the
// Production workspace hook loads (cameras, mixers, DSK templates, …).
//
// Deliberately does NOT poll anything beyond the existing preview-JPEG
// cache-buster tick and a light /status poll — opening this page must never
// increase the backend's vision-role inference sampling rate as a side
// effect (plan_ai_observability.md's non-goal). The one place this hook
// triggers real inference is `actions.replay()`, an explicit one-shot call
// the user asked for.
// ---------------------------------------------------------------------------

const ROLE_CODES = ['tracker', 'describer'];

export function useAiObservability() {
  const session = useSessionContext();
  const { backendUrl, apiKey, connected, getSessionToken } = session;

  const [status, setStatus] = useState({ tracker: null, describer: null });
  const [captures, setCaptures] = useState({ tracker: [], describer: [] });
  const [busy, setBusy] = useState(false);
  const [trackerObjects, setTrackerObjects] = useState([]);
  const [describerUpdate, setDescriberUpdate] = useState(null);
  // Perception: latest detector subjects per camera and the feed attributor's current source tag
  const [detectorByCamera, setDetectorByCamera] = useState({});
  const [sourceTag, setSourceTag] = useState(null);
  const [lastDetectorCamera, setLastDetectorCamera] = useState(null);
  const [previewTick, setPreviewTick] = useState(0);
  const [perception, setPerception] = useState(null);

  const api = useCallback(async (path, opts = {}) => {
    const token = getSessionToken?.();
    const headers = { ...(opts.headers || {}) };
    if (token) headers.Authorization = `Bearer ${token}`;
    let body = opts.body;
    if (body !== undefined && typeof body !== 'string') {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(body);
    }
    return fetch(`${backendUrl}${path}`, { ...opts, headers, body });
  }, [backendUrl, getSessionToken]);

  const loadStatus = useCallback(async (roleCode) => {
    if (!backendUrl || !apiKey) return;
    const res = await api(`/roles/${roleCode}/status`);
    if (res.ok) {
      const data = await res.json();
      setStatus((s) => ({ ...s, [roleCode]: data }));
    }
  }, [api, backendUrl, apiKey]);

  const loadCaptures = useCallback(async (roleCode) => {
    if (!backendUrl || !apiKey) return;
    const res = await api(`/roles/${roleCode}/captures`);
    if (res.ok) {
      const data = await res.json();
      setCaptures((c) => ({ ...c, [roleCode]: data.captures || [] }));
    }
  }, [api, backendUrl, apiKey]);

  // Initial load + a light status poll (not a capture poll — captures are
  // refreshed explicitly via actions.refreshCaptures(), e.g. after starting
  // a role or on a manual "refresh" click).
  useEffect(() => {
    if (!connected) return undefined;
    ROLE_CODES.forEach((code) => { loadStatus(code); loadCaptures(code); });
    const id = setInterval(() => ROLE_CODES.forEach(loadStatus), 5000);
    return () => clearInterval(id);
  }, [connected, loadStatus, loadCaptures]);

  // Live overlay: subscribe directly to role.tracker.*/role.describer.* on
  // the shared /events/stream multiplexer — both events already exist and
  // stream today, no new backend surface for this part of Stage 1.
  const eventStream = useEventStream({ backendUrl, connected, getToken: getSessionToken });
  useEffect(() => {
    if (!connected) return undefined;
    return eventStream.on(['role.tracker.*', 'role.describer.*'], (envelope) => {
      if (envelope.topic === 'role.tracker.tracker_update') {
        setTrackerObjects(Array.isArray(envelope.data?.objects) ? envelope.data.objects : []);
      } else if (envelope.topic === 'role.describer.describer_update') {
        setDescriberUpdate({ text: envelope.data?.text ?? null, json: envelope.data?.json ?? null });
      }
    });
  }, [connected, eventStream]);

  useEffect(() => {
    if (!connected) return undefined;
    return eventStream.on(['camera.track_state', 'feed.source_changed'], (envelope) => {
      if (envelope.topic === 'feed.source_changed') {
        setSourceTag(envelope.data || null);
      } else if (envelope.data?.cameraId) {
        const { cameraId, subjects, visible } = envelope.data;
        setDetectorByCamera((m) => ({ ...m, [cameraId]: visible === false ? [] : (Array.isArray(subjects) ? subjects : []) }));
        setLastDetectorCamera(cameraId);
      }
    });
  }, [connected, eventStream]);

  // Boxes of the camera on program (per the attributor), else of the camera that reported last.
  const detectorSubjects = detectorByCamera[sourceTag?.cameraId ?? lastDetectorCamera] ?? [];

  // Camera status panel: one overview read (jobs, auto-start, on-program, what the detector sees, attribution)
  const loadPerception = useCallback(async () => {
    if (!backendUrl || !apiKey) return;
    try {
      const res = await api('/production/perception/overview');
      if (res.ok) setPerception(await res.json());
    } catch { /* panel just keeps its last state */ }
  }, [api, backendUrl, apiKey]);

  useEffect(() => {
    if (!connected) return undefined;
    loadPerception();
    const id = setInterval(loadPerception, 4000);
    return () => clearInterval(id);
  }, [connected, loadPerception]);

  /** POST to a perception/attribution route, refresh the overview, return an error string or null. */
  const perceptionAction = useCallback(async (path, body = {}) => {
    const res = await api(path, { method: 'POST', body });
    const data = await res.json().catch(() => ({}));
    await loadPerception();
    return res.ok ? null : (data.error || data.message || `HTTP ${res.status}`);
  }, [api, loadPerception]);

  // Cache-buster tick for the polled preview-JPEG <img> (same convention as
  // useCropEditor.js's previewTick).
  useEffect(() => {
    const id = setInterval(() => setPreviewTick((t) => t + 1), 3000);
    return () => clearInterval(id);
  }, []);

  const startRole = useCallback(async (roleCode) => {
    setBusy(true);
    try {
      const res = await api(`/roles/${roleCode}/start`, { method: 'POST', body: {} });
      const data = await res.json().catch(() => ({}));
      await loadStatus(roleCode);
      if (!res.ok) return { ok: false, error: data.error || `HTTP ${res.status}` };
      return { ok: true };
    } finally {
      setBusy(false);
    }
  }, [api, loadStatus]);

  const stopRole = useCallback(async (roleCode) => {
    setBusy(true);
    try {
      await api(`/roles/${roleCode}/stop`, { method: 'POST' });
      await loadStatus(roleCode);
    } finally {
      setBusy(false);
    }
  }, [api, loadStatus]);

  const refreshCaptures = useCallback((roleCode) => loadCaptures(roleCode), [loadCaptures]);

  /** Prompt sandbox — never persisted, a one-shot re-run against a captured frame. */
  const replay = useCallback(async (roleCode, captureId, promptOverride) => {
    const res = await api(`/roles/${roleCode}/captures/${captureId}/replay`, {
      method: 'POST',
      body: { promptOverride },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error || `HTTP ${res.status}` };
    return data;
  }, [api]);

  const previewUrl = backendUrl && apiKey
    ? `${backendUrl}/preview/${encodeURIComponent(apiKey)}/incoming?t=${previewTick}`
    : null;

  const frameUrl = useCallback((roleCode, captureId) => {
    if (!backendUrl || !captureId) return null;
    const token = getSessionToken?.() || '';
    return `${backendUrl}/roles/${roleCode}/captures/${encodeURIComponent(captureId)}/frame?token=${encodeURIComponent(token)}`;
  }, [backendUrl, getSessionToken]);

  return {
    connected, backendUrl, apiKey,
    status, captures, busy,
    trackerObjects, describerUpdate, detectorSubjects, sourceTag, perception, perceptionAction,
    previewUrl, frameUrl,
    actions: { startRole, stopRole, refreshCaptures, replay },
  };
}
