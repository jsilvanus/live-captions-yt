import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import EventEmitter from 'node:events';
import http from 'node:http';
import https from 'node:https';
import { YoutubeLiveCaptionSender } from '../src/sender.js';

describe('Transport protocol selection', () => {
  let origHttpRequest;
  let origHttpsRequest;

  beforeEach(() => {
    origHttpRequest = http.request;
    origHttpsRequest = https.request;
  });

  afterEach(() => {
    http.request = origHttpRequest;
    https.request = origHttpsRequest;
  });

  it('uses http.request for http URLs', async () => {
    let httpCalled = false;
    let httpsCalled = false;

    http.request = (options, cb) => {
      httpCalled = true;
      const req = new EventEmitter();
      req.write = () => {};
      req.end = () => {
        const res = new EventEmitter();
        res.statusCode = 200;
        setImmediate(() => { res.emit('data', 'ok'); res.emit('end'); });
        cb(res);
      };
      req.on = req.addListener;
      return req;
    };

    https.request = () => { httpsCalled = true; return null; };

    const sender = new YoutubeLiveCaptionSender({ ingestionUrl: 'http://example.test/captions' });
    sender.start();
    const res = await sender.send('hello');

    assert.strictEqual(httpCalled, true, 'http.request should be called for http: URLs');
    assert.strictEqual(httpsCalled, false, 'https.request should not be called for http: URLs');
    assert.strictEqual(res.statusCode, 200);
  });

  it('uses https.request for https URLs', async () => {
    let httpCalled = false;
    let httpsCalled = false;

    https.request = (options, cb) => {
      httpsCalled = true;
      const req = new EventEmitter();
      req.write = () => {};
      req.end = () => {
        const res = new EventEmitter();
        res.statusCode = 200;
        setImmediate(() => { res.emit('data', 'ok'); res.emit('end'); });
        cb(res);
      };
      req.on = req.addListener;
      return req;
    };

    http.request = () => { httpCalled = true; return null; };

    const sender = new YoutubeLiveCaptionSender({ ingestionUrl: 'https://secure.test/captions' });
    sender.start();
    const res = await sender.send('secure');

    assert.strictEqual(httpsCalled, true, 'https.request should be called for https: URLs');
    assert.strictEqual(httpCalled, false, 'http.request should not be called for https: URLs');
    assert.strictEqual(res.statusCode, 200);
  });
});
