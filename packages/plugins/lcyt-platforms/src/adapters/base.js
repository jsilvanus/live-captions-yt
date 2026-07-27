/**
 * Platform adapter interface.
 *
 * Documented, not enforced — this repo is plain JS and the surface is small,
 * so the contract lives in JSDoc plus `assertAdapterShape()` for tests rather
 * than in a class hierarchy nobody would subclass more than twice.
 *
 * The point of the interface is that a second provider is a new file, not a
 * redesign: everything platform-specific (OAuth endpoints, resource names,
 * status vocabularies, stats field names) is confined behind these methods,
 * and every caller above them — routes, poller, frontend — speaks only the
 * neutral shapes below.
 *
 * See docs/plans/plan_broadcast_platform_sync.md § "Design principle".
 *
 * @typedef {object} TokenSet
 * @property {string} accessToken
 * @property {string} [refreshToken]  omitted by refresh calls that don't rotate it
 * @property {number} expiresIn       seconds until the access token expires
 * @property {string} [externalAccountId]
 * @property {string} [accountLabel]
 * @property {string} [scopes]        space-joined, as actually granted
 *
 * @typedef {object} ScheduledBroadcast
 * @property {string} externalBroadcastId
 * @property {string} [externalStreamId]
 * @property {string} [streamKey]     CDN stream name, for caption_targets binding
 * @property {string} [ingestUrl]
 *
 * @typedef {object} LiveStats
 * @property {number|null} concurrentViewers
 *
 * @typedef {object} PostBroadcastStats
 * @property {number|null} views
 * @property {number|null} averageWatchTimeSec
 * @property {number|null} peakConcurrentViewers
 *
 * @typedef {object} PlatformAdapter
 * @property {string} platform
 * @property {string[]} scopes
 * @property {(state: string, redirectUri: string, cfg: object) => string} buildAuthUrl
 * @property {(code: string, redirectUri: string, cfg: object) => Promise<TokenSet>} exchangeCode
 * @property {(refreshToken: string, cfg: object) => Promise<TokenSet>} refreshAccessToken
 * @property {(accessToken: string) => Promise<{externalAccountId: string, accountLabel: string}>} getAccountIdentity
 * @property {(accessToken: string) => Promise<object[]>} listUpcoming
 * @property {(accessToken: string, fields: object) => Promise<ScheduledBroadcast>} createScheduled
 * @property {(accessToken: string, externalBroadcastId: string, fields: object) => Promise<void>} updateSchedule
 * @property {(accessToken: string, externalBroadcastId: string, status: 'live'|'complete'|'testing') => Promise<{status: string}>} transition
 * @property {(accessToken: string, externalBroadcastId: string, image: Buffer, mimeType: string) => Promise<{thumbnailUrl: string|null}>} setThumbnail
 * @property {(accessToken: string, externalStreamId: string) => Promise<{streamKey: string|null, ingestUrl: string|null}>} getStreamKey
 * @property {(accessToken: string, externalBroadcastId: string) => Promise<LiveStats>} getLiveStats
 * @property {(accessToken: string, externalBroadcastId: string, opts?: object) => Promise<PostBroadcastStats>} getPostBroadcastStats
 */

/** Every method an adapter must expose. */
export const REQUIRED_ADAPTER_METHODS = Object.freeze([
  'buildAuthUrl',
  'exchangeCode',
  'refreshAccessToken',
  'getAccountIdentity',
  'listUpcoming',
  'createScheduled',
  'updateSchedule',
  'transition',
  'setThumbnail',
  'getStreamKey',
  'getLiveStats',
  'getPostBroadcastStats',
]);

/**
 * Throws unless `adapter` implements the full interface. Used by tests (both
 * the real YouTube adapter and the Facebook skeleton run through it) so an
 * adapter that quietly omits a method fails at authoring time rather than at
 * the first route that calls it.
 *
 * @param {object} adapter
 * @param {string} [label]
 */
export function assertAdapterShape(adapter, label = 'adapter') {
  if (!adapter || typeof adapter !== 'object') {
    throw new TypeError(`${label} must be an object`);
  }
  if (typeof adapter.platform !== 'string' || !adapter.platform) {
    throw new TypeError(`${label}.platform must be a non-empty string`);
  }
  if (!Array.isArray(adapter.scopes)) {
    throw new TypeError(`${label}.scopes must be an array`);
  }
  const missing = REQUIRED_ADAPTER_METHODS.filter(m => typeof adapter[m] !== 'function');
  if (missing.length) {
    throw new TypeError(`${label} is missing required method(s): ${missing.join(', ')}`);
  }
}

/**
 * Normalize the `expiresIn` an OAuth token response reports into the absolute
 * ISO timestamp the DB stores.
 *
 * No trailing `Z`, per this repo's timestamp convention (see root CLAUDE.md —
 * YouTube's own API format).
 *
 * @param {number} expiresIn seconds
 * @param {number} [now] epoch ms, injectable for tests
 * @returns {string}
 */
export function expiryFromNow(expiresIn, now = Date.now()) {
  const seconds = Number.isFinite(expiresIn) ? expiresIn : 0;
  return new Date(now + seconds * 1000).toISOString().replace(/Z$/, '');
}
