/**
 * Tests for HlsManager codec parsing and bandwidth computation methods.
 *
 * Focus on _buildCodecsString and _computeBandwidth since probeStreamInfo
 * uses spawnSync which is hard to mock in integration tests.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { HlsManager } from '../src/hls-manager.js';

describe('HlsManager — codec and bandwidth helpers', () => {
  it('initializes _probeCache as a Map', () => {
    const mgr = new HlsManager({ hlsRoot: '/tmp/hls' });
    assert.ok(mgr._probeCache instanceof Map);
    assert.equal(mgr._probeCache.size, 0);
  });

  it('_computeBandwidth sums video and audio bitrates', () => {
    const mgr = new HlsManager({ hlsRoot: '/tmp/hls' });
    const videoStream = { bit_rate: '2500000' };
    const audioStream = { bit_rate: '128000' };

    const bandwidth = mgr._computeBandwidth(videoStream, audioStream);
    assert.equal(bandwidth, 2628000);
  });

  it('_computeBandwidth returns 0 when both streams lack bitrate', () => {
    const mgr = new HlsManager({ hlsRoot: '/tmp/hls' });
    const videoStream = {};
    const audioStream = {};

    const bandwidth = mgr._computeBandwidth(videoStream, audioStream);
    assert.equal(bandwidth, 0);
  });

  it('_computeBandwidth uses only video bitrate when audio is missing', () => {
    const mgr = new HlsManager({ hlsRoot: '/tmp/hls' });
    const videoStream = { bit_rate: '2500000' };

    const bandwidth = mgr._computeBandwidth(videoStream, null);
    assert.equal(bandwidth, 2500000);
  });

  it('_computeBandwidth parses bitrate as integer string', () => {
    const mgr = new HlsManager({ hlsRoot: '/tmp/hls' });
    const videoStream = { bit_rate: '2500000' };
    const audioStream = { bit_rate: '128000' };

    const bandwidth = mgr._computeBandwidth(videoStream, audioStream);
    assert.equal(typeof bandwidth, 'number');
    assert.equal(bandwidth, 2628000);
  });

  it('_buildCodecsString encodes H.264 with profile and level', () => {
    const mgr = new HlsManager({ hlsRoot: '/tmp/hls' });
    const videoStream = { codec_name: 'h264', profile: 'Main', level: 42 };
    const audioStream = { codec_name: 'aac' };

    const codecs = mgr._buildCodecsString(videoStream, audioStream);
    assert.ok(codecs.includes('avc1'));
    assert.ok(codecs.includes('mp4a.40.2'));
    assert.ok(codecs.startsWith('"') && codecs.endsWith('"'));
  });

  it('_buildCodecsString uses profile Baseline for unknown profiles', () => {
    const mgr = new HlsManager({ hlsRoot: '/tmp/hls' });
    const videoStream = { codec_name: 'h264', profile: 'Unknown', level: 30 };
    const audioStream = null;

    const codecs = mgr._buildCodecsString(videoStream, audioStream);
    assert.ok(codecs.includes('avc1'));
  });

  it('_buildCodecsString encodes H.265/HEVC', () => {
    const mgr = new HlsManager({ hlsRoot: '/tmp/hls' });
    const videoStream = { codec_name: 'hevc', level: 93 };
    const audioStream = { codec_name: 'aac' };

    const codecs = mgr._buildCodecsString(videoStream, audioStream);
    assert.ok(codecs.includes('hev1'));
  });

  it('_buildCodecsString encodes H.265 (h265 name)', () => {
    const mgr = new HlsManager({ hlsRoot: '/tmp/hls' });
    const videoStream = { codec_name: 'h265', level: 93 };
    const audioStream = { codec_name: 'aac' };

    const codecs = mgr._buildCodecsString(videoStream, audioStream);
    assert.ok(codecs.includes('hev1'));
  });

  it('_buildCodecsString encodes AAC-LC and HE-AAC', () => {
    const mgr = new HlsManager({ hlsRoot: '/tmp/hls' });
    const videoStream = { codec_name: 'h264', profile: 'Main', level: 40 };
    const audioStreamLc = { codec_name: 'aac', profile: 'LC' };
    const audioStreamHe = { codec_name: 'aac', profile: 'HE-AAC' };

    const codecsLc = mgr._buildCodecsString(videoStream, audioStreamLc);
    const codecsHe = mgr._buildCodecsString(videoStream, audioStreamHe);

    assert.ok(codecsLc.includes('mp4a.40.2'), 'AAC LC = profile 2');
    assert.ok(codecsHe.includes('mp4a.40.5'), 'HE-AAC = profile 5');
  });

  it('_buildCodecsString encodes MP3', () => {
    const mgr = new HlsManager({ hlsRoot: '/tmp/hls' });
    const videoStream = { codec_name: 'h264', profile: 'Main', level: 40 };
    const audioStream = { codec_name: 'mp3' };

    const codecs = mgr._buildCodecsString(videoStream, audioStream);
    assert.ok(codecs.includes('mp4a.69'));
  });

  it('_buildCodecsString handles libmp3lame (ffmpeg MP3 encoder)', () => {
    const mgr = new HlsManager({ hlsRoot: '/tmp/hls' });
    const videoStream = { codec_name: 'h264', profile: 'Main', level: 40 };
    const audioStream = { codec_name: 'libmp3lame' };

    const codecs = mgr._buildCodecsString(videoStream, audioStream);
    assert.ok(codecs.includes('mp4a.69'));
  });

  it('_buildCodecsString returns fallback for unknown video codec', () => {
    const mgr = new HlsManager({ hlsRoot: '/tmp/hls' });
    const videoStream = { codec_name: 'unknown_codec' };
    const audioStream = { codec_name: 'aac' };

    const codecs = mgr._buildCodecsString(videoStream, audioStream);
    assert.ok(codecs.includes('avc1.4d401f'), 'should use H.264 baseline fallback');
  });

  it('_buildCodecsString returns fallback for unknown audio codec', () => {
    const mgr = new HlsManager({ hlsRoot: '/tmp/hls' });
    const videoStream = { codec_name: 'h264', profile: 'Main', level: 40 };
    const audioStream = { codec_name: 'opus' };

    const codecs = mgr._buildCodecsString(videoStream, audioStream);
    assert.ok(codecs.includes('avc1'));
    assert.ok(codecs.includes('mp4a.40.2'), 'should use AAC-LC fallback');
  });

  it('_buildCodecsString wraps result in double quotes', () => {
    const mgr = new HlsManager({ hlsRoot: '/tmp/hls' });
    const videoStream = { codec_name: 'h264', profile: 'Main', level: 40 };
    const audioStream = { codec_name: 'aac' };

    const codecs = mgr._buildCodecsString(videoStream, audioStream);
    assert.ok(codecs.startsWith('"') && codecs.endsWith('"'));
  });

  it('_buildCodecsString returns fallback when no streams provided', () => {
    const mgr = new HlsManager({ hlsRoot: '/tmp/hls' });

    const codecs = mgr._buildCodecsString(null, null);
    assert.deepEqual(codecs, '"avc1.4d401f,mp4a.40.2"');
  });

  it('_defaultStreamInfo returns hard-coded fallback values', () => {
    const mgr = new HlsManager({ hlsRoot: '/tmp/hls' });

    const info = mgr._defaultStreamInfo();
    assert.equal(info.bandwidth, 2800000);
    assert.equal(info.codecs, '"avc1.4d401f,mp4a.40.2"');
  });

  it('probeStreamInfo cache is empty after construction', () => {
    const mgr = new HlsManager({ hlsRoot: '/tmp/hls' });
    assert.equal(mgr._probeCache.size, 0);
  });
});
