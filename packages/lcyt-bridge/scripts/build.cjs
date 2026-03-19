#!/usr/bin/env node
/**
 * Bridge build script — bundles with esbuild (injecting version) then packages
 * with pkg. Output filenames include the version number, e.g.:
 *   dist/lcyt-bridge-0.2.0.exe
 *   dist/lcyt-bridge-0.2.0-mac
 *   dist/lcyt-bridge-0.2.0-linux
 *
 * Usage:
 *   node scripts/build.cjs          # bundle only (esbuild step)
 *   node scripts/build.cjs win      # bundle + package for Windows
 *   node scripts/build.cjs mac      # bundle + package for macOS
 *   node scripts/build.cjs linux    # bundle + package for Linux
 */
const { execSync } = require('child_process');
const { version }  = require('../package.json');

const targets = {
  win:          { target: 'node18-win-x64',       output: `dist/lcyt-bridge-${version}.exe` },
  mac:          { target: 'node18-macos-x64',     output: `dist/lcyt-bridge-${version}-mac` },
  linux:        { target: 'node18-linux-x64',     output: `dist/lcyt-bridge-${version}-linux` },
  'linux-arm64':{ target: 'node18-linux-arm64',   output: `dist/lcyt-bridge-${version}-linux-arm64` },
};

const run = (cmd) => { console.log(`[build] ${cmd}`); execSync(cmd, { stdio: 'inherit' }); };

// Step 1: esbuild bundle
const define = `--define:__BRIDGE_VERSION__='"${version}"'`;
console.log(`[build] lcyt-bridge v${version}`);
run(`esbuild src/index.js --bundle --platform=node --target=node18 --format=cjs ${define} --outfile=dist/bundle.cjs`);

// Step 2: pkg (optional, controlled by CLI arg)
const platform = process.argv[2];
if (platform) {
  const t = targets[platform];
  if (!t) { console.error(`[build] Unknown platform: ${platform}. Use win, mac, or linux.`); process.exit(1); }
  run(`npx @yao-pkg/pkg dist/bundle.cjs --target ${t.target} --output ${t.output}`);
  console.log(`[build] → ${t.output}`);
}
