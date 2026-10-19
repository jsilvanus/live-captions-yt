/**
 * Incoming streams of one project, read from MediaMTX path state.
 *
 * A project's raw ingest paths are its ingest stream key (or API key), the DSK source (`dsk/<key>`) and the
 * named feeds of its `rtmp` cameras. Derived paths (`<key>-out`, `<key>-crop`, `<key>-t0`) are the relay's own
 * output, not something an encoder pushes, so they never match. MediaMTX may name a path with or without the
 * RTMP application in front (`stream/<key>` vs `<key>`), so a path matches when it equals the key or ends in
 * `/<key>`.
 */

const VIDEO_CODEC = /h\.?26[45]|avc|hevc|vp[89]|av1|jpeg|mpeg-?[124]? ?video|video/i;
const AUDIO_CODEC = /opus|aac|mpeg-?[124]? ?audio|mp3|ac-?3|vorbis|g711|g722|lpcm|pcm|audio/i;

/**
 * Which kinds of media a MediaMTX path object carries. Reads `tracks2` (objects with `codec`) when the server
 * has it, else `tracks` (codec name strings).
 * @param {object} item  MediaMTX path object
 * @returns {{ video: boolean, audio: boolean, codecs: string[] }}
 */
export function classifyTracks(item) {
  const raw = Array.isArray(item?.tracks2) && item.tracks2.length
    ? item.tracks2.map(t => t?.codec ?? t?.type ?? '')
    : (Array.isArray(item?.tracks) ? item.tracks : []);
  const codecs = raw.map(String).filter(Boolean);
  return {
    video: codecs.some(c => VIDEO_CODEC.test(c)),
    audio: codecs.some(c => AUDIO_CODEC.test(c) && !VIDEO_CODEC.test(c)),
    codecs,
  };
}

function matchKey(name, keys) {
  return keys.find(k => name === k.key || name.endsWith(`/${k.key}`)) ?? null;
}

/**
 * @param {import('./mediamtx-client.js').MediaMtxClient} mediamtx
 * @param {{ key: string, kind: 'video'|'feed', label?: string }[]} keys  The project's ingest keys; every `video` key is also looked up as a DSK source
 * @returns {Promise<{ path: string, kind: string, label: string|null, video: boolean, audio: boolean, codecs: string[], readers: number, readyTime: string|null, bytesReceived: number|null }[]>}
 */
export async function listIngestStreams(mediamtx, keys) {
  const videoKeys = keys.filter(k => k.kind === 'video');
  const out = [];
  const PAGE = 200;
  for (let page = 0; page < 20; page++) {
    const res = await mediamtx.listPaths({ page, itemsPerPage: PAGE });
    for (const item of res?.items ?? []) {
      if (!item?.ready || typeof item.name !== 'string') continue;
      const dsk = /(?:^|\/)dsk\/(.+)$/.exec(item.name);
      const hit = dsk
        ? matchKey(dsk[1], videoKeys) && { ...matchKey(dsk[1], videoKeys), kind: 'dsk' }
        : matchKey(item.name, keys);
      if (!hit) continue;
      out.push({
        path: item.name,
        kind: hit.kind,
        label: hit.label ?? null,
        ...classifyTracks(item),
        readers: Array.isArray(item.readers) ? item.readers.length : 0,
        readyTime: item.readyTime ?? null,
        bytesReceived: typeof item.bytesReceived === 'number' ? item.bytesReceived : null,
      });
    }
    if (page + 1 >= (res?.pageCount ?? 1)) break;
  }
  return out;
}

const DERIVED_SUFFIX = /^(.+)-(?:out|crop|t\d+)$/;

/**
 * Ready MediaMTX paths that no project owns: the last path segment is not a known API key, ingest stream key or
 * camera key, and it is not a relay's own output of one (`<key>-out`, `-crop`, `-t<i>`). These are encoders that
 * push to the server before anything is set up for them (a test publisher, a new camera).
 * @param {import('./mediamtx-client.js').MediaMtxClient} mediamtx
 * @param {Set<string>} knownKeys  Every key some project owns
 * @returns {Promise<{ path: string, key: string, kind: 'video'|'dsk', video: boolean, audio: boolean, codecs: string[], readers: number, readyTime: string|null, bytesReceived: number|null, attachable: boolean }[]>}
 */
export async function listUnclaimedStreams(mediamtx, knownKeys) {
  const out = [];
  const PAGE = 200;
  for (let page = 0; page < 20; page++) {
    const res = await mediamtx.listPaths({ page, itemsPerPage: PAGE });
    for (const item of res?.items ?? []) {
      if (!item?.ready || typeof item.name !== 'string') continue;
      const segments = item.name.split('/');
      const key = segments[segments.length - 1];
      const dsk = segments.length > 1 && segments[segments.length - 2] === 'dsk';
      if (knownKeys.has(key)) continue;
      // `<key>__<viewport>` is a DSK viewport rendered by this server, not something an encoder pushes.
      if (key.includes('__')) continue;
      const derived = DERIVED_SUFFIX.exec(key);
      if (derived && knownKeys.has(derived[1])) continue;
      out.push({
        path: item.name,
        key,
        kind: dsk ? 'dsk' : 'video',
        ...classifyTracks(item),
        readers: Array.isArray(item.readers) ? item.readers.length : 0,
        readyTime: item.readyTime ?? null,
        bytesReceived: typeof item.bytesReceived === 'number' ? item.bytesReceived : null,
        // Becomes a named feed (rtmp camera), whose key is limited to letters, digits, _ and -.
        attachable: !dsk && segments.length === 1 && /^[a-zA-Z0-9_-]+$/.test(key),
      });
    }
    if (page + 1 >= (res?.pageCount ?? 1)) break;
  }
  return out;
}
