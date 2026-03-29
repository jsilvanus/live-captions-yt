/**
 * NginxManager — manages nginx proxy locations for HLS radio streams via MediaMTX.
 *
 * Problem: The RadioManager maps API keys to RTMP streams. If we naively serve
 * `/radio/:apiKey/index.m3u8` from nginx, the API key is exposed in every public URL
 * (visible in browser history, logs, referrer headers, CDN access logs, etc.).
 *
 * Solution: NginxManager derives a short, non-reversible "public slug" from each API key
 * (SHA-256 truncated to 16 hex chars) and writes nginx `location` blocks that proxy the
 * public slug URL to the internal MediaMTX HLS endpoint using the real API key path.
 * The API key never appears in any public URL.
 *
 * Public URL pattern:  GET /r/<slug>/index.m3u8   (slug = sha256(apiKey).hex.slice(0,16))
 * Internal proxy:      http://mediamtx:8080/<apiKey>/index.m3u8
 *
 * The manager maintains a dedicated nginx include file (default:
 * /etc/nginx/conf.d/lcyt-radio.conf). The file is replaced atomically on each update.
 * Changes are applied by running `nginx -t && nginx -s reload` (configurable).
 *
 * Environment variables:
 *   NGINX_RADIO_CONFIG_PATH   Path to the managed nginx include file
 *                             (default: /etc/nginx/conf.d/lcyt-radio.conf)
 *   NGINX_TEST_CMD            Command to test nginx config before reload
 *                             (default: nginx -t)
 *   NGINX_RELOAD_CMD          Command to reload nginx after writing config
 *                             (default: nginx -s reload)
 *   MEDIAMTX_HLS_BASE_URL     Base URL MediaMTX serves HLS from
 *                             (default: http://127.0.0.1:8080)
 *   NGINX_RADIO_PREFIX        Public URL path prefix for radio streams
 *                             (default: /r)
 *
 * Usage:
 *   const mgr = new NginxManager();
 *   const slug = await mgr.addStream('myApiKey123');
 *   // nginx now serves /r/<slug>/ → http://mediamtx:8080/myApiKey123/
 *
 *   await mgr.removeStream('myApiKey123');
 *   // location removed, nginx reloaded
 *
 * When NGINX_RADIO_CONFIG_PATH is not set, the manager operates in "no-op" mode:
 * slugs are still derived and returned, but no files are written and nginx is not
 * reloaded. This is safe for deployments without nginx (e.g. bare-Node dev).
 */

import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, resolve as resolvePath } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

const SECTION_START = '# BEGIN lcyt-radio-managed — do not edit this section manually';
const SECTION_END   = '# END lcyt-radio-managed';

const DEFAULT_CONFIG_PATH   = '/etc/nginx/conf.d/lcyt-radio.conf';
const DEFAULT_TEST_CMD      = 'nginx -t';
const DEFAULT_RELOAD_CMD    = 'nginx -s reload';
const DEFAULT_MEDIAMTX_BASE = 'http://127.0.0.1:8080';
const DEFAULT_PREFIX        = '/r';

/**
 * Manage nginx proxy locations for HLS radio streams.
 *
 * Maintains an in-memory map of apiKey → slug, writes a managed nginx config
 * section, and reloads nginx on changes.
 */
export class NginxManager {
  /**
   * @param {{
   *   configPath?:    string,   // Path to nginx include file. If null/undefined, no-op mode.
   *   testCmd?:       string,   // Config test command (default: nginx -t)
   *   reloadCmd?:     string,   // Reload command (default: nginx -s reload)
   *   mediamtxHlsBase?: string, // MediaMTX HLS base URL
   *   prefix?:        string,   // Public URL prefix (default: /r)
   *   enabled?:       boolean,  // Explicitly disable without changing env
   * }} [opts]
   */
  constructor(opts = {}) {
    this._configPath     = opts.configPath     ?? process.env.NGINX_RADIO_CONFIG_PATH ?? DEFAULT_CONFIG_PATH;
    this._testCmd        = opts.testCmd        ?? process.env.NGINX_TEST_CMD          ?? DEFAULT_TEST_CMD;
    this._reloadCmd      = opts.reloadCmd      ?? process.env.NGINX_RELOAD_CMD        ?? DEFAULT_RELOAD_CMD;
    this._mediamtxBase   = (opts.mediamtxHlsBase ?? process.env.MEDIAMTX_HLS_BASE_URL ?? DEFAULT_MEDIAMTX_BASE)
                             .replace(/\/$/, '');
    this._prefix         = (opts.prefix ?? process.env.NGINX_RADIO_PREFIX ?? DEFAULT_PREFIX)
                             .replace(/\/$/, '');

    // explicit disable takes precedence; otherwise enabled only when configPath was
    // *explicitly provided* (via opts or env var) — not when falling back to the default.
    this._enabled = 'enabled' in opts
      ? Boolean(opts.enabled)
      : Boolean(opts.configPath ?? process.env.NGINX_RADIO_CONFIG_PATH);

    /** @type {Map<string, string>} apiKey → slug */
    this._streams = new Map();
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** Whether this manager will actually write nginx config. */
  get isEnabled() { return this._enabled; }

  /**
   * Derive a deterministic, non-reversible public slug from an API key.
   * The slug is 16 lowercase hex characters (64 bits of SHA-256 output).
   * Two different keys never produce the same slug (with overwhelming probability).
   *
   * @param {string} apiKey
   * @returns {string}  16-char hex slug
   */
  static keyToSlug(apiKey) {
    return createHash('sha256').update(String(apiKey)).digest('hex').slice(0, 16);
  }

  /**
   * Get the public slug for an API key without registering it.
   *
   * @param {string} apiKey
   * @returns {string}
   */
  getSlug(apiKey) {
    return NginxManager.keyToSlug(apiKey);
  }

  /**
   * Get the full public HLS URL for an API key (slug-based, no key in URL).
   *
   * @param {string} apiKey
   * @param {string} origin  e.g. "https://api.example.com"
   * @returns {string}  e.g. "https://api.example.com/r/abc123def456789a/index.m3u8"
   */
  getPublicUrl(apiKey, origin) {
    const slug = NginxManager.keyToSlug(apiKey);
    return `${origin}${this._prefix}/${slug}/index.m3u8`;
  }

  /**
   * Register a radio stream and write/reload nginx config.
   * Returns the public slug that was assigned.
   *
   * In no-op mode (isEnabled=false), returns the slug without writing anything.
   *
   * @param {string} apiKey
   * @returns {Promise<string>}  public slug
   */
  async addStream(apiKey) {
    const slug = NginxManager.keyToSlug(apiKey);
    this._streams.set(apiKey, slug);
    if (this._enabled) {
      await this._applyConfig();
    }
    return slug;
  }

  /**
   * Deregister a radio stream and update nginx config.
   * No-op if the key was not registered.
   *
   * @param {string} apiKey
   * @returns {Promise<void>}
   */
  async removeStream(apiKey) {
    if (!this._streams.has(apiKey)) return;
    this._streams.delete(apiKey);
    if (this._enabled) {
      await this._applyConfig();
    }
  }

  /**
   * List all currently registered streams as { apiKey, slug, publicPath } objects.
   *
   * @returns {{ apiKey: string, slug: string, publicPath: string }[]}
   */
  listStreams() {
    return [...this._streams.entries()].map(([apiKey, slug]) => ({
      apiKey,
      slug,
      publicPath: `${this._prefix}/${slug}/`,
    }));
  }

  /**
   * Write and reload nginx config, or no-op if disabled.
   * Useful for re-applying config after a process restart.
   *
   * @returns {Promise<void>}
   */
  async sync() {
    if (this._enabled) {
      await this._applyConfig();
    }
  }

  // ---------------------------------------------------------------------------
  // Internal config generation
  // ---------------------------------------------------------------------------

  /**
   * Build the full content of the managed nginx include file.
   *
   * Outputs bare `location` blocks — the operator includes this file inside their
   * existing `server { }` block via `include /etc/nginx/conf.d/lcyt-radio.conf;`
   *
   * @returns {string}
   */
  _buildConfig() {
    const lines = [SECTION_START, ''];

    for (const [apiKey, slug] of this._streams) {
      // Proxy from public slug URL to MediaMTX HLS path using the real API key.
      // The API key appears only in the nginx server-side config, not in any public URL.
      const internalPath = `${this._mediamtxBase}/${encodeURIComponent(apiKey)}/`;
      const prefix = `${this._prefix}/${slug}`;

      // ── Playlist location (live — must not be cached) ─────────────────────
      lines.push(
        `  # HLS radio — playlist (no cache) — public slug: ${slug}`,
        `  location ~ ^${prefix}/.*\\.m3u8$ {`,
        `    proxy_pass ${internalPath};`,
        `    proxy_http_version 1.1;`,
        `    proxy_set_header Host $host;`,
        `    proxy_set_header X-Real-IP $remote_addr;`,
        `    proxy_buffering off;`,
        `    proxy_cache off;`,
        `    add_header Access-Control-Allow-Origin "*" always;`,
        `    add_header Access-Control-Allow-Methods "GET, OPTIONS" always;`,
        `    add_header Access-Control-Allow-Headers "Accept, Range" always;`,
        `    add_header Cache-Control "no-cache, no-store" always;`,
        `  }`,
        ``,
      );

      // ── Segment location (immutable — cache aggressively) ─────────────────
      lines.push(
        `  # HLS radio — segments (immutable, cache 24 h) — public slug: ${slug}`,
        `  location ~ ^${prefix}/.*\\.ts$ {`,
        `    proxy_pass ${internalPath};`,
        `    proxy_http_version 1.1;`,
        `    proxy_set_header Host $host;`,
        `    proxy_set_header X-Real-IP $remote_addr;`,
        `    proxy_cache lcyt_media;`,
        `    proxy_cache_valid 200 24h;`,
        `    proxy_cache_use_stale error timeout updating;`,
        `    add_header Access-Control-Allow-Origin "*" always;`,
        `    add_header Access-Control-Allow-Methods "GET, OPTIONS" always;`,
        `    add_header Access-Control-Allow-Headers "Accept, Range" always;`,
        `    add_header Cache-Control "public, max-age=86400, immutable" always;`,
        `    add_header X-Cache-Status $upstream_cache_status always;`,
        `  }`,
        ``,
      );

      // ── Fallback location (init segments, manifests with other extensions) ─
      lines.push(
        `  # HLS radio — fallback (other files) — public slug: ${slug}`,
        `  location ${prefix}/ {`,
        `    proxy_pass ${internalPath};`,
        `    proxy_http_version 1.1;`,
        `    proxy_set_header Host $host;`,
        `    proxy_set_header X-Real-IP $remote_addr;`,
        `    proxy_buffering off;`,
        `    proxy_cache off;`,
        `    add_header Access-Control-Allow-Origin "*" always;`,
        `    add_header Access-Control-Allow-Methods "GET, OPTIONS" always;`,
        `    add_header Access-Control-Allow-Headers "Accept, Range" always;`,
        `    add_header Cache-Control "no-cache" always;`,
        `  }`,
        ``,
      );
    }

    if (this._streams.size === 0) {
      lines.push('  # (no active radio streams)');
      lines.push('');
    }

    lines.push(SECTION_END);
    lines.push('');
    return lines.join('\n');
  }

  // ---------------------------------------------------------------------------
  // Internal file + reload operations
  // ---------------------------------------------------------------------------

  /**
   * Write config file atomically and reload nginx.
   *
   * @returns {Promise<void>}
   */
  async _applyConfig() {
    this._writeConfigAtomic();
    await this._testConfig();
    await this._execCmd(this._reloadCmd, 'nginx reload');
  }

  /**
   * Write the config file atomically using a temp file + rename.
   */
  _writeConfigAtomic() {
    const dir = dirname(resolvePath(this._configPath));
    fs.mkdirSync(dir, { recursive: true });

    const content = this._buildConfig();
    const tmpPath = resolvePath(dir, `.lcyt-radio-${randomBytes(6).toString('hex')}.tmp`);
    fs.writeFileSync(tmpPath, content, 'utf8');
    fs.renameSync(tmpPath, resolvePath(this._configPath));
  }

  /**
   * Run `nginx -t` to validate the config before reloading.
   * nginx writes test output to stderr even on success.
   */
  async _testConfig() {
    if (!this._testCmd) return;
    try {
      await this._execCmd(this._testCmd, 'nginx test');
    } catch (err) {
      // On test failure: remove our config file to avoid leaving nginx broken
      try {
        const empty = `${SECTION_START}\n  # (cleared after config test failure)\n${SECTION_END}\n`;
        fs.writeFileSync(resolvePath(this._configPath), empty, 'utf8');
      } catch {}
      throw err;
    }
  }

  /**
   * Execute a shell command string.
   *
   * @param {string} cmdStr      e.g. "nginx -s reload"
   * @param {string} label       used in error messages
   * @param {number} timeoutMs   kill the process and reject after this many ms (default 10 s)
   * @returns {Promise<void>}
   */
  _execCmd(cmdStr, label, timeoutMs = 10_000) {
    return new Promise((resolve, reject) => {
      const parts = cmdStr.trim().split(/\s+/);
      const proc  = spawn(parts[0], parts.slice(1), { stdio: 'pipe' });

      let stderr = '';
      if (proc.stderr) proc.stderr.on('data', d => { stderr += d; });

      const timer = setTimeout(() => {
        proc.kill();
        reject(new Error(`${label} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      proc.on('error', err => { clearTimeout(timer); reject(new Error(`${label} failed to start: ${err.message}`)); });
      proc.on('close', code => {
        clearTimeout(timer);
        if (code !== 0) {
          reject(new Error(`${label} exited with code ${code}: ${stderr.trim().slice(0, 300)}`));
        } else {
          resolve();
        }
      });
    });
  }
}
