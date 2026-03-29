// All canonical localStorage keys — use these instead of raw strings
export const KEYS = {
  backend: {
    features: 'lcyt.backend.features',
    preset: 'lcyt.backend.preset',
  },
  session: {
    config: 'lcyt.session.config',
    autoConnect: 'lcyt.session.autoConnect',
    backendUrl: 'lcyt.session.backendUrl',
    token: 'lcyt.session.token',
  },
  ui: {
    theme: 'lcyt.ui.theme',
    textSize: 'lcyt.ui.textSize',
    sentPanelWidth: 'lcyt.ui.sentPanelWidth',
    sentPanelWrap: 'lcyt.ui.sentPanelWrap',
    advancedMode: 'lcyt.ui.advancedMode',
    privacyAccepted: 'lcyt.ui.privacyAccepted',
    sidebarExpanded: 'lcyt.ui.sidebarExpanded',
  },
  audio: {
    deviceId: 'lcyt.audio.deviceId',
    holdToSpeak: 'lcyt.audio.holdToSpeak',
    utteranceEndButton: 'lcyt.audio.utteranceEndButton',
    utteranceEndTimer: 'lcyt.audio.utteranceEndTimer',
    transcriptionOffset: 'lcyt.audio.transcriptionOffset',
    clientVad: 'lcyt.audio.clientVad',
    clientVadSilenceMs: 'lcyt.audio.clientVadSilenceMs',
    clientVadThreshold: 'lcyt.audio.clientVadThreshold',
    musicDetect:          'lcyt.audio.musicDetect',
    musicDetectBpm:       'lcyt.audio.musicDetectBpm',
    musicDetectThreshold: 'lcyt.audio.musicDetectThreshold',
    musicDetectInterval:  'lcyt.audio.musicDetectInterval',
  },
  captions: {
    batchInterval: 'lcyt.captions.batchInterval',
  },
  targets: {
    list: 'lcyt.targets.list',
  },
  translation: {
    vendor: 'lcyt.translation.vendor',
    vendorKey: 'lcyt.translation.vendorKey',
    libreUrl: 'lcyt.translation.libreUrl',
    libreKey: 'lcyt.translation.libreKey',
    showOriginal: 'lcyt.translation.showOriginal',
    list: 'lcyt.translation.list',
  },
  relay: {
    mode: 'lcyt.relay.mode',
  },
  dashboard: {
    config: 'lcyt.dashboard',
  },
};

/** Dynamic key builder for relay per-slot fields */
export function relaySlotKey(slot, field) {
  return `lcyt.relay.slot${slot}.${field}`;
}

/** Dynamic key builder for broadcast keys */
export function broadcastKey(key) {
  return `lcyt.broadcast.${key}`;
}

/**
 * One-time migration from old localStorage keys to new dot-notation keys.
 * Guarded by lcyt.migrated.v1 flag.
 */
export function migrateStorageKeys() {
  try {
    if (localStorage.getItem('lcyt.migrated.v1') === '1') return;

    const migrate = (oldKey, newKey) => {
      try {
        const val = localStorage.getItem(oldKey);
        if (val !== null && localStorage.getItem(newKey) === null) {
          localStorage.setItem(newKey, val);
        }
      } catch {}
    };

    // Session
    migrate('lcyt-config',         KEYS.session.config);
    migrate('lcyt-autoconnect',    KEYS.session.autoConnect);
    migrate('lcyt-backend-url',    KEYS.session.backendUrl);
    migrate('lcyt-token',          KEYS.session.token);

    // UI
    migrate('lcyt-theme',              KEYS.ui.theme);
    migrate('lcyt:textSize',           KEYS.ui.textSize);
    migrate('lcyt:sent-panel-w',       KEYS.ui.sentPanelWidth);
    migrate('lcyt:sent-panel-wrap',    KEYS.ui.sentPanelWrap);
    migrate('lcyt:advanced-mode',      KEYS.ui.advancedMode);
    migrate('lcyt:privacyAccepted',    KEYS.ui.privacyAccepted);
    migrate('lcyt.sidebar.expanded',   KEYS.ui.sidebarExpanded);

    // Audio
    migrate('lcyt:audioDeviceId',           KEYS.audio.deviceId);
    migrate('lcyt:hold-to-speak',           KEYS.audio.holdToSpeak);
    migrate('lcyt:utterance-end-button',    KEYS.audio.utteranceEndButton);
    migrate('lcyt:utterance-end-timer',     KEYS.audio.utteranceEndTimer);
    migrate('lcyt:transcription-offset',    KEYS.audio.transcriptionOffset);
    migrate('lcyt:client-vad',              KEYS.audio.clientVad);
    migrate('lcyt:client-vad-silence-ms',   KEYS.audio.clientVadSilenceMs);
    migrate('lcyt:client-vad-threshold',    KEYS.audio.clientVadThreshold);

    // Captions
    migrate('lcyt-batch-interval', KEYS.captions.batchInterval);

    // Targets
    migrate('lcyt:caption-targets', KEYS.targets.list);

    // Translation
    migrate('lcyt:translation-vendor',        KEYS.translation.vendor);
    migrate('lcyt:translation-vendor-key',    KEYS.translation.vendorKey);
    migrate('lcyt:translation-libre-url',     KEYS.translation.libreUrl);
    migrate('lcyt:translation-libre-key',     KEYS.translation.libreKey);
    migrate('lcyt:translation-show-original', KEYS.translation.showOriginal);
    migrate('lcyt:translations',              KEYS.translation.list);
    // Legacy keys to remove (no new equivalent)
    try { localStorage.removeItem('lcyt:translation-enabled'); } catch {}
    try { localStorage.removeItem('lcyt:translation-target-lang'); } catch {}

    // Relay
    migrate('lcyt-relay-mode', KEYS.relay.mode);
    // Relay slot 1 (old flat keys)
    migrate('lcyt-relay-target-type',  relaySlotKey(1, 'type'));
    migrate('lcyt-relay-youtube-key',  relaySlotKey(1, 'ytKey'));
    migrate('lcyt-relay-generic-url',  relaySlotKey(1, 'genericUrl'));
    migrate('lcyt-relay-generic-name', relaySlotKey(1, 'genericName'));
    migrate('lcyt-relay-caption-mode', relaySlotKey(1, 'captionMode'));
    // Relay slots 2-4 (old per-slot dash keys)
    for (let n = 2; n <= 4; n++) {
      migrate(`lcyt-relay-slot-${n}-type`,          relaySlotKey(n, 'type'));
      migrate(`lcyt-relay-slot-${n}-yt-key`,        relaySlotKey(n, 'ytKey'));
      migrate(`lcyt-relay-slot-${n}-generic-url`,   relaySlotKey(n, 'genericUrl'));
      migrate(`lcyt-relay-slot-${n}-generic-name`,  relaySlotKey(n, 'genericName'));
      migrate(`lcyt-relay-slot-${n}-caption-mode`,  relaySlotKey(n, 'captionMode'));
      migrate(`lcyt-relay-slot-${n}-scale`,         relaySlotKey(n, 'scale'));
      migrate(`lcyt-relay-slot-${n}-fps`,           relaySlotKey(n, 'fps'));
      migrate(`lcyt-relay-slot-${n}-video-bitrate`, relaySlotKey(n, 'videoBitrate'));
      migrate(`lcyt-relay-slot-${n}-audio-bitrate`, relaySlotKey(n, 'audioBitrate'));
    }

    // Broadcast keys (scan for lcyt:broadcast:* and copy to lcyt.broadcast.*)
    try {
      const broadcastKeys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('lcyt:broadcast:')) broadcastKeys.push(k);
      }
      for (const oldK of broadcastKeys) {
        const suffix = oldK.slice('lcyt:broadcast:'.length);
        migrate(oldK, broadcastKey(suffix));
      }
    } catch {}

    localStorage.setItem('lcyt.migrated.v1', '1');
  } catch {}
}
