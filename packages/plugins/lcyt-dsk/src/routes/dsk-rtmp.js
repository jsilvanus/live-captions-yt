/**
 * DSK RTMP ingest callbacks — `/dsk-rtmp`
 *
 * Handles nginx-rtmp on_publish / on_publish_done callbacks for the `dsk` nginx-rtmp
 * application.  When a broadcaster (e.g. OBS) publishes to
 * `rtmp://<server>/dsk/<apiKey>`, the relay process for that API key is restarted
 * with the DSK stream composited on top of the main RTMP signal using ffmpeg's
 * `overlay` filter.
 *
 * The stream name (nginx `$name`) is the API key that identifies the relay session.
 *
 * Nginx-rtmp configuration example:
 *
 *   application dsk {
 *     live on;
 *     on_publish      http://localhost:3000/dsk-rtmp/on_publish;
 *     on_publish_done http://localhost:3000/dsk-rtmp/on_publish_done;
 *     # or: on_publish http://localhost:3000/dsk-rtmp   (with call= in POST body)
 *   }
 *
 * Routes:
 *   POST /dsk-rtmp               — single-URL style (call=publish|publish_done in body)
 *   POST /dsk-rtmp/on_publish     — separate-URL style
 *   POST /dsk-rtmp/on_publish_done — separate-URL style
 */

import express, { Router } from 'express';

// The local nginx-rtmp base URL and DSK application name.
// These must match the nginx-rtmp config on the server.
const DEFAULT_LOCAL_RTMP = process.env.DSK_LOCAL_RTMP || process.env.RADIO_LOCAL_RTMP || 'rtmp://127.0.0.1:1935';
const DEFAULT_DSK_APP    = process.env.DSK_RTMP_APP   || 'dsk';

// API key validation: same rules as the main relay keys
const API_KEY_RE = /^[a-zA-Z0-9_-]{3,}$/;

/**
 * Build the local RTMP URL for a DSK stream.
 * @param {string} apiKey
 * @returns {string}
 */
function dskSourceUrl(apiKey) {
  return `${DEFAULT_LOCAL_RTMP}/${DEFAULT_DSK_APP}/${apiKey}`;
}

/**
 * Create the Express router for DSK RTMP ingest callbacks.
 *
 * @param {import('../rtmp-manager.js').RtmpRelayManager} relayManager
 * @returns {Router}
 */
export function createDskRtmpRouter(relayManager) {
  const router = Router();

  // nginx-rtmp callbacks are application/x-www-form-urlencoded
  router.use(express.urlencoded({ extended: false, limit: '4kb' }));

  /**
   * Shared handler for nginx-rtmp publish/publish_done events.
   * @param {'publish'|'publish_done'} call
   * @param {string} name  Stream name = API key
   * @param {import('express').Response} res
   */
  async function handleNginxCallback(call, name, res) {
    if (!name || !API_KEY_RE.test(name)) {
      return res.status(400).send('invalid stream name');
    }

    const apiKey = name;
    const rtmpUrl = dskSourceUrl(apiKey);

    if (call === 'publish') {
      console.log(`[dsk-rtmp] on_publish: key=${apiKey.slice(0, 8)}… → ${rtmpUrl}`);
      try {
        await relayManager.setDskRtmpSource(apiKey, rtmpUrl);
      } catch (err) {
        console.error(`[dsk-rtmp] Failed to set DSK RTMP source for ${apiKey.slice(0, 8)}…: ${err.message}`);
        // Return 200 so nginx allows the ingest; DSK is best-effort
      }
      return res.status(200).send('ok');
    }

    if (call === 'publish_done') {
      console.log(`[dsk-rtmp] on_publish_done: key=${apiKey.slice(0, 8)}…`);
      try {
        await relayManager.setDskRtmpSource(apiKey, null);
      } catch (err) {
        console.error(`[dsk-rtmp] Failed to clear DSK RTMP source for ${apiKey.slice(0, 8)}…: ${err.message}`);
      }
      return res.status(200).send('ok');
    }

    return res.status(400).send('unknown call type');
  }

  // POST /dsk-rtmp — single-URL style (call=publish or call=publish_done in body)
  router.post('/', async (req, res) => {
    const { name, call } = req.body || {};
    return handleNginxCallback(call, name, res);
  });

  // POST /dsk-rtmp/on_publish — separate-URL style (nginx on_publish)
  router.post('/on_publish', async (req, res) => {
    const { name } = req.body || {};
    return handleNginxCallback('publish', name, res);
  });

  // POST /dsk-rtmp/on_publish_done — separate-URL style (nginx on_publish_done)
  router.post('/on_publish_done', async (req, res) => {
    const { name } = req.body || {};
    return handleNginxCallback('publish_done', name, res);
  });

  return router;
}
