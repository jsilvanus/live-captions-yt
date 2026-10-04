import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseActionItems, expandActionItems } from '../src/actions.js';

describe('lcyt/actions', () => {
  it('parses refs and atoms, keeping later colons in the value', () => {
    assert.deepEqual(parseActionItems('@intro | Camera:pulpit.wide | section:Prayer => 20s:Hymn | junk | '), [
      { ref: 'intro' },
      { metacode: 'camera', value: 'pulpit.wide' },
      { metacode: 'section', value: 'Prayer => 20s:Hymn' },
    ]);
    assert.deepEqual(parseActionItems(''), []);
    assert.deepEqual(parseActionItems(null), []);
  });

  it('expands nested refs and drops cycles and unknown refs with a warning', () => {
    const defs = { a: parseActionItems('x:1 | @b'), b: parseActionItems('y:2 | @a'), c: parseActionItems('z:3') };
    const warns = [];
    const out = expandActionItems(parseActionItems('@a | @c | @nope'), (n) => defs[n] ?? null, (m) => warns.push(m));
    assert.deepEqual(out.map((o) => o.metacode), ['x', 'y', 'z']);
    assert.equal(warns.length, 2);
  });
});
