#!/usr/bin/env node
/**
 * tcp-echo-server build script — bundles with esbuild then packages with pkg.
 * Output filenames include the version number, e.g.:
 *   dist/tcp-echo-server-1.0.0.exe
 *   dist/tcp-echo-server-1.0.0-mac
 *   dist/tcp-echo-server-1.0.0-linux
 *   dist/tcp-echo-server-1.0.0-linux-arm64
 *
 * Usage:
 *   node scripts/build.cjs              # bundle only (esbuild step)
 *   node scripts/build.cjs win          # bundle + package for Windows x64
 *   node scripts/build.cjs mac          # bundle + package for macOS x64
 *   node scripts/build.cjs linux        # bundle + package for Linux x64
 *   node scripts/build.cjs linux-arm64  # bundle + package for Linux ARM64
 */
const { execSync } = require('child_process');
const { version }  = require('../package.json');

const targets = {
  win:          { target: 'node18-win-x64',       output: `dist/tcp-echo-server-${version}.exe` },
  mac:          { target: 'node18-macos-x64',     output: `dist/tcp-echo-server-${version}-mac` },
  linux:        { target: 'node18-linux-x64',     output: `dist/tcp-echo-server-${version}-linux` },
  'linux-arm64':{ target: 'node18-linux-arm64',   output: `dist/tcp-echo-server-${version}-linux-arm64` },
};

const run = (cmd) => { console.log(`[build] ${cmd}`); execSync(cmd, { stdio: 'inherit' }); };

// Step 1: esbuild bundle (ESM → CJS so pkg can process it)
console.log(`[build] tcp-echo-server v${version}`);
run(`npx esbuild server.js --bundle --platform=node --target=node18 --format=cjs --outfile=dist/bundle.cjs`);

// Step 2: pkg (optional, controlled by CLI arg)
const platform = process.argv[2];
if (platform) {
  const t = targets[platform];
  if (!t) {
    console.error(`[build] Unknown platform: ${platform}. Use win, mac, linux, or linux-arm64.`);
    process.exit(1);
  }
  run(`npx @yao-pkg/pkg dist/bundle.cjs --target ${t.target} --output ${t.output}`);
  console.log(`[build] → ${t.output}`);
}
