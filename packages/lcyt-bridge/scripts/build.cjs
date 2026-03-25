#!/usr/bin/env node
/**
 * Bridge build script — bundles with esbuild (injecting version) then packages
 * with pkg. Output filenames include the version number, e.g.:
 *   dist/lcyt-bridge-0.2.0.exe
 *   dist/lcyt-bridge-0.2.0-mac
 *   dist/lcyt-bridge-0.2.0-linux
 *   dist/lcyt-bridge-0.2.0-linux-arm64
 *
 * Usage:
 *   node scripts/build.cjs              # bundle only (esbuild step)
 *   node scripts/build.cjs win          # bundle + package for Windows
 *   node scripts/build.cjs mac          # bundle + package for macOS
 *   node scripts/build.cjs linux        # bundle + package for Linux x64
 *   node scripts/build.cjs linux-arm64  # bundle + package for Linux arm64
 *   node scripts/build.cjs all          # bundle + package for all platforms
 */
const { execSync }  = require('child_process');
const { build }     = require('esbuild');
const { resolve }   = require('path');
const { version }   = require('../package.json');

const targets = {
  win:          { target: 'node18-win-x64',       output: `dist/lcyt-bridge-${version}.exe` },
  mac:          { target: 'node18-macos-x64',     output: `dist/lcyt-bridge-${version}-mac` },
  linux:        { target: 'node18-linux-x64',     output: `dist/lcyt-bridge-${version}-linux` },
  'linux-arm64':{ target: 'node18-linux-arm64',   output: `dist/lcyt-bridge-${version}-linux-arm64` },
};

// Resolve the @yao-pkg/pkg CLI binary via its package.json bin field so we
// can invoke it as `node <path>` rather than running the binary directly.
// This avoids both npm-workspace PATH hoisting issues and execute-bit
// permission problems. We read the bin field explicitly because
// require.resolve('@yao-pkg/pkg') returns the library entry (index.js),
// not the CLI (bin.js).
const _pkgMeta = require('@yao-pkg/pkg/package.json');
const _pkgRoot = resolve(require.resolve('@yao-pkg/pkg/package.json'), '..');
const _pkgBinRel = typeof _pkgMeta.bin === 'string' ? _pkgMeta.bin : _pkgMeta.bin.pkg;
const pkgEntry = resolve(_pkgRoot, _pkgBinRel);

const run = (cmd) => { console.log(`[build] ${cmd}`); execSync(cmd, { stdio: 'inherit' }); };

async function bundle() {
  // esbuild bundle via JS API so we can set banner + define without
  // shell-quoting headaches.  The banner provides a CJS-compatible polyfill
  // for import.meta.url so esbuild does not warn about "empty-import-meta".
  console.log(`[build] lcyt-bridge v${version}`);
  console.log(`[build] esbuild src/index.js → dist/bundle.cjs`);
  await build({
    entryPoints: ['src/index.js'],
    bundle:      true,
    platform:    'node',
    target:      'node18',
    format:      'cjs',
    outfile:     'dist/bundle.cjs',
    define: {
      '__BRIDGE_VERSION__':  JSON.stringify(version),
      'import.meta.url':     '__importMetaUrl',
    },
    banner: {
      js: "const __importMetaUrl = require('url').pathToFileURL(__filename).href;",
    },
  });
}

function pkg(platform) {
  const t = targets[platform];
  if (!t) {
    console.error(`[build] Unknown platform: ${platform}. Valid: ${Object.keys(targets).join(', ')}, all`);
    process.exit(1);
  }
  run(`node "${pkgEntry}" dist/bundle.cjs --target ${t.target} --output ${t.output}`);
  console.log(`[build] → ${t.output}`);
}

async function main() {
  await bundle();

  const arg = process.argv[2];
  if (!arg) return; // bundle-only mode

  if (arg === 'all') {
    for (const platform of Object.keys(targets)) pkg(platform);
  } else {
    pkg(arg);
  }
}

main().catch(err => { console.error('[build] Fatal:', err); process.exit(1); });
