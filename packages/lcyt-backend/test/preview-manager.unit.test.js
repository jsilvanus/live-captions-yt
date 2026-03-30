import { test } from 'node:test';
import assert from 'node:assert/strict';

// PreviewManager lives in the rtmp plugin
import { PreviewManager } from '../../plugins/lcyt-rtmp/src/preview-manager.js';

test('PreviewManager — isRunning returns false initially', () => {
  const manager = new PreviewManager();
  assert.equal(manager.isRunning('test-key'), false);
});

test('PreviewManager — start/stop lifecycle', async () => {
  const manager = new PreviewManager();
  const key = 'test-key';

  await manager.start(key);
  assert.equal(manager.isRunning(key), true, 'should be running after start');

  await manager.stop(key);
  assert.equal(manager.isRunning(key), false, 'should not be running after stop');
});

test('PreviewManager — stop is a no-op for non-running key', async () => {
  const manager = new PreviewManager();
  await assert.doesNotReject(() => manager.stop('never-started'));
});

test('PreviewManager — stopAll clears all active keys', async () => {
  const manager = new PreviewManager();
  await manager.start('k1');
  await manager.start('k2');
  assert.equal(manager.isRunning('k1'), true);
  assert.equal(manager.isRunning('k2'), true);

  await manager.stopAll();
  assert.equal(manager.isRunning('k1'), false);
  assert.equal(manager.isRunning('k2'), false);
});

test('PreviewManager — fetchThumbnail returns null without mediamtxClient', async () => {
  const manager = new PreviewManager();
  const result = await manager.fetchThumbnail('test-key');
  assert.equal(result, null);
});

test('PreviewManager — getWebRtcUrl returns URL containing the key', () => {
  const manager = new PreviewManager({ webrtcBase: 'http://localhost:8889' });
  const url = manager.getWebRtcUrl('mykey');
  assert.ok(url.includes('mykey'), `expected URL to include key, got: ${url}`);
  assert.ok(url.startsWith('http://localhost:8889'), `expected URL to start with base, got: ${url}`);
});
