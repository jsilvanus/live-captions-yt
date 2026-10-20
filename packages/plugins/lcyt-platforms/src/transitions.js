/**
 * Platform transitions for the broadcast lifecycle service, without an HTTP
 * request: the same link lookup, adapter call and link update as the
 * `go-live` / `end` routes, for a broadcast that already has a platform link.
 *
 * A broadcast with no link on the platform is not an error here: the lifecycle
 * stages and goes live without YouTube (captions or outputs only), so the
 * result says `skipped`.
 */
import { getLink, updateLink, getCredential, getDefaultCredential } from './db.js';

/**
 * @param {import('lcyt-backend/db').Db} db
 * @param {{ getAdapter: (platform: string) => object|null, getAccessToken: (credentialId: string) => Promise<string>, eventBus?: { publish: Function }|null }} deps
 */
export function createPlatformTransitions(db, { getAdapter, getAccessToken, eventBus = null }) {
  /**
   * @param {string} apiKey
   * @param {string} broadcastId
   * @param {'live'|'complete'} target  the platform's own status words
   * @param {string} [platform]
   * @returns {Promise<{ skipped: true, reason: string }|{ skipped: false, status: string }>}
   */
  async function transition(apiKey, broadcastId, target, platform = 'youtube') {
    const adapter = getAdapter(platform);
    if (!adapter) return { skipped: true, reason: `${platform} is not supported` };
    const link = await getLink(db, broadcastId, platform);
    if (!link) return { skipped: true, reason: `not linked to ${platform}` };

    let credential = link.credential_id ? await getCredential(db, apiKey, link.credential_id) : null;
    if (!credential) {
      const resolved = await getDefaultCredential(db, apiKey, platform);
      if (!resolved.ok) throw new Error(`No usable ${platform} account (${resolved.reason})`);
      credential = resolved.credential;
    }
    if (credential.revoked_at) throw new Error(`The ${platform} account was disconnected; reconnect it first`);

    try {
      const accessToken = await getAccessToken(credential.id);
      const { status } = await adapter.transition(accessToken, link.external_broadcast_id, target);
      await updateLink(db, link.id, { lastStatus: target, lastSyncError: null });
      eventBus?.publish?.(apiKey, 'platform.status_changed', { broadcastId, platform, status: target });
      return { skipped: false, status };
    } catch (err) {
      await updateLink(db, link.id, { lastSyncError: err.message }).catch(() => {});
      throw err;
    }
  }

  /** Mark the link not live without completing the platform broadcast (a stop that may go up again). */
  async function markStopped(broadcastId, platform = 'youtube') {
    const link = await getLink(db, broadcastId, platform);
    if (!link) return false;
    await updateLink(db, link.id, { lastStatus: 'stopped' });
    return true;
  }

  return { transition, markStopped };
}
