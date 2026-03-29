import { Router } from 'express';

/**
 * Factory for the /youtube router.
 *
 * GET /youtube/config — Return the YouTube OAuth client ID configured on this server.
 *   Requires a valid JWT Bearer token.
 *   The client uses this to perform the OAuth2 token flow client-side via GIS.
 *
 * Configure via environment variable:
 *   YOUTUBE_CLIENT_ID — Google OAuth 2.0 Web application client ID
 *
 * @param {import('express').RequestHandler} auth - Pre-created auth middleware
 * @returns {Router}
 */
export function createYouTubeRouter(auth) {
  const router = Router();

  router.get('/config', auth, (req, res) => {
    const clientId = process.env.YOUTUBE_CLIENT_ID;
    if (!clientId) {
      return res.status(503).json({
        error: 'YouTube OAuth not configured on this server (YOUTUBE_CLIENT_ID not set)',
      });
    }
    res.set('Cache-Control', 'private, max-age=3600');
    res.json({ clientId });
  });

  return router;
}
