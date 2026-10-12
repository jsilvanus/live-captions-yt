import logger from 'lcyt/logger';
import { YoutubeLiveCaptionSender } from 'lcyt';
import { getCaptionTargets } from './db.js';

/**
 * Validate and build the extraTargets array from the client-supplied targets list.
 * Returns { ok: true, extraTargets } or { ok: false, error }.
 *
 * Each enabled YouTube target gets a new YoutubeLiveCaptionSender started.
 * Each enabled generic target is stored with its parsed headers object.
 *
 * When `targets` is `undefined` (the field was omitted entirely, as opposed to
 * an explicit empty array) and `db`/`apiKey` are supplied, the project's saved
 * caption-target defaults are loaded and used instead — this lets a thin client
 * start a session with just `{ apiKey, domain }` and still get its configured
 * delivery targets. An explicit array (including `[]`) is always used as-is.
 *
 * @param {Array|undefined} targets  Raw array from POST/PATCH /live body
 * @param {{ db?: import('better-sqlite3').Database, apiKey?: string }} [opts]
 * @returns {Promise<{ ok: boolean, extraTargets?: Array, rawTargets?: Array, error?: string }>}
 */
export async function buildExtraTargets(targets, { db, apiKey } = {}) {
  if (targets === undefined) {
    targets = (db && apiKey)
      ? (await getCaptionTargets(db, apiKey))
        .filter(t => t.enabled)
        .map(t => ({ id: t.id, type: t.type, streamKey: t.streamKey, url: t.url, headers: t.headers, viewerKey: t.viewerKey, noBatch: t.noBatch }))
      : [];
  }
  if (!Array.isArray(targets) || targets.length === 0) return { ok: true, extraTargets: [], rawTargets: [] };

  const extraTargets = [];
  /** The accepted targets in their stored form, so a session can be rebuilt on another instance. */
  const rawTargets = [];
  for (const target of targets) {
    if (!target || !['youtube', 'generic', 'viewer'].includes(target.type)) {
      return { ok: false, error: `Invalid target type: ${target?.type}` };
    }

    if (target.type === 'youtube') {
      if (!target.streamKey || typeof target.streamKey !== 'string') continue;
      const sender = new YoutubeLiveCaptionSender({ streamKey: target.streamKey.trim() });
      try { sender.start(); } catch (err) {
        logger.warn(`[live] Failed to start extra YouTube target ${target.id}: ${err?.message}`);
      }
      extraTargets.push({ id: target.id, type: 'youtube', sender });
      rawTargets.push({ id: target.id, type: 'youtube', streamKey: target.streamKey.trim(), noBatch: target.noBatch });

    } else if (target.type === 'generic') {
      if (!target.url || typeof target.url !== 'string') {
        return { ok: false, error: 'Generic target requires a url field' };
      }
      try {
        const u = new URL(target.url);
        if (u.protocol !== 'https:' && u.protocol !== 'http:') {
          return { ok: false, error: `Generic target URL must use http or https: ${target.url}` };
        }
      } catch {
        return { ok: false, error: `Invalid generic target URL: ${target.url}` };
      }
      // headers arrive pre-parsed as an object (the client JSON.parse'd the textarea string)
      const headers = (target.headers && typeof target.headers === 'object' && !Array.isArray(target.headers))
        ? target.headers
        : {};
      extraTargets.push({ id: target.id, type: 'generic', url: target.url, headers });
      rawTargets.push({ id: target.id, type: 'generic', url: target.url, headers, noBatch: target.noBatch });

    } else if (target.type === 'viewer') {
      if (!target.viewerKey || typeof target.viewerKey !== 'string') {
        return { ok: false, error: 'Viewer target requires a viewerKey field' };
      }
      if (!/^[a-zA-Z0-9_-]{3,}$/.test(target.viewerKey)) {
        return { ok: false, error: `Invalid viewerKey "${target.viewerKey}": must be at least 3 characters (letters, digits, hyphens, underscores)` };
      }
      extraTargets.push({ id: target.id, type: 'viewer', viewerKey: target.viewerKey });
      rawTargets.push({ id: target.id, type: 'viewer', viewerKey: target.viewerKey, noBatch: target.noBatch });
    }
  }
  return { ok: true, extraTargets, rawTargets };
}


/**
 * Rebuild the runtime parts of a session that was loaded from the database (another instance
 * created it, or this one restarted): the YouTube senders and the other delivery targets from the
 * stored target list, and the primary sender when the session has a stream key. Sender counters
 * start at the session's stored sequence.
 *
 * @param {object} session
 */
export async function restoreSessionRuntime(session) {
  if (Array.isArray(session.rawTargets) && session.rawTargets.length > 0 && (session.extraTargets || []).length === 0) {
    const built = await buildExtraTargets(session.rawTargets);
    if (built.ok) {
      session.extraTargets = built.extraTargets;
      for (const t of session.extraTargets) {
        if (t.type === 'youtube' && t.sender && typeof t.sender.sequence === 'number') t.sender.sequence = Math.max(t.sender.sequence, session.sequence || 0);
      }
    }
  }
  if (!session.sender && session.streamKey) {
    const sender = new YoutubeLiveCaptionSender({ streamKey: session.streamKey, sequence: session.sequence || 0 });
    try {
      sender.start();
      session.sender = sender;
    } catch (err) {
      logger.warn(`[live] Failed to restore primary sender for session ${session.sessionId}: ${err?.message}`);
    }
  }
}
