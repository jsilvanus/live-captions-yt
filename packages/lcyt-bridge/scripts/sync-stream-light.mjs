#!/usr/bin/env node
// Copies the shared parts of stream-light (https://github.com/jsilvanus/stream-light, MIT)
// into vendor/stream-light. Usage: node scripts/sync-stream-light.mjs <path-to-stream-light-checkout>
// Replaced by a normal npm dependency once @jsilvanus/stream-light is published.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const VENDORED_FILES = [
  'core/states.js', 'core/reading.js', 'core/config.js', 'core/light.js', 'core/index.js',
  'sources/push.js',
  'outputs/tally-ma.js', 'outputs/webhook.js',
];

const here = path.dirname(fileURLToPath(import.meta.url));
const dest = path.join(here, '..', 'vendor', 'stream-light');
const src = process.argv[2];
if (!src) { console.error('usage: sync-stream-light.mjs <stream-light checkout>'); process.exit(2); }

for (const rel of VENDORED_FILES) {
  const to = path.join(dest, rel);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(path.join(src, 'src', rel), to);
}
fs.copyFileSync(path.join(src, 'LICENSE'), path.join(dest, 'LICENSE'));
let commit = 'unknown';
try { commit = execFileSync('git', ['-C', src, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { /* not a checkout */ }
fs.writeFileSync(path.join(dest, 'VENDORED.md'),
  `# Vendored stream-light\n\nCopied from https://github.com/jsilvanus/stream-light (MIT, see LICENSE) at commit ${commit}.\nDo not edit here: change stream-light, then run \`node scripts/sync-stream-light.mjs <checkout>\`.\n`);
console.log(`synced ${VENDORED_FILES.length} files from ${commit}`);
