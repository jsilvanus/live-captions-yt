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
  setSlotRecordOnStart, setSlotRecordOnButton,
  clearSlot, buildInitialRelayList,
} from '../../lib/relayConfig.js';

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
 * EgressSection — YouTube/generic RTMP relay targets (4 slots), wired to the
 * same client-side `relayConfig.js` localStorage data the Broadcast →
 * Settings → Stream tab uses (see `StreamTab.jsx`/`RelayPanel.jsx`). Reuses
 * `RelaySlotRow` (the same per-slot editor) as Dialog content instead of
 * RelayPanel's own always-inline expanding rows.
 *
 * No `/setup/egress/page` parity route: unlike the device managers, there's
 * no standalone page that's *just* this — `/broadcast` also covers Encoder
 * and YouTube auth config, so the footer link goes there directly instead of
 * through a parity banner.
 */
export function EgressSection() {
  const session = useSessionContext();
  const [relayList, setRelayList] = useState(buildInitialRelayList);
  const [editingSlot, setEditingSlot] = useState(null);
  const [relayStatus, setRelayStatus] = useState(null);
  const [relayActive, setRelayActiveState] = useState(false);

  const refreshStatus = useCallback(() => {
    if (!session?.connected) { setRelayStatus(null); return; }
    session.getRelayStatus()
      .then(s => { setRelayStatus(s); setRelayActiveState(!!s.active); })
      .catch(() => setRelayStatus(null));
  }, [session]);

  useEffect(() => { refreshStatus(); }, [refreshStatus]);

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
  }

  async function persistRelayToBackend(entry) {
    if (!session?.connected) return;
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
      await session.configureRelay({
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
      });
    } catch { /* ignore */ }
  }

  function updateSlot(slot, updated) {
    setRelayList(list => {
      const next = list.map(r => r.slot === slot ? { ...r, ...updated } : r);
      const entry = next.find(r => r.slot === slot);
      if (entry) persistSlot(slot, entry);
      if (entry) { void persistRelayToBackend(entry); }
      return next;
    });
  }

  function addSlot() {
    const used = relayList.map(r => r.slot);
    for (let s = 1; s <= MAX_RELAY_SLOTS; s++) {
      if (!used.includes(s)) {
        const entry = { slot: s, targetType: 'youtube', youtubeKey: '', genericUrl: '', genericName: '', captionMode: 'http', scale: '', fps: null, videoBitrate: '', audioBitrate: '', recordOnStart: false, recordOnButton: false };
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
      await session.setRelayActive(active);
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
      description="YouTube / generic RTMP relay targets — 4-slot configuration."
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

      {session?.connected && (
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
          />
        </Dialog>
      )}
    </SetupCard>
  );
}
