// Guard: every lcyt-web call to the backend must go through the /api/v1 prefix.
// The backend mounts its API only under /api/v1; the root paths below are the
// only exceptions (see packages/lcyt-backend/src/server.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'src');
const ROOT_PATHS = /^(icons|health|metrics|auth\/local|internal)(\/|\?|`|'|"|$)/;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(js|jsx|ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

const files = walk(SRC);

test('backend base URL templates never point at an unprefixed API path', () => {
  // `${backendUrl}/keys`, `${session.backendUrl}/ai/config`, `${serverUrl}/images/...`, `${base}/x`
  const re = /\$\{(?:session\.)?(backendUrl|serverUrl|base|url)\}\/([^`'"\s]*)/g;
  const bad = [];
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    text.split('\n').forEach((line, i) => {
      for (const m of line.matchAll(re)) {
        const rest = m[2];
        if (/^api\/v1(\/|\$\{|$)/.test(rest) || ROOT_PATHS.test(rest)) continue;
        if (m[1] === 'url' && !/\/api\b|fetch|EventSource/.test(line)) continue;
        bad.push(`${relative(SRC, f)}:${i + 1}: ${m[0]}`);
      }
    });
  }
  assert.deepEqual(bad, []);
});

test('helpers that prepend the base URL to a path add the /api/v1 prefix', () => {
  // `fetch(`${backendUrl}${path}`)`-style helpers: the base is prepended to a relative path.
  const re = /\$\{(backendUrl|serverUrl)\}\$\{(?!api\/v1|layer\.src|video\.playbackUrl|new URL)/g;
  const bad = [];
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    text.split('\n').forEach((line, i) => {
      // TallySection passes full /api/v1/... paths to its helper, so it is exempt.
      if (re.test(line) && !relative(SRC, f).endsWith("TallySection.jsx")) bad.push(`${relative(SRC, f)}:${i + 1}: ${line.trim()}`);
      re.lastIndex = 0;
    });
  }
  assert.deepEqual(bad, []);
});
