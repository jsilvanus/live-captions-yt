import { KEYS, relaySlotKey } from '../../../lib/storageKeys.js';
import { DRAFT_KEY, ALL_FEATURE_CODES } from './constants.js';

/**
 * Persist wizard state to localStorage and sync changed features to the backend.
 *
 * @param {{
 *   selectedFeatures: Set<string>,
 *   configs: Record<string, object>,
 *   localSettings: object,
 *   updateFeature: (code: string, enabled: boolean, config?: object|null) => Promise<void>,
 *   initialFeatureSet: Set<string>,
 *   initialConfigs: Record<string, object>,
 *   hasBackend: boolean,
 * }} opts
 */
export async function saveWizard({
  selectedFeatures,
  configs,
  localSettings,
  updateFeature,
  initialFeatureSet,
  initialConfigs,
  hasBackend,
}) {
  function set(key, val) {
    try { localStorage.setItem(key, String(val)); } catch {}
  }
  function setJson(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
  }

  // 1. Write localStorage — targets
  setJson(KEYS.targets.list, localSettings.targets || []);

  // 2. Write localStorage — translation
  set(KEYS.translation.vendor,        localSettings.translationVendor || 'mymemory');
  set(KEYS.translation.vendorKey,     localSettings.translationVendorKey || '');
  set(KEYS.translation.libreUrl,      localSettings.translationLibreUrl || '');
  set(KEYS.translation.libreKey,      localSettings.translationLibreKey || '');
  set(KEYS.translation.showOriginal,  String(!!localSettings.translationShowOriginal));
  setJson(KEYS.translation.list,      localSettings.translationList || []);

  // 3. Write localStorage — relay slots
  (localSettings.relaySlots || []).forEach(slot => {
    set(relaySlotKey(slot.slot, 'type'),         slot.type || 'youtube');
    set(relaySlotKey(slot.slot, 'ytKey'),        slot.ytKey || '');
    set(relaySlotKey(slot.slot, 'genericUrl'),   slot.genericUrl || '');
    set(relaySlotKey(slot.slot, 'genericName'),  slot.genericName || '');
    set(relaySlotKey(slot.slot, 'captionMode'),  slot.captionMode || 'http');
    if (slot.scale)        set(relaySlotKey(slot.slot, 'scale'),        slot.scale);
    if (slot.fps != null)  set(relaySlotKey(slot.slot, 'fps'),          String(slot.fps));
    if (slot.videoBitrate) set(relaySlotKey(slot.slot, 'videoBitrate'), slot.videoBitrate);
    if (slot.audioBitrate) set(relaySlotKey(slot.slot, 'audioBitrate'), slot.audioBitrate);
  });

  // 4. Diff + write backend features
  if (hasBackend && typeof updateFeature === 'function') {
    for (const code of ALL_FEATURE_CODES) {
      const wasEnabled = initialFeatureSet.has(code);
      const isEnabled  = selectedFeatures.has(code);
      const cfg        = configs[code] ?? null;
      const initCfg    = initialConfigs[code] ?? null;
      const cfgChanged = isEnabled && JSON.stringify(cfg) !== JSON.stringify(initCfg);

      if (isEnabled !== wasEnabled || cfgChanged) {
        await updateFeature(code, isEnabled, cfg);
      }
    }
  }

  // 5. Clear draft
  try { localStorage.removeItem(DRAFT_KEY); } catch {}
}
