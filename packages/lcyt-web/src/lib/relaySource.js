/**
 * Pure helpers for the relay slot's source picker (plan_feeds_devices.md PR 5). A slot relays from the
 * program stream, the vertical crop, or a named feed (`sourceFeedId`). Older slots may still carry only
 * `sourceCameraId`; those keep working until the user picks something else. No React here, so node tests
 * can import this file.
 */
import { isLinkableFeed } from './deviceFeeds.js';

/** Picker groups in display order. Unknown kinds count as generic. */
export const SOURCE_GROUP_ORDER = Object.freeze(['camera', 'generic', 'dsk']);

const FEED_PREFIX = 'feed:';
const LEGACY_CAMERA_PREFIX = 'legacy-camera:';

/** Named feeds the relay may read from. Managed feeds (`managed:*`, the Video and DSK slots) are left out. */
export function relaySelectableFeeds(feeds) {
  return (feeds || []).filter(isLinkableFeed);
}

function kindOf(feed) {
  return SOURCE_GROUP_ORDER.includes(feed.kind) ? feed.kind : 'generic';
}

/**
 * The selectable feeds grouped by kind, in SOURCE_GROUP_ORDER. Empty groups are left out.
 * @returns {Array<{ kind: 'camera'|'generic'|'dsk', feeds: object[] }>}
 */
export function groupRelaySourceFeeds(feeds) {
  const selectable = relaySelectableFeeds(feeds);
  return SOURCE_GROUP_ORDER
    .map(kind => ({ kind, feeds: selectable.filter(f => kindOf(f) === kind) }))
    .filter(group => group.feeds.length > 0);
}

/** Option text for a feed: a generic feed shows its label after the name ("Mixer 2 (program)"). */
export function feedOptionLabel(feed) {
  const name = feed.name || feed.feedKey || feed.id;
  return kindOf(feed) === 'generic' && feed.label ? `${name} (${feed.label})` : name;
}

/** The selectable feed linked to a camera (the first one GET /feeds returns), or null. */
export function linkedFeedForCamera(feeds, cameraId) {
  if (!cameraId) return null;
  return relaySelectableFeeds(feeds).find(f => f.deviceType === 'camera' && f.deviceId === cameraId) || null;
}

/**
 * The <select> value that shows a slot's source. A legacy camera slot shows the feed linked to that camera
 * when there is one, otherwise a read-only `legacy-camera:` option.
 * @returns {'program'|'crop'|`feed:${string}`|`legacy-camera:${string}`}
 */
export function relaySourceValue(entry, feeds) {
  if (entry.sourceFeedId) return `${FEED_PREFIX}${entry.sourceFeedId}`;
  if (entry.sourceCameraId) {
    const linked = linkedFeedForCamera(feeds, entry.sourceCameraId);
    return linked ? `${FEED_PREFIX}${linked.id}` : `${LEGACY_CAMERA_PREFIX}${entry.sourceCameraId}`;
  }
  return entry.sourceView === 'crop' ? 'crop' : 'program';
}

/** Whether a value from relaySourceValue is a feed id. */
export function isFeedSourceValue(value) {
  return typeof value === 'string' && value.startsWith(FEED_PREFIX);
}

/** The feed id inside a `feed:` value. */
export function feedIdFromSourceValue(value) {
  return isFeedSourceValue(value) ? value.slice(FEED_PREFIX.length) : '';
}

/**
 * The slot fields a user's pick writes. Picking a feed clears the camera field, so a slot never holds both.
 * A legacy camera option cannot be picked (it is disabled), so it returns null and nothing changes.
 * @returns {{ sourceView: string, sourceFeedId: string, sourceCameraId: string } | null}
 */
export function sourcePatch(value) {
  if (value === 'program' || value === 'crop') return { sourceView: value, sourceFeedId: '', sourceCameraId: '' };
  if (isFeedSourceValue(value)) return { sourceView: 'program', sourceFeedId: feedIdFromSourceValue(value), sourceCameraId: '' };
  return null;
}

/**
 * The source fields of a POST/PUT /stream body. A feed wins over a camera and the camera wins over the view,
 * so only one of sourceFeedId / sourceCameraId is ever sent (the backend rejects both together).
 */
export function sourceRequestFields({ sourceView, sourceFeedId, sourceCameraId } = {}) {
  if (sourceFeedId) return { sourceFeedId };
  if (sourceCameraId) return { sourceCameraId };
  return sourceView ? { sourceView } : {};
}
