/**
 * HlsSegmentFetcher
 *
 * Polls a MediaMTX fMP4 HLS playlist, detects new segments, and emits each
 * segment as a Buffer together with its wall-clock timestamp derived from
 * the EXT-X-PROGRAM-DATE-TIME tag.
 *
 * Events:
 *   segment  ({ buffer, timestamp, duration, url, index })
 *   error    ({ error })
 *   stopped  ()
 *
 * @module hls-segment-fetcher
 */

import { EventEmitter } from 'node:events';

const MIN_POLL_INTERVAL_MS = 1000;

/**
 * Parse a MediaMTX/HLS playlist text and return segment descriptors.
 *
 * @param {string} text   Raw playlist text
 * @param {string} baseUrl  Base URL of the playlist (used to resolve relative URLs)
 * @returns {{ mediaSequence: number, segments: Array<{ url: string, duration: number, programDateTime?: Date }> }}
 */
function parsePlaylist(text, baseUrl) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  let mediaSequence = 0;
  let pendingDuration = null;
  let pendingDateTime = null;
  let accumulatedMs = 0;

  const segments = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) {
      mediaSequence = parseInt(line.split(':')[1], 10) || 0;
      continue;
    }

    if (line.startsWith('#EXT-X-PROGRAM-DATE-TIME:')) {
      const dtStr = line.slice('#EXT-X-PROGRAM-DATE-TIME:'.length).trim();
      try {
        pendingDateTime = new Date(dtStr);
      } catch {
        pendingDateTime = null;
      }
      continue;
    }

    if (line.startsWith('#EXTINF:')) {
      // #EXTINF:<duration>[,<title>]
      const durStr = line.slice('#EXTINF:'.length).split(',')[0];
      pendingDuration = parseFloat(durStr);
      continue;
    }

    // Skip other # tags
    if (line.startsWith('#')) continue;

    // Segment URL line
    if (pendingDuration !== null) {
      const url = line.startsWith('http') ? line : `${baseUrl.replace(/\/[^/]*$/, '')}/${line}`;
      let timestamp;
      if (pendingDateTime && !isNaN(pendingDateTime)) {
        // First segment has the EXT-X-PROGRAM-DATE-TIME; subsequent segments
        // accumulate from there (pendingDateTime is set only for the first).
        timestamp = new Date(pendingDateTime.getTime() + accumulatedMs);
      } else if (segments.length > 0 && segments[0].programDateTime) {
        // Re-derive from first segment's programDateTime + accumulated duration
        const base = segments[0].programDateTime;
        timestamp = new Date(base.getTime() + accumulatedMs);
      } else {
        timestamp = null; // will fall back to Date.now() in the consumer
      }

      segments.push({
        url,
        duration: pendingDuration,
        programDateTime: pendingDateTime ?? null,
        timestamp,
      });

      accumulatedMs += pendingDuration * 1000;
      pendingDuration = null;
      pendingDateTime = null; // only the first segment carries the tag
    }
  }

  return { mediaSequence, segments };
}

export class HlsSegmentFetcher extends EventEmitter {
  /**
   * @param {object} opts
   * @param {string}  opts.hlsBase     Base URL for MediaMTX HLS output, e.g. "http://127.0.0.1:8888"
   * @param {string}  opts.streamKey   MediaMTX stream path / API key
   * @param {number}  [opts.pollIntervalMs]  Playlist poll interval in ms (default: segmentDuration/2, min 1 s)
   * @param {number}  [opts.segmentDuration] Expected segment duration in seconds (used to derive default poll interval)
   */
  constructor({ hlsBase, streamKey, pollIntervalMs, segmentDuration = 6 }) {
    super();
    this._hlsBase   = hlsBase.replace(/\/$/, '');
    this._streamKey = streamKey;
    this._pollInterval = Math.max(
      MIN_POLL_INTERVAL_MS,
      pollIntervalMs ?? Math.round((segmentDuration / 2) * 1000),
    );
    this._running        = false;
    this._timer          = null;
    this._lastSequence   = -1; // last mediaSequence we processed
    this._lastSegmentIdx = -1; // last segment index seen within that sequence window
    this._initUrl        = null; // cached init segment URL (for fMP4)
    this._stopped        = false;
  }

  get playlistUrl() {
    return `${this._hlsBase}/${this._streamKey}/index.m3u8`;
  }

  /** Start polling. No-op if already running. */
  start() {
    if (this._running) return;
    this._running = true;
    this._stopped = false;
    this._poll();
  }

  /** Stop polling and emit 'stopped'. */
  stop() {
    if (this._stopped) return;
    this._stopped = true;
    this._running = false;
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    this.emit('stopped');
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  async _poll() {
    if (!this._running) return;

    try {
      await this._fetchAndEmit();
    } catch (err) {
      this.emit('error', { error: err });
    }

    if (this._running) {
      this._timer = setTimeout(() => this._poll(), this._pollInterval);
    }
  }

  async _fetchAndEmit() {
    // Fetch playlist
    let playlistText;
    const playlistUrl = this.playlistUrl;
    try {
      const resp = await fetch(playlistUrl, { signal: AbortSignal.timeout(10_000) });
      if (!resp.ok) {
        if (resp.status === 404) {
          // Stream not live yet — not an error, just wait
          return;
        }
        throw new Error(`Playlist fetch failed: HTTP ${resp.status}`);
      }
      playlistText = await resp.text();
    } catch (err) {
      if (err.name === 'TimeoutError' || err.name === 'AbortError') {
        this.emit('error', { error: new Error('Playlist fetch timed out') });
        return;
      }
      throw err;
    }

    const { mediaSequence, segments } = parsePlaylist(playlistText, playlistUrl);

    if (segments.length === 0) return;

    // Determine which segments are new.
    // Each HLS segment has a global index = mediaSequence + its position in the window.
    // We track _lastSequence to know where we left off.
    for (let i = 0; i < segments.length; i++) {
      const globalIdx = mediaSequence + i;
      if (globalIdx <= this._lastSequence) continue;

      this._lastSequence = globalIdx;
      const seg = segments[i];

      // Fetch segment buffer
      let buffer;
      try {
        const segResp = await fetch(seg.url, { signal: AbortSignal.timeout(15_000) });
        if (!segResp.ok) {
          this.emit('error', { error: new Error(`Segment fetch failed: HTTP ${segResp.status} ${seg.url}`) });
          continue;
        }
        buffer = Buffer.from(await segResp.arrayBuffer());
      } catch (err) {
        this.emit('error', { error: new Error(`Segment fetch error: ${err.message}`) });
        continue;
      }

      const timestamp = seg.timestamp ?? new Date();

      this.emit('segment', {
        buffer,
        timestamp,
        duration: seg.duration,
        url: seg.url,
        index: globalIdx,
      });
    }
  }
}
