import { Router } from 'express';
import * as fs from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Read the bridge version from its package.json at startup.
let BRIDGE_VERSION;
try {
  const pkgPath = resolve(__dirname, '../../../../packages/lcyt-bridge/package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  BRIDGE_VERSION = pkg.version;
} catch {
  BRIDGE_VERSION = 'latest';
}

const DEFAULT_GITHUB_RELEASES_BASE = 'https://github.com/jsilvanus/live-captions-yt/releases/latest/download';

const PLATFORMS = {
  win:   `lcyt-bridge-${BRIDGE_VERSION}.exe`,
  mac:   `lcyt-bridge-${BRIDGE_VERSION}-mac`,
  linux: `lcyt-bridge-${BRIDGE_VERSION}-linux`,
  arm:   `lcyt-bridge-${BRIDGE_VERSION}-linux-arm64`,
};

/**
 * GET /bridge-download?win   → redirect to Windows binary on GitHub Releases
 * GET /bridge-download?mac   → redirect to macOS binary on GitHub Releases
 * GET /bridge-download?linux → redirect to Linux x64 binary on GitHub Releases
 * GET /bridge-download?arm   → redirect to Linux arm64 binary on GitHub Releases
 *
 * No query param → 400 with list of supported platforms.
 *
 * Override the base URL via env var BRIDGE_DOWNLOAD_BASE_URL.
 * @param {import('../settings/service.js').SettingsService} [settings] - falls back to raw env when omitted (tests)
 */
export function createBridgeDownloadRouter(settings = null) {
  const router = Router();

  router.get('/', (req, res) => {
    const platform = Object.keys(PLATFORMS).find((p) => p in req.query);

    if (!platform) {
      return res.status(400).json({
        error: 'Missing platform query parameter',
        supported: Object.keys(PLATFORMS),
        example: '/bridge-download?win',
      });
    }

    const base = settings
      ? settings.get('app.bridge_download_base_url') || DEFAULT_GITHUB_RELEASES_BASE
      : process.env.BRIDGE_DOWNLOAD_BASE_URL || DEFAULT_GITHUB_RELEASES_BASE;
    const filename = PLATFORMS[platform];
    const url = `${base}/${filename}`;
    res.redirect(302, url);
  });

  return router;
}
