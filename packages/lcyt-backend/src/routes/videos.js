import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { existsSync } from 'node:fs';
import { createReadStream } from 'node:fs';
import { listVideos, getVideo, deleteVideo, startVideoRecording, resolveVideoAssetPath } from '../db/videos.js';
import { Readable } from 'node:stream';

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

async function streamVideoAsset(req, res, video, relativePath = 'playlist.m3u8', { recordingsStore = null } = {}) {
  const apiKey = req.session?.apiKey;
  const safeRelativePath = String(relativePath || 'playlist.m3u8').replace(/^\/+/, '');

  if (video.storageType === 's3' && recordingsStore) {
    const storagePrefix = video.storageKey || video.id;
    const objectKey = `${storagePrefix}/${safeRelativePath}`;
    try {
      const opened = await recordingsStore.stream(objectKey, { range: req.headers.range });
      const contentType = opened.contentType || (safeRelativePath.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'application/octet-stream');
      res.setHeader('Content-Type', contentType);
      res.setHeader('Accept-Ranges', 'bytes');
      if (opened.contentLength != null) res.setHeader('Content-Length', String(opened.contentLength));
      if (opened.contentRange) {
        res.status(206);
        res.setHeader('Content-Range', opened.contentRange);
      }
      if (safeRelativePath.endsWith('.m3u8')) {
        const source = opened.stream?.pipe ? opened.stream : Readable.fromWeb(opened.stream);
        const chunks = [];
        for await (const chunk of source) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        const body = Buffer.concat(chunks).toString('utf8');
        const assetBaseUrl = `${req.protocol}://${req.get('host')}${req.baseUrl}/${video.id}`;
        return res.send(rewritePlaylistReferences(body, assetBaseUrl));
      }
      const source = opened.stream?.pipe ? opened.stream : Readable.fromWeb(opened.stream);
      return source.pipe(res);
    } catch (err) {
      return res.status(404).json({ error: 'Asset not found' });
    }
  }

  const assetPath = resolveVideoAssetPath(apiKey, video.id, safeRelativePath);
  if (!assetPath || !existsSync(assetPath)) return res.status(404).json({ error: 'Asset not found' });
  res.setHeader('Content-Type', safeRelativePath.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'application/octet-stream');
  createReadStream(assetPath).pipe(res);
}

export function createVideosRouter(auth, db, { recordingsStore = null } = {}) {
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
      storageType: recordingsStore?.type === 's3' ? 's3' : 'local',
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
    await streamVideoAsset(req, res, video, 'playlist.m3u8', { recordingsStore });
  });

  router.get('/:id/*', auth, async (req, res) => {
    const video = getVideo(db, req.session.apiKey, req.params.id);
    if (!video) return res.status(404).json({ error: 'Video not found' });
    const relativePath = req.params[0] || 'playlist.m3u8';
    await streamVideoAsset(req, res, video, relativePath, { recordingsStore });
  });

  router.delete('/:id', auth, async (req, res) => {
    const result = await deleteVideo(db, req.session.apiKey, req.params.id, { recordingsStore });
    if (!result.ok) return res.status(result.status || 400).json({ error: result.error });
    res.json({ ok: true });
  });

  return router;
}
