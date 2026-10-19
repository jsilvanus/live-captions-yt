import { useState, useEffect, useCallback } from 'react';
import { useSessionContext } from '../../contexts/SessionContext';
import { SetupCard, SetupItemRow } from './SetupCard.jsx';
import { EgressIcon } from './icons.jsx';
import { Dialog } from '../Dialog.jsx';
import { RelaySlotRow } from '../panels/RelaySlotRow.jsx';
import {
  MAX_RELAY_SLOTS,
  setSlotTargetType, setSlotYoutubeKey, setSlotGenericUrl, setSlotGenericName,
  setSlotCaptionMode, setSlotScale, setSlotFps, setSlotVideoBitrate, setSlotAudioBitrate,
  setSlotRecordOnStart, setSlotRecordOnButton, setSlotSourceView, setSlotSourceFeedId,
  clearSlot, buildInitialRelayList,
} from '../../lib/relayConfig.js';
import { sourceRequestFields } from '../../lib/relaySource.js';
import { setupToken } from '../../lib/setupToken.js';

function slotLabel(entry) {
  return entry.targetType === 'youtube' ? 'YouTube' : (entry.genericName || 'Generic RTMP');
}

function slotMeta(entry) {
  if (entry.targetType === 'youtube') {
    const key = (entry.youtubeKey || '').trim();
    return key ? `••••${key.slice(-4)}` : 'No stream key set';
  }
  return (entry.genericUrl || '').trim() || 'No URL set';
}

/**
 * EgressSection — YouTube/generic RTMP relay targets, wired to the
 * same client-side `relayConfig.js` localStorage data the Broadcast →
 * Settings → Stream tab uses (see `StreamTab.jsx`/`RelayPanel.jsx`). Reuses
 * `RelaySlotRow` (the same per-slot editor) as Dialog content instead of
 * RelayPanel's own always-inline expanding rows. `MAX_RELAY_SLOTS` is a UI
 * convenience cap only — the backend itself has none (plan_ingest_feeds.md
 * §1b). Each slot can pick a source (Program / Vertical Crop / a named feed,
 * grouped by kind) from the `feeds` list (`GET /feeds`) this component fetches
 * and passes to `RelaySlotRow` — `RelayPanel.jsx`/`StreamTab.jsx` don't fetch
 * or pass that list, so the source picker only appears here for now. The
 *
 * No `/setup/egress/page` parity route: unlike the device managers, there's
 * no standalone page that's *just* this — `/broadcast` also covers Encoder
 * and YouTube auth config, so the footer link goes there directly instead of
 * through a parity banner.
 */
export function EgressSection() {
  const session = useSessionContext();
  const connected = session?.connected;
  const backendUrl = session?.backendUrl;
  const getSessionToken = session?.getSessionToken;
  const getRelayStatus = session?.getRelayStatus;
  const configureRelay = session?.configureRelay;
  const setRelayActive = session?.setRelayActive;
  const [relayList, setRelayList] = useState(buildInitialRelayList);
  const [editingSlot, setEditingSlot] = useState(null);
  const [relayStatus, setRelayStatus] = useState(null);
  const [relayActive, setRelayActiveState] = useState(false);
  const [feeds, setFeeds] = useState([]);

  const refreshStatus = useCallback(() => {
    if (!connected || !getRelayStatus) { setRelayStatus(null); return; }
    getRelayStatus()
      .then(s => { setRelayStatus(s); setRelayActiveState(!!s.active); })
      .catch(() => setRelayStatus(null));
  }, [connected, getRelayStatus]);

  const authedGet = useCallback(async (path) => {
    const token = setupToken(session);
    const r = await fetch(`${backendUrl}/api/v1${path}`, {
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
    return r.ok ? r.json() : null;
  }, [backendUrl, getSessionToken, session?.projectAccessToken]);

  // The source picker's feeds. Failure leaves the picker hidden.
  const refreshFeeds = useCallback(async () => {
    if (!connected || !backendUrl) { setFeeds([]); return; }
    try {
      const feedBody = await authedGet('/feeds');
      setFeeds(feedBody?.feeds || []);
    } catch { /* ignore — source picker just stays hidden */ }
  }, [connected, backendUrl, authedGet]);

  useEffect(() => { refreshStatus(); refreshFeeds(); }, [refreshStatus, refreshFeeds]);

  function persistSlot(slot, updated) {
    if (updated.targetType   !== undefined) setSlotTargetType(slot, updated.targetType);
    if (updated.youtubeKey   !== undefined) setSlotYoutubeKey(slot, updated.youtubeKey);
    if (updated.genericUrl   !== undefined) setSlotGenericUrl(slot, updated.genericUrl);
    if (updated.genericName  !== undefined) setSlotGenericName(slot, updated.genericName);
    if (updated.captionMode  !== undefined) setSlotCaptionMode(slot, updated.captionMode);
    if (updated.scale        !== undefined) setSlotScale(slot, updated.scale ?? '');
    if (updated.fps          !== undefined) setSlotFps(slot, updated.fps ?? null);
    if (updated.videoBitrate !== undefined) setSlotVideoBitrate(slot, updated.videoBitrate ?? '');
    if (updated.audioBitrate !== undefined) setSlotAudioBitrate(slot, updated.audioBitrate ?? '');
    if (updated.recordOnStart !== undefined) setSlotRecordOnStart(slot, !!updated.recordOnStart);
    if (updated.recordOnButton !== undefined) setSlotRecordOnButton(slot, !!updated.recordOnButton);
    if (updated.sourceView     !== undefined) setSlotSourceView(slot, updated.sourceView);
    if (updated.sourceFeedId   !== undefined) setSlotSourceFeedId(slot, updated.sourceFeedId);
  }

  async function persistRelayToBackend(entry) {
    if (!connected || !configureRelay) return;
    const targetType = entry.targetType || 'youtube';
    let targetUrl = null;
    let targetName = null;
    if (targetType === 'youtube') {
      targetUrl = 'rtmp://a.rtmp.youtube.com/live2';
      targetName = (entry.youtubeKey || '').trim() || null;
    } else {
      targetUrl = (entry.genericUrl || '').trim() || null;
      targetName = (entry.genericName || '').trim() || null;
    }
    if (!targetUrl) return;
    try {
      await configureRelay({
        slot: entry.slot,
        targetUrl,
        targetName,
        captionMode: entry.captionMode || 'http',
        recordOnStart: !!entry.recordOnStart,
        recordOnButton: !!entry.recordOnButton,
        scale: entry.scale || undefined,
        fps: entry.fps ?? undefined,
        videoBitrate: entry.videoBitrate || undefined,
        audioBitrate: entry.audioBitrate || undefined,
        // One source field per request (a feed wins over the view): see sourceRequestFields.
        ...sourceRequestFields({ sourceView: entry.sourceView, sourceFeedId: entry.sourceFeedId }),
      });
    } catch { /* ignore */ }
  }

  function updateSlot(slot, updated) {
    setRelayList(list => {
      const next = list.map(r => r.slot === slot ? { ...r, ...updated } : r);
      const entry = next.find(r => r.slot === slot);
      if (entry) {
        persistSlot(slot, entry);
        void persistRelayToBackend(entry);
      }
      return next;
    });
  }

  function addSlot() {
    const used = relayList.map(r => r.slot);
    for (let s = 1; s <= MAX_RELAY_SLOTS; s++) {
      if (!used.includes(s)) {
        const entry = { slot: s, targetType: 'youtube', youtubeKey: '', genericUrl: '', genericName: '', captionMode: 'http', scale: '', fps: null, videoBitrate: '', audioBitrate: '', recordOnStart: false, recordOnButton: false, sourceView: 'program', sourceFeedId: '' };
        setRelayList(list => [...list, entry]);
        setEditingSlot(s);
        return;
      }
    }
  }

  function removeSlot(slot) {
    setRelayList(list => list.filter(r => r.slot !== slot));
    clearSlot(slot);
    setEditingSlot(null);
  }

  async function handleRelayActive(active) {
    try {
      if (!setRelayActive) return;
      await setRelayActive(active);
      setRelayActiveState(active);
      refreshStatus();
    } catch { /* surfaced via refreshStatus() staying at prior state */ }
  }

  const editingEntry = relayList.find(r => r.slot === editingSlot);
  const runningSlots = relayStatus?.runningSlots ?? [];

  return (
    <SetupCard
      id="egress"
      icon={EgressIcon}
      color="cyan"
      title="Egress"
      description="YouTube / generic RTMP relay targets — sourced from Program, Vertical Crop, or any named feed."
      status="ready"
      headerAction={relayList.length < MAX_RELAY_SLOTS ? { label: 'Add', onClick: addSlot } : undefined}
      footerLink={{ label: 'Manage in Broadcast → Settings', href: '/broadcast' }}
    >
      {relayList.length === 0 && (
        <p className="setup-card__empty">No relay targets configured — click Add to set one up.</p>
      )}
      {relayList.map(entry => (
        <SetupItemRow
          key={entry.slot}
          name={slotLabel(entry)}
          meta={slotMeta(entry)}
          badge={runningSlots.includes(entry.slot) ? 'Live' : undefined}
          onSettings={() => setEditingSlot(entry.slot)}
          onDelete={() => removeSlot(entry.slot)}
        />
      ))}

      {connected && (
        <SetupItemRow
          name="Relay status"
          meta={relayActive ? 'Active — will fan-out when stream arrives' : 'Inactive — incoming stream accepted but not relayed'}
          toggleOn={relayActive}
          onToggle={() => handleRelayActive(!relayActive)}
        />
      )}

      {editingEntry && (
        <Dialog title={`${slotLabel(editingEntry)} (slot ${editingEntry.slot})`} onClose={() => setEditingSlot(null)}>
          <RelaySlotRow
            entry={editingEntry}
            onChange={updated => updateSlot(editingEntry.slot, updated)}
            onRemove={() => removeSlot(editingEntry.slot)}
            runningSlots={runningSlots}
            feeds={feeds}
          />
        </Dialog>
      )}
    </SetupCard>
  );
}
