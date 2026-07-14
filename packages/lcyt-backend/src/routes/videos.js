import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { existsSync } from 'node:fs';
import { createReadStream } from 'node:fs';
import { listVideos, getVideo, deleteVideo, startVideoRecording, resolveVideoAssetPath } from '../db/videos.js';

function withPlaybackUrl(req, video) {
  if (!video) return video;
  return {
    ...video,
    playbackUrl: `${req.baseUrl}/${video.id}/playlist.m3u8`,
  };
}

export function createVideosRouter(auth, db) {
  const router = Router();
  const limiter = rateLimit({ windowMs: 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false });
  router.use(limiter);

  router.get('/', auth, (req, res) => {
    const videos = listVideos(db, req.session.apiKey);
    res.json({ videos: videos.map((video) => withPlaybackUrl(req, video)) });
  });

  router.post('/', auth, (req, res) => {
    const { broadcastId, title, status } = req.body || {};
    const normalizedStatus = status === 'completed' ? 'completed' : 'recording';
    const result = startVideoRecording(db, req.session.apiKey, {
      broadcastId: broadcastId || null,
      title: title || undefined,
      status: normalizedStatus,
    });
    if (!result.ok) return res.status(result.status || 400).json({ error: result.error });
    res.status(201).json({ ok: true, video: withPlaybackUrl(req, result.video) });
  });

  router.get('/:id', auth, (req, res) => {
    const video = getVideo(db, req.session.apiKey, req.params.id);
    if (!video) return res.status(404).json({ error: 'Video not found' });
    res.json({ video: withPlaybackUrl(req, video) });
  });

  router.get('/:id/playlist.m3u8', auth, (req, res) => {
    const video = getVideo(db, req.session.apiKey, req.params.id);
    if (!video) return res.status(404).json({ error: 'Video not found' });
    const assetPath = resolveVideoAssetPath(req.session.apiKey, video.id, 'playlist.m3u8');
    if (!assetPath || !existsSync(assetPath)) return res.status(404).json({ error: 'Playlist not found' });
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    createReadStream(assetPath).pipe(res);
  });

  router.delete('/:id', auth, (req, res) => {
    const result = deleteVideo(db, req.session.apiKey, req.params.id);
    if (!result.ok) return res.status(result.status || 400).json({ error: result.error });
    res.json({ ok: true });
  });

  return router;
}
