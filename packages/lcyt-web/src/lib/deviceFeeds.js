/**
 * Pure helpers for the Devices card and the feed links shown on it (plan_feeds_devices.md PR 4).
 *
 * A feed is linked to a device with `PATCH /feeds/:id { deviceType, deviceId }` and unlinked with
 * `{ deviceType: null, deviceId: null }`. Any named feed can go to any device, whatever its kind or label;
 * the two managed feeds (`managed:video`, `managed:dsk`) cannot be linked. No React here, so node tests can
 * import this file.
 */

/** Device kinds a feed can link to (the backend's DEVICE_TYPES). */
export const DEVICE_TYPES = ['camera', 'mixer', 'encoder'];

/** Window event: a feed was added, edited, deleted or linked. Feed lists listen and reload. */
export const FEEDS_CHANGED_EVENT = 'lcyt:feeds-changed';

export function notifyFeedsChanged() {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  window.dispatchEvent(new Event(FEEDS_CHANGED_EVENT));
}

/** A real feed row (not the synthesized DSK entry), so it may be linked to a device. The main feed counts. */
export function isLinkableFeed(feed) {
  return !!feed && !feed.managed && !String(feed.id || '').startsWith('managed:');
}

export function linkableFeeds(feeds) {
  return (feeds || []).filter(isLinkableFeed);
}

/** The named feeds linked to one device, in the order GET /feeds returns them. */
export function feedsLinkedTo(feeds, deviceType, deviceId) {
  return linkableFeeds(feeds).filter(f => f.deviceType === deviceType && f.deviceId === deviceId);
}

/** Named feeds that could be linked to this device now (all except those already linked to it). */
export function linkCandidates(feeds, deviceType, deviceId) {
  return linkableFeeds(feeds).filter(f => !(f.deviceType === deviceType && f.deviceId === deviceId));
}

/** Request body that links a feed to a device. */
export function linkBody(deviceType, deviceId) {
  return { deviceType, deviceId };
}

/** Request body that clears a feed's device link. */
export const UNLINK_BODY = Object.freeze({ deviceType: null, deviceId: null });

/**
 * Device id -> display name, from the three list responses (`GET /production/cameras|mixers|encoders`).
 * A list that failed or is missing is simply left out, so the caller falls back to the id.
 * @param {{camera?: any[], mixer?: any[], encoder?: any[]}} lists
 * @returns {Map<string, string>} keyed by `${deviceType}:${id}`
 */
export function buildDeviceNames(lists) {
  const names = new Map();
  for (const type of DEVICE_TYPES) {
    for (const device of Array.isArray(lists?.[type]) ? lists[type] : []) {
      if (device?.id == null) continue;
      names.set(`${type}:${device.id}`, device.name || String(device.id));
    }
  }
  return names;
}

export function deviceNameKey(deviceType, deviceId) {
  return `${deviceType}:${deviceId}`;
}
