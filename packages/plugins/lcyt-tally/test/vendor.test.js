import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const vendor = path.join(root, 'vendor', 'stream-light');

test('the vendored stream-light has its licence and provenance file', () => {
  assert.match(fs.readFileSync(path.join(vendor, 'LICENSE'), 'utf8'), /MIT License/);
  assert.match(fs.readFileSync(path.join(vendor, 'VENDORED.md'), 'utf8'), /commit [0-9a-f]{40}/);
});

test('the vendored files import nothing outside the vendor directory except node: modules', () => {
  const files = fs.readdirSync(vendor, { recursive: true }).filter((f) => f.endsWith('.js'));
  assert.ok(files.length >= 10);
  for (const f of files) {
    const src = fs.readFileSync(path.join(vendor, f), 'utf8');
    for (const m of src.matchAll(/^import .*? from '([^']+)'/gm)) {
      const spec = m[1];
      if (spec.startsWith('node:')) continue;
      assert.ok(spec.startsWith('.'), `${f} imports ${spec}`);
      assert.ok(path.resolve(path.dirname(path.join(vendor, f)), spec).startsWith(vendor), `${f} escapes the vendor directory`);
    }
  }
});

test('sync script and vendored file list agree', () => {
  // Importing the script would run it, so read the list from its source.
  const src = fs.readFileSync(path.join(root, 'scripts', 'sync-stream-light.mjs'), 'utf8');
  const listed = [...src.matchAll(/'((?:core|sources|outputs)\/[a-z-]+\.js)'/g)].map((m) => m[1]);
  assert.ok(listed.length >= 10);
  for (const rel of listed) assert.ok(fs.existsSync(path.join(vendor, rel)), `${rel} is listed but missing`);
});
