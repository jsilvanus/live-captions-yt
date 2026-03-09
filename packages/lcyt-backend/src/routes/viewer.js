import { Router } from 'express';
import { incrementViewerKeyStat, incrementViewerAnonStat } from '../db.js';

/**
 * In-memory map of viewerKey → Set of active SSE client objects.
 * Each client object is { res } where res is an Express Response.
 *
 * This map is module-level so that captions.js can call broadcastToViewers()
 * without needing a shared store object.
 */
const viewerSubs = new Map();

/**
 * Broadcast a caption event to all SSE clients watching a given viewer key.
 * Called from captions.js when a viewer target is in the session's extraTargets.
 *
 * @param {string} viewerKey
 * @param {{ text: string, sequence: number, timestamp?: string }} data
 */
export function broadcastToViewers(viewerKey, data) {
  const clients = viewerSubs.get(viewerKey);
  if (!clients || clients.size === 0) return;
  const msg = `event: caption\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) {
    try { client.res.write(msg); } catch {}
  }
}

/**
 * Factory for the /viewer router.
 *
 * GET /viewer/:key — SSE stream of live captions for viewers.
 * No authentication required. The viewerKey is a short URL-safe identifier
 * configured by the streamer in the CC → Targets tab.
 *
 * Events emitted:
 *   connected  { ok: true }
 *   caption    { text, sequence, timestamp? }
 *
 * CORS: Access-Control-Allow-Origin: * (public endpoint)
 *
 * @param {import('better-sqlite3').Database} [db] - Optional DB for usage stats.
 * @returns {Router}
 */
export function createViewerRouter(db) {
  const router = Router();

  // CORS preflight for the viewer endpoint (all origins allowed)
  router.options('/:key', (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Accept');
    res.status(204).end();
  });

  // GET /viewer/:key — subscribe to live captions
  router.get('/:key', (req, res) => {
    const key = req.params.key;

    // Validate key: minimum 3 characters, URL-safe (letters, digits, hyphens, underscores)
    if (!/^[a-zA-Z0-9_-]{3,}$/.test(key)) {
      return res.status(400).json({ error: 'Invalid viewer key. Must be at least 3 characters: letters, digits, hyphens, or underscores.' });
    }

    // Set SSE response headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
    res.flushHeaders();

    // Send initial connected event
    res.write(`event: connected\ndata: ${JSON.stringify({ ok: true })}\n\n`);

    // Track usage stats — look up the viewerKey → apiKey from in-memory subs
    // We record stats for the owning API key by scanning the live session.
    // If no session owns this key yet (viewer arrived early), we still count the anon stat.
    if (db) {
      try {
        // Anon stat: always increment
        incrementViewerAnonStat(db);
        // Per-key stat: look up which API key owns this viewerKey via the global viewerKeyOwners map
        const ownerKey = viewerKeyOwners.get(key);
        if (ownerKey) {
          incrementViewerKeyStat(db, ownerKey, key);
        }
      } catch (err) {
        console.warn(`[viewer] Failed to record stats for key "${key}": ${err.message}`);
      }
    }

    // Register this client
    const client = { res };
    if (!viewerSubs.has(key)) viewerSubs.set(key, new Set());
    viewerSubs.get(key).add(client);

    // Periodic heartbeat to keep the connection alive through proxies
    const heartbeat = setInterval(() => {
      try { res.write(':heartbeat\n\n'); } catch (err) {
        console.warn(`[viewer] Heartbeat write error for key "${key}": ${err.message}`);
        clearInterval(heartbeat);
      }
    }, 25000);

    // Clean up on client disconnect
    req.on('close', () => {
      clearInterval(heartbeat);
      const clients = viewerSubs.get(key);
      if (clients) {
        clients.delete(client);
        if (clients.size === 0) viewerSubs.delete(key);
      }
    });
  });

  return router;
}

/**
 * Module-level map of viewerKey → apiKey.
 * Populated by captions.js when a viewer target is in the session's extraTargets,
 * so the viewer router can attribute stats to the correct API key.
 */
export const viewerKeyOwners = new Map();

/**
 * Register the owner (apiKey) of a viewerKey.
 * Called from captions.js when processing viewer extraTargets.
 * @param {string} viewerKey
 * @param {string} apiKey
 */
export function registerViewerKeyOwner(viewerKey, apiKey) {
  viewerKeyOwners.set(viewerKey, apiKey);
}

