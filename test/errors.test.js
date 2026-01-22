const { describe, it } = require('node:test');
const assert = require('node:assert');
const { LCYTError, ConfigError, NetworkError, ValidationError } = require('../src/errors');

describe('Error Classes', () => {
  describe('LCYTError', () => {
    it('should be an instance of Error', () => {
      const error = new LCYTError('test message');
      assert(error instanceof Error);
      assert(error instanceof LCYTError);
    });

    it('should have correct name and message', () => {
      const error = new LCYTError('test message');
      assert.strictEqual(error.name, 'LCYTError');
      assert.strictEqual(error.message, 'test message');
    });
  });

  describe('ConfigError', () => {
    it('should be an instance of LCYTError', () => {
      const error = new ConfigError('config error');
      assert(error instanceof Error);
      assert(error instanceof LCYTError);
      assert(error instanceof ConfigError);
    });

    it('should have correct name', () => {
      const error = new ConfigError('config error');
      assert.strictEqual(error.name, 'ConfigError');
    });
  });

  describe('NetworkError', () => {
    it('should be an instance of LCYTError', () => {
      const error = new NetworkError('network error');
      assert(error instanceof Error);
      assert(error instanceof LCYTError);
      assert(error instanceof NetworkError);
    });

    it('should have correct name', () => {
      const error = new NetworkError('network error');
      assert.strictEqual(error.name, 'NetworkError');
    });

    it('should store statusCode', () => {
      const error = new NetworkError('network error', 500);
      assert.strictEqual(error.statusCode, 500);
    });

    it('should default statusCode to null', () => {
      const error = new NetworkError('network error');
      assert.strictEqual(error.statusCode, null);
    });
  });

  describe('ValidationError', () => {
    it('should be an instance of LCYTError', () => {
      const error = new ValidationError('validation error');
      assert(error instanceof Error);
      assert(error instanceof LCYTError);
      assert(error instanceof ValidationError);
    });

    it('should have correct name', () => {
      const error = new ValidationError('validation error');
      assert.strictEqual(error.name, 'ValidationError');
    });

    it('should store field', () => {
      const error = new ValidationError('validation error', 'email');
      assert.strictEqual(error.field, 'email');
    });

    it('should default field to null', () => {
      const error = new ValidationError('validation error');
      assert.strictEqual(error.field, null);
    });
  });
});
