import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SETUP_REDIRECTS } from '../src/lib/setupRedirects.js';

describe('SETUP_REDIRECTS', () => {
  it('sends the old Ingestion card path to the Feeds card', () => {
    assert.deepEqual(SETUP_REDIRECTS, [{ from: '/setup/ingestion', to: '/setup/feeds' }]);
  });
});
