/**
 * Pure helpers for the relay slot's source picker (plan_feeds_devices.md PR 5). A slot relays from the
 * program stream, the vertical crop, or a named feed (`sourceFeedId`). Camera-sourced slots became feed-sourced
 * (feeds-and-devices PR 7: the backend copies them), so no camera field is read here. No React here, so node tests
 * can import this file.
 */
import { isLinkableFeed } from './deviceFeeds.js';

/** Picker groups in display order. Unknown kinds count as generic. */
export const SOURCE_GROUP_ORDER = Object.freeze(['camera', 'generic', 'dsk']);

const FEED_PREFIX = 'feed:';

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

/**
 * The <select> value that shows a slot's source.
 * @returns {'program'|'crop'|`feed:${string}`}
 */
export function relaySourceValue(entry) {
  if (entry.sourceFeedId) return `${FEED_PREFIX}${entry.sourceFeedId}`;
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
 * The slot fields a user's pick writes. Picking a feed sets the feed and the view stays 'program'.
 * @returns {{ sourceView: string, sourceFeedId: string } | null}
 */
export function sourcePatch(value) {
  if (value === 'program' || value === 'crop') return { sourceView: value, sourceFeedId: '' };
  if (isFeedSourceValue(value)) return { sourceView: 'program', sourceFeedId: feedIdFromSourceValue(value) };
  return null;
}

/**
 * The source fields of a POST/PUT /stream body. A feed wins over the view, so only one source field is ever sent.
 */
export function sourceRequestFields({ sourceView, sourceFeedId } = {}) {
  if (sourceFeedId) return { sourceFeedId };
  return sourceView ? { sourceView } : {};
}
