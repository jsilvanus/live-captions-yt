import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SETUP_REDIRECTS } from '../src/lib/setupRedirects.js';

describe('SETUP_REDIRECTS', () => {
  it('sends the old Ingestion card path to the Feeds card and the old device cards to the Devices card', () => {
    assert.deepEqual(SETUP_REDIRECTS, [
      { from: '/setup/ingestion', to: '/setup/feeds' },
      { from: '/setup/cameras', to: '/setup/devices' },
      { from: '/setup/mixers', to: '/setup/devices' },
      { from: '/setup/encoders', to: '/setup/devices' },
    ]);
  });
});
