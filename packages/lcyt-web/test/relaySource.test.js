import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  relaySelectableFeeds, groupRelaySourceFeeds, feedOptionLabel,
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

});

describe('relay source value and patch', () => {
  it('shows program or crop when no feed is set', () => {
    assert.equal(relaySourceValue({ sourceView: 'program' }), 'program');
    assert.equal(relaySourceValue({ sourceView: 'crop' }), 'crop');
    assert.equal(relaySourceValue({}), 'program');
  });

  it('shows the selected feed', () => {
    assert.equal(relaySourceValue({ sourceFeedId: 'f-prog' }), 'feed:f-prog');
  });

  it('a feed pick sends sourceFeedId with the view at program', () => {
    assert.deepEqual(sourcePatch('feed:f-prog'), { sourceView: 'program', sourceFeedId: 'f-prog' });
  });

  it('program and crop clear the feed', () => {
    assert.deepEqual(sourcePatch('crop'), { sourceView: 'crop', sourceFeedId: '' });
    assert.deepEqual(sourcePatch('program'), { sourceView: 'program', sourceFeedId: '' });
  });

  it('an unknown value changes nothing', () => {
    assert.equal(sourcePatch('legacy-camera:cam-9'), null);
  });
});

describe('relay request source fields', () => {
  it('sends a feed alone, never with the view', () => {
    assert.deepEqual(sourceRequestFields({ sourceFeedId: 'f-prog', sourceView: 'program' }), { sourceFeedId: 'f-prog' });
  });

  it('sends the view when no feed is set', () => {
    assert.deepEqual(sourceRequestFields({ sourceView: 'crop' }), { sourceView: 'crop' });
    assert.deepEqual(sourceRequestFields({}), {});
  });
});
