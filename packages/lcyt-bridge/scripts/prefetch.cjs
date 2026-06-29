#!/usr/bin/env node
/**
 * Pre-fetches the @yao-pkg/pkg-fetch base Node.js binaries needed to build
 * the lcyt-bridge executable, verifies their SHA-256 against pkg-fetch's
 * pinned hashes, and places them in pkg-fetch's local cache.
 *
 * Why this exists: pkg-fetch downloads base binaries (~50MB) via node-fetch.
 * On some networks/proxies that download silently stalls or fails partway
 * through, and pkg-fetch's `download()` swallows the error instead of
 * throwing — `npm run build:*` then exits 0 having produced no executable,
 * with no error message explaining why. `curl` against the exact same URL
 * has proven reliable where node-fetch stalls, so this script fetches the
 * binary with curl (falling back to a plain Node https client if curl is
 * unavailable), verifies it against pkg-fetch's own expected-shas.json, and
 * places it exactly where pkg-fetch expects to find it. The normal
 * build:* scripts then find it already cached and skip the flaky fetch.
 *
 * Usage:
 *   node scripts/prefetch.cjs              # prefetch all build targets
 *   node scripts/prefetch.cjs linux        # prefetch one target (see build.cjs)
 *   node scripts/prefetch.cjs win mac      # prefetch several targets
 */
const { spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { getNodeVersion } = require('@yao-pkg/pkg-fetch');
const { localPlace, remotePlace } = require('@yao-pkg/pkg-fetch/lib-es5/places');
const { EXPECTED_HASHES } = require('@yao-pkg/pkg-fetch/lib-es5/expected');
const pkgFetchPkg = require('@yao-pkg/pkg-fetch/package.json');

// Keep in sync with the `targets` map in scripts/build.cjs.
const PKG_TARGETS = {
  win: 'node18-win-x64',
  mac: 'node18-macos-x64',
  linux: 'node18-linux-x64',
  'linux-arm64': 'node18-linux-arm64',
};

function parseTarget(target) {
  const parts = target.split('-');
  const nodeRange = parts[0];
  const arch = parts[parts.length - 1];
  const platform = parts.slice(1, -1).join('-');
  return { nodeRange, platform, arch };
}

function hashFile(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(file);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function curlDownload(url, dest) {
  const result = spawnSync(
    'curl',
    ['-fL', '--retry', '3', '--retry-delay', '2', '--connect-timeout', '15', '-o', dest, url],
    { stdio: 'inherit' },
  );
  if (result.error) {
    if (result.error.code === 'ENOENT') return null; // curl not installed
    throw result.error;
  }
  return result.status === 0;
}

function nodeDownload(url, dest) {
  // Fallback for environments without curl. Mirrors pkg-fetch's own
  // node-fetch-based download (incl. HTTPS_PROXY support) but without the
  // silent-failure swallowing, so an actual error surfaces here.
  return new Promise((resolve, reject) => {
    const https = require('https');
    const { HttpsProxyAgent } = require('https-proxy-agent');
    const proxy = process.env.HTTPS_PROXY || process.env.https_proxy
      || process.env.HTTP_PROXY || process.env.http_proxy;
    const agent = proxy ? new HttpsProxyAgent(proxy) : undefined;

    function get(currentUrl, redirectsLeft) {
      https.get(currentUrl, { agent }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          if (redirectsLeft <= 0) return reject(new Error('Too many redirects'));
          res.resume();
          return get(res.headers.location, redirectsLeft - 1);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode} fetching ${currentUrl}`));
        }
        const out = fs.createWriteStream(dest);
        res.pipe(out);
        out.on('finish', () => out.close(() => resolve(true)));
        out.on('error', reject);
      }).on('error', reject);
    }
    get(url, 5);
  });
}

async function downloadVerified(url, dest, expectedHash) {
  const tmp = `${dest}.prefetching`;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.rmSync(tmp, { force: true });

  console.log(`[prefetch] downloading ${url}`);
  let ok = curlDownload(url, tmp);
  if (ok === null) {
    console.log('[prefetch] curl not found, falling back to Node https client');
    ok = await nodeDownload(url, tmp);
  }
  if (!ok) {
    fs.rmSync(tmp, { force: true });
    throw new Error(`Failed to download ${url}`);
  }

  const actualHash = await hashFile(tmp);
  if (actualHash !== expectedHash) {
    fs.rmSync(tmp, { force: true });
    throw new Error(
      `SHA-256 mismatch for ${path.basename(dest)}: expected ${expectedHash}, got ${actualHash}`,
    );
  }

  fs.renameSync(tmp, dest);
  fs.chmodSync(dest, 0o755);
  console.log(`[prefetch] verified + cached -> ${dest}`);
}

async function prefetchTarget(target) {
  const { nodeRange, platform, arch } = parseTarget(target);
  const nodeVersion = getNodeVersion(nodeRange);
  const local = localPlace({
    from: 'fetched',
    arch,
    nodeVersion,
    platform,
    version: pkgFetchPkg.version,
  });
  const remote = remotePlace({ version: pkgFetchPkg.version, nodeVersion, platform, arch });
  const expectedHash = EXPECTED_HASHES[remote.name];
  if (!expectedHash) {
    throw new Error(`No known SHA-256 for ${remote.name} (unsupported target: ${target})`);
  }

  if (fs.existsSync(local)) {
    const existingHash = await hashFile(local);
    if (existingHash === expectedHash) {
      console.log(`[prefetch] ${target}: already cached and verified -> ${local}`);
      return;
    }
    console.log(`[prefetch] ${target}: cached file hash mismatch, re-fetching`);
  }

  const url = `https://github.com/yao-pkg/pkg-fetch/releases/download/${remote.tag}/${remote.name}`;
  await downloadVerified(url, local, expectedHash);
}

async function main() {
  const requested = process.argv.slice(2);
  const platforms = requested.length > 0 ? requested : Object.keys(PKG_TARGETS);

  for (const platform of platforms) {
    const target = PKG_TARGETS[platform];
    if (!target) {
      console.error(`[prefetch] Unknown platform: ${platform}. Valid: ${Object.keys(PKG_TARGETS).join(', ')}`);
      process.exit(1);
    }
    await prefetchTarget(target);
  }
}

main().catch((err) => {
  console.error('[prefetch] Fatal:', err.message || err);
  process.exit(1);
});
