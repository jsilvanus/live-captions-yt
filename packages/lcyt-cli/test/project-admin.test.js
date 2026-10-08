import test from 'node:test';
import assert from 'node:assert';
import { ProjectAdminClient } from '../src/lib/project-client.js';

test('ProjectAdminClient - initialization', () => {
  // Valid initialization with admin key
  const client = new ProjectAdminClient({
    backendUrl: 'http://localhost:3000',
    adminKey: 'test-key',
  });

  assert.ok(client);
  assert.equal(client.backendUrl, 'http://localhost:3000');
});

test('ProjectAdminClient - missing backend URL', () => {
  assert.throws(() => {
    new ProjectAdminClient({
      adminKey: 'test-key',
    });
  }, /Backend URL is required/);
});

test('ProjectAdminClient - missing authentication', () => {
  assert.throws(() => {
    new ProjectAdminClient({
      backendUrl: 'http://localhost:3000',
    });
  }, /Admin key or JWT token is required/);
});

test('ProjectAdminClient - JWT token authentication', () => {
  const client = new ProjectAdminClient({
    backendUrl: 'http://localhost:3000',
    jwtToken: 'test-jwt-token',
  });

  assert.ok(client);
  assert.equal(client.jwtToken, 'test-jwt-token');
});

test('ProjectAdminClient - get headers with admin key', () => {
  const client = new ProjectAdminClient({
    backendUrl: 'http://localhost:3000',
    adminKey: 'test-key',
  });

  const headers = client._getHeaders();
  assert.equal(headers['X-Admin-Key'], 'test-key');
  assert.equal(headers['Content-Type'], 'application/json');
});

test('ProjectAdminClient - get headers with JWT token', () => {
  const client = new ProjectAdminClient({
    backendUrl: 'http://localhost:3000',
    jwtToken: 'test-jwt-token',
  });

  const headers = client._getHeaders();
  assert.ok(headers['Authorization'].startsWith('Bearer '));
  assert.equal(headers['Content-Type'], 'application/json');
});
