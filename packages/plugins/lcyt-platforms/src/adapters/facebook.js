/**
 * Facebook Live adapter — SKELETON ONLY, NOT WIRED.
 *
 * This file exists to prove the `base.js` interface generalises past YouTube,
 * per resolved decision #3. It is deliberately:
 *   - not registered in adapters/index.js, so no route can reach it;
 *   - accompanied by no OAuth app registration and no frontend;
 *   - throwing on every call rather than half-working.
 *
 * If you are picking up the Facebook phase, the real long pole is NOT this
 * file. It is **Meta App Review**: `read_insights` and the pages permissions
 * below require approval before anyone outside the developer's own test roles
 * can use the integration at all. Budget for that review process
 * independently of the code — the plan explicitly warns against scoping this
 * as "a day of adapter work".
 *
 * Two structural differences from YouTube that the interface accommodates but
 * an implementer must design around:
 *
 *   1. Page access tokens are long-lived rather than classically refreshed.
 *      `refreshAccessToken` degrades to a re-exchange (exchange a short-lived
 *      user token for a long-lived one, then read the page token) rather than
 *      a refresh-token grant. The interface allows this because refresh
 *      behaviour is per-adapter.
 *   2. `LIVE_NOW` requires an RTMP publisher to already be pushing bits.
 *      YouTube lets a broadcast and its stream be bound and transitioned
 *      independently; Facebook does not. A `transition(..., 'live')` here has
 *      to either wait for the encoder or report a distinct "not yet
 *      publishing" state — it cannot simply mirror the YouTube call.
 *
 * See docs/plans/plan_broadcast_platform_sync.md § "Facebook Live (deferred)".
 */

const NOT_IMPLEMENTED = 'facebook adapter not implemented — see '
  + 'docs/plans/plan_broadcast_platform_sync.md § "Facebook Live (deferred)"';

/** @param {string} detail what a real implementation would do here */
function notImplemented(detail) {
  const err = new Error(`${NOT_IMPLEMENTED} (${detail})`);
  err.name = 'NotImplementedError';
  throw err;
}

export const facebookAdapter = {
  platform: 'facebook',

  /**
   * Facebook Login for Business scopes. `read_insights` is what post-broadcast
   * stats need, and is the permission most likely to hold up App Review.
   */
  scopes: [
    'pages_show_list',
    'pages_manage_posts',
    'pages_read_engagement',
    'read_insights',
  ],

  // TODO: https://www.facebook.com/v21.0/dialog/oauth with client_id,
  // redirect_uri, state, scope, response_type=code.
  buildAuthUrl() { return notImplemented('GET /dialog/oauth'); },

  // TODO: GET /v21.0/oauth/access_token (code → short-lived user token), then
  // exchange for a long-lived token, then GET /me/accounts to pick the page
  // and read its page-scoped token.
  exchangeCode() { return notImplemented('GET /oauth/access_token + /me/accounts'); },

  // TODO: no refresh grant exists — re-exchange for a long-lived token instead.
  refreshAccessToken() { return notImplemented('long-lived token re-exchange, not a refresh grant'); },

  // TODO: GET /me/accounts → page id + name.
  getAccountIdentity() { return notImplemented('GET /me/accounts'); },

  // TODO: GET /{page-id}/live_videos?broadcast_status=["SCHEDULED_UNPUBLISHED"]
  listUpcoming() { return notImplemented('GET /{page-id}/live_videos'); },

  // TODO: POST /{page-id}/live_videos with status=SCHEDULED_UNPUBLISHED and
  // planned_start_time; the response's secure_stream_url is the RTMP ingest
  // URL, analogous to a YouTube stream key.
  createScheduled() { return notImplemented('POST /{page-id}/live_videos'); },

  // TODO: POST /{live-video-id} with the changed fields.
  updateSchedule() { return notImplemented('POST /{live-video-id}'); },

  // TODO: POST /{live-video-id} with status=LIVE_NOW | STOPPED. See caveat 2
  // in the file header — LIVE_NOW fails unless an encoder is already pushing.
  transition() { return notImplemented('POST /{live-video-id} status=LIVE_NOW|STOPPED'); },

  // TODO: the `picture` param at creation time, or POST /{live-video-id}/thumbnails.
  setThumbnail() { return notImplemented('POST /{live-video-id}/thumbnails'); },

  // TODO: read secure_stream_url off the live_video resource.
  getStreamKey() { return notImplemented('GET /{live-video-id}?fields=secure_stream_url'); },

  // TODO: GET /{live-video-id}?fields=live_views
  getLiveStats() { return notImplemented('GET /{live-video-id}?fields=live_views'); },

  // TODO: Video Insights — total_video_views and average watch time. Requires
  // read_insights, which requires App Review.
  getPostBroadcastStats() { return notImplemented('GET /{video-id}/video_insights'); },
};

export default facebookAdapter;
