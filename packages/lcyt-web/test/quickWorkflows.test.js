import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCaptionKey, maskKey, findYoutubeTarget, withYoutubeKey, withoutYoutubeTarget, auditorLanguage,
} from '../src/lib/quickTargets.js';
import {
  YOUTUBE_RTMP_URL, parseStreamKey, isRtmpUrl, outputFormError, outputBody, formFromRelay, relayDetail,
  sortedRelays, relayState,
} from '../src/lib/quickRestream.js';

describe('parseCaptionKey()', () => {
  it('accepts a bare key', () => assert.equal(parseCaptionKey('  abcd-1234-efgh-5678 '), 'abcd-1234-efgh-5678'));
  it('takes the cid out of the POST URL', () => {
    assert.equal(parseCaptionKey('http://upload.youtube.com/closedcaption?cid=abcd-1234'), 'abcd-1234');
    assert.equal(parseCaptionKey('https://x.example/closedcaption?a=1&cid=k-9&b=2'), 'k-9');
  });
  it('refuses a URL without a cid and text with spaces', () => {
    assert.equal(parseCaptionKey('http://upload.youtube.com/closedcaption'), '');
    assert.equal(parseCaptionKey('two words'), '');
    assert.equal(parseCaptionKey(''), '');
    assert.equal(parseCaptionKey(null), '');
  });
});

describe('YouTube target in the target list', () => {
  const other = { id: 'g1', enabled: true, type: 'generic', url: 'https://hook.example' };
  it('maskKey shows only the last four characters', () => {
    assert.equal(maskKey('abcd-1234'), '••••1234');
    assert.equal(maskKey(''), '');
  });
  it('adds a target when there is none and leaves the others alone', () => {
    const list = withYoutubeKey([other], 'k1', () => 'new-id');
    assert.equal(list.length, 2);
    assert.deepEqual(list[1], { id: 'new-id', enabled: true, type: 'youtube', streamKey: 'k1' });
    assert.equal(list[0], other);
  });
  it('replaces the key of the existing target, keeps its id and switches it on', () => {
    const list = withYoutubeKey([{ id: 'y1', enabled: false, type: 'youtube', streamKey: 'old', noBatch: true }, other], 'k2', () => 'x');
    assert.equal(list.length, 2);
    assert.deepEqual(list[0], { id: 'y1', enabled: true, type: 'youtube', streamKey: 'k2', noBatch: true });
  });
  it('finds and removes the YouTube target', () => {
    const list = [other, { id: 'y1', type: 'youtube', streamKey: 'k' }];
    assert.equal(findYoutubeTarget(list).id, 'y1');
    assert.deepEqual(withoutYoutubeTarget(list), [other]);
    assert.equal(findYoutubeTarget([other]), null);
    assert.equal(findYoutubeTarget(undefined), null);
  });
  it('auditorLanguage cuts the region', () => {
    assert.equal(auditorLanguage('fi-FI'), 'fi');
    assert.equal(auditorLanguage('SV'), 'sv');
  });
});

describe('restream outputs', () => {
  it('parseStreamKey takes a key or the tail of an rtmp URL', () => {
    assert.equal(parseStreamKey(' ab12-cd34 '), 'ab12-cd34');
    assert.equal(parseStreamKey('rtmp://a.rtmp.youtube.com/live2/ab12-cd34'), 'ab12-cd34');
    assert.equal(parseStreamKey('rtmp://a.rtmp.youtube.com/live2/'), '');
    assert.equal(parseStreamKey('a b'), '');
  });
  it('isRtmpUrl accepts rtmp and rtmps only', () => {
    assert.equal(isRtmpUrl('rtmp://host/app'), true);
    assert.equal(isRtmpUrl('rtmps://host:443/app/key'), true);
    assert.equal(isRtmpUrl('http://host/app'), false);
    assert.equal(isRtmpUrl('rtmp://'), false);
  });
  it('outputFormError names what is missing', () => {
    assert.equal(outputFormError({ type: 'youtube', youtubeKey: '' }), 'noKey');
    assert.equal(outputFormError({ type: 'youtube', youtubeKey: 'k' }), null);
    assert.equal(outputFormError({ type: 'generic', url: 'nope' }), 'badUrl');
    assert.equal(outputFormError({ type: 'generic', url: 'rtmp://h/a' }), null);
  });
  it('outputBody builds the /stream body and round-trips through formFromRelay', () => {
    const yt = outputBody({ type: 'youtube', youtubeKey: 'rtmp://a.rtmp.youtube.com/live2/kk-11' });
    assert.deepEqual(yt, { targetUrl: YOUTUBE_RTMP_URL, targetName: 'kk-11', captionMode: 'http' });
    assert.equal('slot' in yt, false);
    assert.deepEqual(formFromRelay({ ...yt, slot: 2 }), { type: 'youtube', youtubeKey: 'kk-11', url: '', name: '' });
    const gen = outputBody({ type: 'generic', url: ' rtmp://h/app ', name: ' Church FB ' }, 3);
    assert.deepEqual(gen, { targetUrl: 'rtmp://h/app', targetName: 'Church FB', captionMode: 'http', slot: 3 });
    assert.deepEqual(formFromRelay(gen), { type: 'generic', youtubeKey: '', url: 'rtmp://h/app', name: 'Church FB' });
    assert.equal(outputBody({ type: 'generic', url: 'rtmp://h/a', name: ' ' }).targetName, null);
  });
  it('relayDetail masks a YouTube key and hides the path of a generic URL', () => {
    assert.equal(relayDetail({ targetUrl: YOUTUBE_RTMP_URL, targetName: 'abcd-1234' }), '••••1234');
    assert.equal(relayDetail({ targetUrl: 'rtmps://live.example.com:443/app/SECRET' }), 'rtmps://live.example.com:443/…');
    assert.equal(relayDetail({ targetUrl: 'rtmp://h' }), 'rtmp://h');
  });
  it('sortedRelays orders by slot without changing the input', () => {
    const input = [{ slot: 3 }, { slot: 1 }];
    assert.deepEqual(sortedRelays(input).map(r => r.slot), [1, 3]);
    assert.deepEqual(input.map(r => r.slot), [3, 1]);
  });
  it('relayState', () => {
    assert.equal(relayState({ active: false, runningSlots: [] }, true), 'off');
    assert.equal(relayState({ active: true, runningSlots: [1] }, true), 'running');
    assert.equal(relayState({ active: true, runningSlots: [] }, false), 'waiting');
    assert.equal(relayState({ active: true, runningSlots: [] }, true), 'stalled');
    assert.equal(relayState(null, true), 'off');
  });
});

import { splitIngestUrl } from '../src/lib/quickRestream.js';

describe('splitIngestUrl()', () => {
  it('splits server and key', () => {
    assert.deepEqual(splitIngestUrl('rtmp://rtmp.lcyt.fi/stream/abc123'), { server: 'rtmp://rtmp.lcyt.fi/stream', key: 'abc123' });
    assert.deepEqual(splitIngestUrl('rtmp://h/app/key/'), { server: 'rtmp://h/app', key: 'key' });
  });
  it('gives no key when the URL has only a host', () => {
    assert.deepEqual(splitIngestUrl('rtmp://host'), { server: 'rtmp://host', key: '' });
    assert.deepEqual(splitIngestUrl(''), { server: '', key: '' });
  });
});
