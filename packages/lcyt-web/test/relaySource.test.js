import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  relaySelectableFeeds, groupRelaySourceFeeds, feedOptionLabel, linkedFeedForCamera,
  relaySourceValue, sourcePatch, sourceRequestFields, isFeedSourceValue,
} from '../src/lib/relaySource.js';

const FEEDS = [
  { id: 'managed:video', managed: true, name: 'Main', kind: 'generic', label: 'main', deviceType: null, deviceId: null },
  { id: 'managed:dsk', managed: true, name: 'DSK', kind: 'dsk', label: null, deviceType: null, deviceId: null },
  { id: 'f-altar', managed: false, name: 'Altar', kind: 'camera', label: null, deviceType: 'camera', deviceId: 'cam-1' },
  { id: 'f-prog', managed: false, name: 'Mixer 2', kind: 'generic', label: 'program', deviceType: 'mixer', deviceId: 'mix-1' },
  { id: 'f-loose', managed: false, name: 'Guest', kind: 'generic', label: null, deviceType: null, deviceId: null },
  { id: 'f-dsk', managed: false, name: 'Key feed', kind: 'dsk', label: null, deviceType: null, deviceId: null },
];

describe('relay source feeds', () => {
  it('leaves managed feeds (flag or managed: id) out of the picker', () => {
    assert.deepEqual(relaySelectableFeeds(FEEDS).map(f => f.id), ['f-altar', 'f-prog', 'f-loose', 'f-dsk']);
  });

  it('groups the named feeds by kind in camera, generic, dsk order and drops empty groups', () => {
    const groups = groupRelaySourceFeeds(FEEDS);
    assert.deepEqual(groups.map(g => g.kind), ['camera', 'generic', 'dsk']);
    assert.deepEqual(groups[1].feeds.map(f => f.id), ['f-prog', 'f-loose']);
    assert.deepEqual(groupRelaySourceFeeds([FEEDS[0], FEEDS[1]]), []);
  });

  it('treats an unknown kind as generic', () => {
    const groups = groupRelaySourceFeeds([{ id: 'x', name: 'X', kind: 'weird' }]);
    assert.deepEqual(groups.map(g => g.kind), ['generic']);
  });

  it('shows a generic feed with its label, other kinds by name', () => {
    assert.equal(feedOptionLabel(FEEDS[3]), 'Mixer 2 (program)');
    assert.equal(feedOptionLabel(FEEDS[2]), 'Altar');
    assert.equal(feedOptionLabel(FEEDS[5]), 'Key feed');
  });

  it('finds the selectable feed linked to a camera', () => {
    assert.equal(linkedFeedForCamera(FEEDS, 'cam-1').id, 'f-altar');
    assert.equal(linkedFeedForCamera(FEEDS, 'cam-9'), null);
    assert.equal(linkedFeedForCamera(FEEDS, ''), null);
  });
});

describe('relay source value and patch', () => {
  it('shows program or crop when no feed or camera is set', () => {
    assert.equal(relaySourceValue({ sourceView: 'program' }, FEEDS), 'program');
    assert.equal(relaySourceValue({ sourceView: 'crop' }, FEEDS), 'crop');
    assert.equal(relaySourceValue({}, FEEDS), 'program');
  });

  it('shows the selected feed', () => {
    assert.equal(relaySourceValue({ sourceFeedId: 'f-prog', sourceCameraId: '' }, FEEDS), 'feed:f-prog');
  });

  it('preselects the feed linked to a legacy camera slot', () => {
    assert.equal(relaySourceValue({ sourceCameraId: 'cam-1' }, FEEDS), 'feed:f-altar');
  });

  it('shows a legacy camera with no linked feed as a read-only legacy option', () => {
    const value = relaySourceValue({ sourceCameraId: 'cam-9' }, FEEDS);
    assert.equal(value, 'legacy-camera:cam-9');
    assert.equal(isFeedSourceValue(value), false);
  });

  it('a feed pick sends sourceFeedId and clears the camera', () => {
    assert.deepEqual(sourcePatch('feed:f-prog'), { sourceView: 'program', sourceFeedId: 'f-prog', sourceCameraId: '' });
  });

  it('program and crop clear both the feed and the camera', () => {
    assert.deepEqual(sourcePatch('crop'), { sourceView: 'crop', sourceFeedId: '', sourceCameraId: '' });
    assert.deepEqual(sourcePatch('program'), { sourceView: 'program', sourceFeedId: '', sourceCameraId: '' });
  });

  it('the legacy option is not selectable, so picking it changes nothing', () => {
    assert.equal(sourcePatch('legacy-camera:cam-9'), null);
  });
});

describe('relay request source fields', () => {
  it('sends a feed alone, never with a camera or view', () => {
    assert.deepEqual(sourceRequestFields({ sourceFeedId: 'f-prog', sourceCameraId: 'cam-1', sourceView: 'program' }), { sourceFeedId: 'f-prog' });
  });

  it('sends a legacy camera alone when there is no feed', () => {
    assert.deepEqual(sourceRequestFields({ sourceCameraId: 'cam-1', sourceView: 'program' }), { sourceCameraId: 'cam-1' });
  });

  it('sends the view when neither a feed nor a camera is set', () => {
    assert.deepEqual(sourceRequestFields({ sourceView: 'crop' }), { sourceView: 'crop' });
    assert.deepEqual(sourceRequestFields({}), {});
  });
});
