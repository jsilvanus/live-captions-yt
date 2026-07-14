import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { existsSync } from 'node:fs';
import { createReadStream } from 'node:fs';
import { listVideos, getVideo, deleteVideo, startVideoRecording, resolveVideoAssetPath } from '../db/videos.js';
import { buildS3Url, isS3Enabled } from '../storage/s3.js';

function withPlaybackUrl(req, video) {
  if (!video) return video;
  return {
    ...video,
    playbackUrl: `${req.baseUrl}/${video.id}/playlist.m3u8`,
  };
}

export function rewritePlaylistReferences(text, baseUrl) {
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return text.split(/\r?\n/).map((line) => {
    if (!line || line.startsWith('#')) return line;
    if (/^(https?:)?\/\//.test(line) || line.startsWith('/')) return line;
    return `${normalizedBase}${line.replace(/^\.\//, '')}`;
  }).join('\n');
}

async function streamVideoAsset(req, res, video, relativePath = 'playlist.m3u8') {
  const apiKey = req.session?.apiKey;
  const safeRelativePath = String(relativePath || 'playlist.m3u8').replace(/^\/+/, '');

  if (video.storageType === 's3' && isS3Enabled()) {
    const storagePrefix = video.storageKey || video.id;
    const bucketKey = `${storagePrefix}/${safeRelativePath}`;
    try {
      const url = buildS3Url(bucketKey);
      const assetRes = await fetch(url, { headers: { Accept: '*/*' } });
      if (!assetRes.ok) return res.status(assetRes.status || 502).json({ error: 'Asset not found' });
      const contentType = assetRes.headers.get('content-type') || (safeRelativePath.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'application/octet-stream');
      res.setHeader('Content-Type', contentType);
      if (safeRelativePath.endsWith('.m3u8')) {
        const body = await assetRes.text();
        const assetBaseUrl = `${req.protocol}://${req.get('host')}${req.baseUrl}/${video.id}`;
        return res.send(rewritePlaylistReferences(body, assetBaseUrl));
      }
      if (assetRes.body) {
        const { Readable } = await import('node:stream');
        return Readable.fromWeb(assetRes.body).pipe(res);
      }
      const buffer = Buffer.from(await assetRes.arrayBuffer());
      return res.send(buffer);
    } catch (err) {
      return res.status(502).json({ error: 'S3 asset fetch failed' });
    }
  }

  const assetPath = resolveVideoAssetPath(apiKey, video.id, safeRelativePath);
  if (!assetPath || !existsSync(assetPath)) return res.status(404).json({ error: 'Asset not found' });
  res.setHeader('Content-Type', safeRelativePath.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'application/octet-stream');
  createReadStream(assetPath).pipe(res);
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
    const { broadcastId, title } = req.body || {};
    const result = startVideoRecording(db, req.session.apiKey, {
      broadcastId: broadcastId || null,
      title: title || undefined,
      storageType: isS3Enabled() ? 's3' : 'local',
    });
    if (!result.ok) return res.status(result.status || 400).json({ error: result.error });
    res.status(201).json({ ok: true, video: withPlaybackUrl(req, result.video) });
  });

  router.get('/:id', auth, (req, res) => {
    const video = getVideo(db, req.session.apiKey, req.params.id);
    if (!video) return res.status(404).json({ error: 'Video not found' });
    res.json({ video: withPlaybackUrl(req, video) });
  });

  router.get('/:id/playlist.m3u8', auth, async (req, res) => {
    const video = getVideo(db, req.session.apiKey, req.params.id);
    if (!video) return res.status(404).json({ error: 'Video not found' });
    await streamVideoAsset(req, res, video, 'playlist.m3u8');
  });

  router.get('/:id/*', auth, async (req, res) => {
    const video = getVideo(db, req.session.apiKey, req.params.id);
    if (!video) return res.status(404).json({ error: 'Video not found' });
    const relativePath = req.params[0] || 'playlist.m3u8';
    await streamVideoAsset(req, res, video, relativePath);
  });

  router.delete('/:id', auth, (req, res) => {
    const result = deleteVideo(db, req.session.apiKey, req.params.id);
    if (!result.ok) return res.status(result.status || 400).json({ error: result.error });
    res.json({ ok: true });
  });

  return router;
}
