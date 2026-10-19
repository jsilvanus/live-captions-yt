import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEVICE_TYPES, FEEDS_CHANGED_EVENT, isLinkableFeed, linkableFeeds, feedsLinkedTo, linkCandidates,
  linkBody, UNLINK_BODY, buildDeviceNames, deviceNameKey, notifyFeedsChanged,
} from '../src/lib/deviceFeeds.js';

const FEEDS = [
  { id: 'f-main', managed: false, primary: true, name: 'Main', deviceType: null, deviceId: null },
  { id: 'managed:dsk', managed: true, name: 'DSK', deviceType: null, deviceId: null },
  { id: 'f-altar', managed: false, name: 'Altar', deviceType: 'camera', deviceId: 'cam-1' },
  { id: 'f-second', managed: false, name: 'Second angle', deviceType: 'camera', deviceId: 'cam-1' },
  { id: 'f-prog', managed: false, name: 'Program', deviceType: 'mixer', deviceId: 'mix-1' },
  { id: 'f-loose', managed: false, name: 'Loose', deviceType: null, deviceId: null },
];

describe('device types and link bodies', () => {
  it('lists the three device kinds a feed can link to', () => {
    assert.deepEqual(DEVICE_TYPES, ['camera', 'mixer', 'encoder']);
  });

  it('builds the PATCH body for a link and the clearing body for an unlink', () => {
    assert.deepEqual(linkBody('mixer', 'mix-1'), { deviceType: 'mixer', deviceId: 'mix-1' });
    assert.deepEqual(UNLINK_BODY, { deviceType: null, deviceId: null });
  });

  it('names the window event feed lists reload on', () => {
    assert.equal(FEEDS_CHANGED_EVENT, 'lcyt:feeds-changed');
    assert.doesNotThrow(() => notifyFeedsChanged());
  });
});

describe('feed selection for the Devices card', () => {
  it('never treats the DSK entry as linkable, by flag or by id, but the main feed is a feed like any other', () => {
    assert.equal(isLinkableFeed(FEEDS[1]), false);
    assert.equal(isLinkableFeed({ id: 'managed:x', managed: false }), false);
    assert.equal(isLinkableFeed(FEEDS[0]), true);
    assert.deepEqual(linkableFeeds(FEEDS).map(f => f.id), ['f-main', 'f-altar', 'f-second', 'f-prog', 'f-loose']);
  });

  it('lists the named feeds linked to one device, several allowed', () => {
    assert.deepEqual(feedsLinkedTo(FEEDS, 'camera', 'cam-1').map(f => f.id), ['f-altar', 'f-second']);
    assert.deepEqual(feedsLinkedTo(FEEDS, 'camera', 'cam-2'), []);
    assert.deepEqual(feedsLinkedTo(FEEDS, 'mixer', 'cam-1'), []);
  });

  it('offers every named feed except the ones already on this device, whatever their kind or label', () => {
    assert.deepEqual(linkCandidates(FEEDS, 'camera', 'cam-1').map(f => f.id), ['f-main', 'f-prog', 'f-loose']);
    assert.deepEqual(linkCandidates(FEEDS, 'camera', 'cam-9').map(f => f.id), ['f-main', 'f-altar', 'f-second', 'f-prog', 'f-loose']);
  });

  it('tolerates a missing feed list', () => {
    assert.deepEqual(linkableFeeds(undefined), []);
    assert.deepEqual(linkCandidates(null, 'camera', 'c'), []);
  });
});

describe('device names for the Feeds card chip', () => {
  it('keys names by type and id, and falls back to the id when a device has no name', () => {
    const names = buildDeviceNames({
      camera: [{ id: 'cam-1', name: 'Altar' }],
      mixer: [{ id: 'mix-1', name: '' }],
      encoder: [{ id: 'enc-1', name: 'Kodari' }],
    });
    assert.equal(names.get(deviceNameKey('camera', 'cam-1')), 'Altar');
    assert.equal(names.get('mixer:mix-1'), 'mix-1');
    assert.equal(names.get('encoder:enc-1'), 'Kodari');
  });

  it('leaves out a list that failed, so those devices show their id', () => {
    const names = buildDeviceNames({ camera: null, mixer: undefined });
    assert.equal(names.size, 0);
    assert.equal(names.has('camera:cam-1'), false);
  });

  it('does not let a camera id name a mixer with the same id', () => {
    const names = buildDeviceNames({ camera: [{ id: 'x', name: 'Cam' }] });
    assert.equal(names.has('mixer:x'), false);
  });
});
