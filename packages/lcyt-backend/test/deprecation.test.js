import { describe, it } from 'node:test';
import assert from 'node:assert';
import { deprecatedRoute, DEFAULT_PLAN_URL } from '../src/middleware/deprecation.js';

function run(mw) {
  const headers = {};
  let called = 0;
  mw({ method: 'POST' }, { set: (k, v) => { headers[k] = v; } }, () => { called += 1; });
  return { headers, called };
}

describe('deprecatedRoute', () => {
  it('sets Deprecation and Link headers and calls next', () => {
    const { headers, called } = run(deprecatedRoute('/rtmp', 'x'));
    assert.strictEqual(headers.Deprecation, 'true');
    assert.strictEqual(headers.Link, `<${DEFAULT_PLAN_URL}>; rel="deprecation"`);
    assert.strictEqual(called, 1);
  });

  it('still handles repeated requests', () => {
    let t = 0;
    const mw = deprecatedRoute('/rtmp', 'x', { now: () => t });
    assert.strictEqual(run(mw).called, 1);
    t = 1000;
    assert.strictEqual(run(mw).called, 1);
  });
});
