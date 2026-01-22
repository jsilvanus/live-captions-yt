const { describe, it, mock, beforeEach } = require('node:test');
const assert = require('node:assert');
const { YoutubeLiveCaptionSender } = require('../src/sender');
const { ConfigError, ValidationError, NetworkError } = require('../src/errors');

describe('YoutubeLiveCaptionSender', () => {
  describe('constructor', () => {
    it('should initialize with default values', () => {
      const sender = new YoutubeLiveCaptionSender();
      assert.strictEqual(sender.ingestionUrl, null);
      assert.strictEqual(sender.lang, 'en');
      assert.strictEqual(sender.name, 'LCYT');
      assert.strictEqual(sender.sequence, 0);
      assert.strictEqual(sender.isStarted, false);
    });

    it('should accept custom options', () => {
      const sender = new YoutubeLiveCaptionSender({
        ingestionUrl: 'https://example.com/captions',
        lang: 'es',
        name: 'MyStream',
        sequence: 10
      });
      assert.strictEqual(sender.ingestionUrl, 'https://example.com/captions');
      assert.strictEqual(sender.lang, 'es');
      assert.strictEqual(sender.name, 'MyStream');
      assert.strictEqual(sender.sequence, 10);
    });
  });

  describe('start()', () => {
    it('should set isStarted to true', () => {
      const sender = new YoutubeLiveCaptionSender();
      sender.start();
      assert.strictEqual(sender.isStarted, true);
    });

    it('should return the sender instance for chaining', () => {
      const sender = new YoutubeLiveCaptionSender();
      const result = sender.start();
      assert.strictEqual(result, sender);
    });
  });

  describe('end()', () => {
    it('should set isStarted to false', () => {
      const sender = new YoutubeLiveCaptionSender();
      sender.start();
      sender.end();
      assert.strictEqual(sender.isStarted, false);
    });

    it('should return the sender instance for chaining', () => {
      const sender = new YoutubeLiveCaptionSender();
      sender.start();
      const result = sender.end();
      assert.strictEqual(result, sender);
    });
  });

  describe('_formatTimestamp()', () => {
    it('should remove Z suffix from ISO timestamp', () => {
      const sender = new YoutubeLiveCaptionSender();
      const result = sender._formatTimestamp('2024-01-15T12:00:00.000Z');
      assert.strictEqual(result, '2024-01-15T12:00:00.000');
    });

    it('should keep timestamp without Z suffix as-is', () => {
      const sender = new YoutubeLiveCaptionSender();
      const result = sender._formatTimestamp('2024-01-15T12:00:00.000');
      assert.strictEqual(result, '2024-01-15T12:00:00.000');
    });

    it('should generate timestamp when none provided', () => {
      const sender = new YoutubeLiveCaptionSender();
      const result = sender._formatTimestamp();
      assert.match(result, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}$/);
      assert.ok(!result.endsWith('Z'));
    });
  });

  describe('send()', () => {
    it('should reject if sender not started', async () => {
      const sender = new YoutubeLiveCaptionSender({
        ingestionUrl: 'https://example.com/captions'
      });

      await assert.rejects(
        () => sender.send('Hello'),
        (err) => {
          assert(err instanceof ValidationError);
          assert.match(err.message, /not started/i);
          return true;
        }
      );
    });

    it('should reject if no ingestion URL configured', async () => {
      const sender = new YoutubeLiveCaptionSender();
      sender.start();

      await assert.rejects(
        () => sender.send('Hello'),
        (err) => {
          assert(err instanceof ConfigError);
          assert.match(err.message, /URL/i);
          return true;
        }
      );
    });

    it('should reject if text is empty', async () => {
      const sender = new YoutubeLiveCaptionSender({
        ingestionUrl: 'https://example.com/captions'
      });
      sender.start();

      await assert.rejects(
        () => sender.send(''),
        (err) => {
          assert(err instanceof ValidationError);
          assert.match(err.message, /text/i);
          return true;
        }
      );
    });

    it('should reject if text is not a string', async () => {
      const sender = new YoutubeLiveCaptionSender({
        ingestionUrl: 'https://example.com/captions'
      });
      sender.start();

      await assert.rejects(
        () => sender.send(123),
        (err) => {
          assert(err instanceof ValidationError);
          return true;
        }
      );
    });

    it('should reject for invalid URL', async () => {
      const sender = new YoutubeLiveCaptionSender({
        ingestionUrl: 'not-a-valid-url'
      });
      sender.start();

      await assert.rejects(
        () => sender.send('Hello'),
        (err) => {
          assert(err instanceof ConfigError);
          assert.match(err.message, /Invalid ingestion URL/i);
          return true;
        }
      );
    });
  });

  describe('sendBatch()', () => {
    it('should reject if sender not started', async () => {
      const sender = new YoutubeLiveCaptionSender({
        ingestionUrl: 'https://example.com/captions'
      });

      await assert.rejects(
        () => sender.sendBatch([{ text: 'Hello' }]),
        (err) => {
          assert(err instanceof ValidationError);
          assert.match(err.message, /not started/i);
          return true;
        }
      );
    });

    it('should reject if no ingestion URL configured', async () => {
      const sender = new YoutubeLiveCaptionSender();
      sender.start();

      await assert.rejects(
        () => sender.sendBatch([{ text: 'Hello' }]),
        (err) => {
          assert(err instanceof ConfigError);
          assert.match(err.message, /URL/i);
          return true;
        }
      );
    });

    it('should reject if captions is not an array', async () => {
      const sender = new YoutubeLiveCaptionSender({
        ingestionUrl: 'https://example.com/captions'
      });
      sender.start();

      await assert.rejects(
        () => sender.sendBatch('not an array'),
        (err) => {
          assert(err instanceof ValidationError);
          assert.match(err.message, /non-empty array/i);
          return true;
        }
      );
    });

    it('should reject if captions array is empty', async () => {
      const sender = new YoutubeLiveCaptionSender({
        ingestionUrl: 'https://example.com/captions'
      });
      sender.start();

      await assert.rejects(
        () => sender.sendBatch([]),
        (err) => {
          assert(err instanceof ValidationError);
          assert.match(err.message, /non-empty array/i);
          return true;
        }
      );
    });

    it('should reject if caption in array has no text', async () => {
      const sender = new YoutubeLiveCaptionSender({
        ingestionUrl: 'https://example.com/captions'
      });
      sender.start();

      await assert.rejects(
        () => sender.sendBatch([{ text: 'Hello' }, { notext: true }]),
        (err) => {
          assert(err instanceof ValidationError);
          assert.match(err.message, /index 1/i);
          return true;
        }
      );
    });
  });

  describe('heartbeat()', () => {
    it('should reject if sender not started', async () => {
      const sender = new YoutubeLiveCaptionSender({
        ingestionUrl: 'https://example.com/captions'
      });

      await assert.rejects(
        () => sender.heartbeat(),
        (err) => {
          assert(err instanceof ValidationError);
          assert.match(err.message, /not started/i);
          return true;
        }
      );
    });

    it('should reject if no ingestion URL configured', async () => {
      const sender = new YoutubeLiveCaptionSender();
      sender.start();

      await assert.rejects(
        () => sender.heartbeat(),
        (err) => {
          assert(err instanceof ConfigError);
          assert.match(err.message, /URL/i);
          return true;
        }
      );
    });
  });

  describe('getSequence() / setSequence()', () => {
    it('should get the current sequence', () => {
      const sender = new YoutubeLiveCaptionSender({ sequence: 5 });
      assert.strictEqual(sender.getSequence(), 5);
    });

    it('should set the sequence', () => {
      const sender = new YoutubeLiveCaptionSender();
      sender.setSequence(10);
      assert.strictEqual(sender.getSequence(), 10);
    });

    it('should return sender instance for chaining', () => {
      const sender = new YoutubeLiveCaptionSender();
      const result = sender.setSequence(10);
      assert.strictEqual(result, sender);
    });
  });
});
