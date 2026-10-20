import { describe, it, expect } from 'vitest';
import { withOutputScope } from '../../src/components/production/crop/useCropEditor.js';

describe('withOutputScope', () => {
  it('leaves the path alone for the default crop', () => {
    expect(withOutputScope('/crop/config', null)).toBe('/crop/config');
  });
  it('adds outputId as the first or a further query field', () => {
    expect(withOutputScope('/crop/config', 'out-a1')).toBe('/crop/config?outputId=out-a1');
    expect(withOutputScope('/crop/presets?setId=', 'out-a1')).toBe('/crop/presets?setId=&outputId=out-a1');
  });
  it('encodes the id', () => {
    expect(withOutputScope('/crop/sets', 'a b')).toBe('/crop/sets?outputId=a%20b');
  });
});
