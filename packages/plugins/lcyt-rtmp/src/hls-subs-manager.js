import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join, resolve as resolvePath, sep } from 'node:path';

const DEFAULT_SUBS_ROOT      = process.env.HLS_SUBS_ROOT             || '/tmp/hls-subs';
const DEFAULT_SEG_DURATION   = Number(process.env.HLS_SUBS_SEGMENT_DURATION ?? 6);
const DEFAULT_WINDOW_SIZE    = Number(process.env.HLS_SUBS_WINDOW_SIZE       ?? 10);
// Auto-stop after this many consecutive empty flushes (no cues). Default ≈ 2 h.
const DEFAULT_MAX_IDLE_SEGS  = Math.ceil((Number(process.env.SESSION_TTL ?? 7_200_000) / 1000) / DEFAULT_SEG_DURATION);

// BCP-47 → human-readable name for EXT-X-MEDIA NAME= attribute.
const LANG_NAMES = {
  original: 'Original',
  en: 'English', 'en-US': 'English (US)', 'en-GB': 'English (UK)',
  fi: 'Finnish',  'fi-FI': 'Finnish',
  sv: 'Swedish',  'sv-SE': 'Swedish',
  de: 'German',   'de-DE': 'German',
  fr: 'French',   'fr-FR': 'French',
  es: 'Spanish',  'es-ES': 'Spanish',  'es-419': 'Spanish (Latin America)',
  it: 'Italian',  'it-IT': 'Italian',
  pt: 'Portuguese', 'pt-BR': 'Portuguese (BR)', 'pt-PT': 'Portuguese (PT)',
  nl: 'Dutch',    'nl-NL': 'Dutch',
  pl: 'Polish',   'pl-PL': 'Polish',
  ru: 'Russian',  'ru-RU': 'Russian',
  uk: 'Ukrainian', 'uk-UA': 'Ukrainian',
  ar: 'Arabic',   'ar-SA': 'Arabic',
  zh: 'Chinese',  'zh-CN': 'Chinese (Simplified)', 'zh-TW': 'Chinese (Traditional)',
  ja: 'Japanese', 'ja-JP': 'Japanese',
  ko: 'Korean',   'ko-KR': 'Korean',
  no: 'Norwegian', 'nb-NO': 'Norwegian (Bokmål)',
  da: 'Danish',   'da-DK': 'Danish',
  et: 'Estonian', 'et-EE': 'Estonian',
  lv: 'Latvian',  'lv-LV': 'Latvian',
  lt: 'Lithuanian', 'lt-LT': 'Lithuanian',
  hu: 'Hungarian', 'hu-HU': 'Hungarian',
  cs: 'Czech',    'cs-CZ': 'Czech',
  sk: 'Slovak',   'sk-SK': 'Slovak',
  ro: 'Romanian', 'ro-RO': 'Romanian',
  tr: 'Turkish',  'tr-TR': 'Turkish',
};

/**
 * Format a millisecond offset as a WebVTT timestamp string: HH:MM:SS.mmm
 * @param {number} ms
 * @returns {string}
 */
export function formatVttTime(ms) {
  const totalSec = Math.floor(ms / 1000);
  const msRem = Math.floor(ms % 1000);
  const s = totalSec % 60;
  const m = Math.floor(totalSec / 60) % 60;
  const h = Math.floor(totalSec / 3600);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(msRem).padStart(3, '0')}`;
}

/**
 * Build a WebVTT segment string from an array of buffered cues.
 * Timestamps are expressed relative to segmentStartMs.
 *
 * @param {{ text: string, tsMs: number }[]} cues  Sorted by tsMs ascending.
 * @param {number} segStartMs  Wall-clock ms for the start of this segment window.
 * @param {number} segDurationMs  Duration of the segment window in ms.
 * @returns {string}
 */
export function buildWebVTT(cues, segStartMs, segDurationMs) {
  if (cues.length === 0) return 'WEBVTT\n';

  let body = '';
  for (let i = 0; i < cues.length; i++) {
    const startMs = Math.max(0, cues[i].tsMs - segStartMs);
    // Skip cues that fall entirely outside the segment window
    if (startMs >= segDurationMs) continue;

    let endMs;
    if (i + 1 < cues.length) {
      // End at next cue start minus a small gap
      endMs = Math.max(startMs + 100, (cues[i + 1].tsMs - segStartMs) - 50);
    } else {
      // Last cue: extend for up to 3.5 s, capped at segment end
      endMs = startMs + 3500;
    }
    endMs = Math.min(endMs, segDurationMs);

    body += `${formatVttTime(startMs)} --> ${formatVttTime(endMs)}\n${cues[i].text}\n\n`;
  }

  return body ? `WEBVTT\n\n${body}` : 'WEBVTT\n';
}

/**
 * Build an HLS subtitle playlist m3u8 string.
 *
 * @param {{ sequence: number, segments: { filename: string, startMs: number }[] }} langState
 * @param {number} segDurationMs
 * @returns {string}
 */
export function buildPlaylist(langState, segDurationMs) {
  const targetDuration = Math.ceil(segDurationMs / 1000) + 1;
  let out = '#EXTM3U\n';
  out += '#EXT-X-VERSION:3\n';
  out += `#EXT-X-TARGETDURATION:${targetDuration}\n`;
  out += `#EXT-X-MEDIA-SEQUENCE:${langState.sequence}\n`;
  for (const seg of langState.segments) {
    out += `#EXT-X-PROGRAM-DATE-TIME:${new Date(seg.startMs).toISOString()}\n`;
    out += `#EXTINF:${(segDurationMs / 1000).toFixed(3)},\n`;
    out += `${seg.filename}\n`;
  }
  return out;
}

/**
 * Return the human-readable name for a BCP-47 language tag.
 * @param {string} lang
 * @returns {string}
 */
export function langName(lang) {
  return LANG_NAMES[lang] ?? lang;
}

// ---------------------------------------------------------------------------
// HlsSubsManager
// ---------------------------------------------------------------------------

/**
 * Manages rolling WebVTT subtitle segments for HLS multilingual caption sidecars.
 *
 * One instance per server. Tracks subtitle state per viewer key.
 * Called from viewer.js after broadcastToViewers() for each caption cue.
 *
 * File layout on disk:
 *   ${subsRoot}/<viewerKey>/<lang>/seg<N>.vtt
 *
 * Playlists are generated in memory on demand (never written to disk).
 *
 * Environment variables (read once at module load):
 *   HLS_SUBS_ROOT             — root dir for segment files (default: /tmp/hls-subs)
 *   HLS_SUBS_SEGMENT_DURATION — segment length in seconds (default: 6)
 *   HLS_SUBS_WINDOW_SIZE      — rolling window size in segments (default: 10)
 */
export class HlsSubsManager {
  /**
   * @param {{
   *   subsRoot?: string,
   *   segmentDuration?: number,
   *   windowSize?: number,
   *   maxIdleSegments?: number,
   * }} [opts]
   */
  constructor({ subsRoot, segmentDuration, windowSize, maxIdleSegments } = {}) {
    this._subsRoot       = subsRoot        ?? DEFAULT_SUBS_ROOT;
    this._segDuration    = (segmentDuration ?? DEFAULT_SEG_DURATION) * 1000; // ms
    this._windowSize     = windowSize      ?? DEFAULT_WINDOW_SIZE;
    this._maxIdle        = maxIdleSegments ?? DEFAULT_MAX_IDLE_SEGS;

    /**
     * Per-viewer-key state.
     * @type {Map<string, {
     *   timer: NodeJS.Timeout | null,
     *   segmentStart: number,
     *   segmentIndex: number,
     *   idleCount: number,
     *   pendingCues: Map<string, { text: string, tsMs: number }[]>,
     *   langs: Map<string, { sequence: number, segments: { filename: string, startMs: number }[] }>,
     * }>}
     */
    this._keys = new Map();
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Buffer a caption cue for the given viewer key and language.
   * Starts the segment timer for this key on first call.
   *
   * @param {string} viewerKey
   * @param {string} lang       BCP-47 tag or 'original'
   * @param {string} text       Caption text for this language
   * @param {string} timestamp  ISO string 'YYYY-MM-DDTHH:MM:SS.mmm'
   */
  addCue(viewerKey, lang, text, timestamp) {
    if (!viewerKey || !lang || !text || !timestamp) return;
    if (!/^[a-zA-Z0-9_-]{1,30}$/.test(lang)) return;

    const tsMs = this._parseTimestamp(timestamp);
    if (isNaN(tsMs)) return;

    let state = this._keys.get(viewerKey);
    if (!state) {
      state = this._initKey(viewerKey);
    }

    if (!state.pendingCues.has(lang)) {
      state.pendingCues.set(lang, []);
    }
    state.pendingCues.get(lang).push({ text, tsMs });
    state.idleCount = 0;
  }

  /**
   * Return active language tags for a viewer key.
   * @param {string} viewerKey
   * @returns {string[]}
   */
  getLanguages(viewerKey) {
    const state = this._keys.get(viewerKey);
    if (!state) return [];
    return [...state.langs.keys()];
  }

  /**
   * Return the HLS subtitle playlist m3u8 for a given viewer key and language.
   * @param {string} viewerKey
   * @param {string} lang
   * @returns {string | null}
   */
  getPlaylist(viewerKey, lang) {
    const state = this._keys.get(viewerKey);
    if (!state) return null;
    const langState = state.langs.get(lang);
    if (!langState || langState.segments.length === 0) return null;
    return buildPlaylist(langState, this._segDuration);
  }

  /**
   * Stop tracking a viewer key and remove its segment files from disk.
   * @param {string} viewerKey
   * @returns {Promise<void>}
   */
  async stopSubs(viewerKey) {
    const state = this._keys.get(viewerKey);
    if (!state) return;
    if (state.timer) {
      clearInterval(state.timer);
      state.timer = null;
    }
    this._keys.delete(viewerKey);
    await this._removeDir(viewerKey);
  }

  /**
   * Stop all active viewer keys. Call during graceful shutdown.
   * @returns {Promise<void>}
   */
  async stopAll() {
    await Promise.all([...this._keys.keys()].map(k => this.stopSubs(k)));
  }

  /**
   * Remove stale subs directories left over from a previous run.
   * Call once on server startup.
   * @returns {Promise<void>}
   */
  async sweepStaleDir() {
    try {
      await rm(this._subsRoot, { recursive: true, force: true });
    } catch {}
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Initialise per-key state and start the flush timer.
   * @param {string} viewerKey
   * @returns {object} state
   */
  _initKey(viewerKey) {
    const state = {
      timer: null,
      segmentStart: Date.now(),
      segmentIndex: 0,
      idleCount: 0,
      pendingCues: new Map(),
      langs: new Map(),
    };
    this._keys.set(viewerKey, state);

    // Start timer immediately; first flush fires after one segment duration.
    state.timer = setInterval(() => this._flush(viewerKey), this._segDuration);
    if (state.timer.unref) state.timer.unref();

    return state;
  }

  /**
   * Flush the current segment window: write one .vtt file per language,
   * update the rolling playlist window, and advance the segment cursor.
   * @param {string} viewerKey
   */
  async _flush(viewerKey) {
    const state = this._keys.get(viewerKey);
    if (!state) return;

    const segStartMs    = state.segmentStart;
    const segIndex      = state.segmentIndex;
    const filename      = `seg${String(segIndex).padStart(6, '0')}.vtt`;
    const pendingCues   = state.pendingCues;

    // Collect the union of all languages seen so far + any new ones this flush
    const allLangs = new Set([...state.langs.keys(), ...pendingCues.keys()]);

    let anyCues = false;
    for (const lang of allLangs) {
      const cues = (pendingCues.get(lang) || []).sort((a, b) => a.tsMs - b.tsMs);
      if (cues.length > 0) anyCues = true;

      const vttContent = buildWebVTT(cues, segStartMs, this._segDuration);

      // Write segment file (best-effort — don't stop on failure)
      try {
        const dir = join(this._subsRoot, viewerKey, lang);
        await mkdir(dir, { recursive: true });
        await writeFile(join(dir, filename), vttContent, 'utf8');
      } catch (err) {
        console.warn(`[hls-subs] Failed to write segment ${filename} for ${viewerKey}/${lang}: ${err.message}`);
      }

      // Update the in-memory rolling window
      if (!state.langs.has(lang)) {
        state.langs.set(lang, { sequence: 0, segments: [] });
      }
      const langState = state.langs.get(lang);
      langState.segments.push({ filename, startMs: segStartMs });
      if (langState.segments.length > this._windowSize) {
        langState.segments.shift();
        langState.sequence++;
      }
    }

    // Advance state for next flush
    state.pendingCues  = new Map();
    state.segmentStart = segStartMs + this._segDuration;
    state.segmentIndex = segIndex + 1;

    // Auto-stop after extended idle (no cues across all languages)
    if (!anyCues) {
      state.idleCount++;
      if (state.idleCount >= this._maxIdle) {
        console.log(`[hls-subs] Auto-stopping idle subs for viewer key "${viewerKey}"`);
        this.stopSubs(viewerKey).catch(() => {});
      }
    } else {
      state.idleCount = 0;
    }
  }

  /**
   * Parse a caption ISO timestamp to Unix ms.
   * Accepts 'YYYY-MM-DDTHH:MM:SS.mmm' (with or without trailing Z).
   * @param {string} ts
   * @returns {number}
   */
  _parseTimestamp(ts) {
    // Ensure Z suffix so Date.parse treats it as UTC
    const normalised = ts.endsWith('Z') ? ts : ts + 'Z';
    return Date.parse(normalised);
  }

  /**
   * Remove the on-disk directory for a viewer key.
   * @param {string} viewerKey
   */
  async _removeDir(viewerKey) {
    try {
      const dir = join(this._subsRoot, viewerKey);
      await rm(dir, { recursive: true, force: true });
    } catch (err) {
      console.warn(`[hls-subs] Failed to remove dir for "${viewerKey}": ${err.message}`);
    }
  }

  /**
   * Guard: ensure a resolved path is within the subs root.
   * @param {string} fullPath
   * @returns {boolean}
   */
  _isPathSafe(fullPath) {
    return resolvePath(fullPath).startsWith(resolvePath(this._subsRoot) + sep);
  }
}
