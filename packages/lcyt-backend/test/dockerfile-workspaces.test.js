import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// The app image copies workspace packages by name. A plugin the backend imports but the
// Dockerfile does not copy crashes the container at boot ("Cannot find package"), so every
// plugin directory must appear in all three places (manifest COPY, npm ci --workspace, source COPY).
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const dockerfile = readFileSync(path.join(root, 'Dockerfile'), 'utf8');
const backendDeps = Object.keys(JSON.parse(readFileSync(path.join(root, 'packages/lcyt-backend/package.json'), 'utf8')).dependencies || {});

describe('main Dockerfile workspace packages', () => {
  const plugins = readdirSync(path.join(root, 'packages/plugins'), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    // Plugins nothing in the app image imports may stay out of it.
    .filter((name) => backendDeps.includes(name));

  it('finds the backend plugins', () => {
    assert.ok(plugins.length > 5);
    assert.ok(plugins.includes('lcyt-tally'));
  });

  for (const name of plugins) {
    it(`${name} is installed and copied into the image`, () => {
      const dir = `packages/plugins/${name}`;
      assert.ok(dockerfile.includes(`COPY ${dir}/package.json ${dir}/`), `${name}: manifest COPY missing`);
      assert.ok(dockerfile.includes(`--workspace=${dir}`), `${name}: npm ci --workspace missing`);
      assert.ok(dockerfile.includes(`COPY ${dir}/ ${dir}/`), `${name}: source COPY missing`);
    });
  }
});
