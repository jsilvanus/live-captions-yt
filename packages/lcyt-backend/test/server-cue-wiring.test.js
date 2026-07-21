/**
 * Regression test for a real composition-root wiring bug found in code
 * review: server.js called createSoundCueListener() but never called its
 * sibling createTrackerCueListener(), so a track_state event emitted by
 * perception-aggregator.js (plan_video_perception.md Phase 2) never reached
 * the cue engine — a track: cue rule would silently never fire in the real
 * running server, even though the aggregator/listener logic was each
 * correct in isolation. This imports server.js itself (the composition
 * root), not a router constructed in isolation, specifically to catch this
 * class of bug — see packages/lcyt-backend/CLAUDE.md's Test Coverage gap
 * note ("server.js (Express factory)" was previously untested).
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'test-server-cue-wiring-secret';
process.env.PORT = '0';

const { db, store } = await import('../src/server.js');
const { createKey } = await import('../src/db.js');
const { insertCueRule } = await import('lcyt-cues/src/db.js');

const API_KEY = 'server-cue-wiring-key';

before(() => {
  createKey(db, { key: API_KEY, owner: 'Cue Wiring Test' });
  insertCueRule(db, {
    id: 'rule-track-person',
    api_key: API_KEY,
    name: 'Person detected',
    match_type: 'track',
    pattern: 'person',
    action: '{}',
    enabled: 1,
    cooldown_ms: 0,
    fuzzy_threshold: 0,
  });
});

after(() => db.close());

describe('server.js composition-root wiring: createTrackerCueListener', () => {
  it('fires a track: cue rule when a track_state event is emitted on a session emitter', async () => {
    const session = store.create({ apiKey: API_KEY, streamKey: '', domain: 'https://cue-wiring.test', jwt: 'x' });

    const fired = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('cue_fired never emitted — createTrackerCueListener is not wired')), 2000);
      session.emitter.on('event', (evt) => {
        if (evt.type === 'cue_fired') {
          clearTimeout(timeout);
          resolve(evt.data);
        }
      });
      session.emitter.emit('event', {
        type: 'track_state',
        data: { labels: [{ label: 'person', confidence: 0.9 }], ts: Date.now() },
      });
    });

    assert.equal(fired.matchType, 'track');
    assert.equal(fired.matched, 'track:person');
    assert.equal(fired.source, 'track');
  });
});
