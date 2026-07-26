/**
 * Unit tests for SecurityPolicy — the bridge-side cache of a bridge
 * instance's TCP command / target IP allow-deny rules, checked before any
 * command touches the network (defense-in-depth alongside the backend's
 * authoritative BridgeManager.sendCommand() check).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SecurityPolicy } from '../src/security-policy.js';

describe('SecurityPolicy — fail-closed until first load', () => {
  it('isLoaded() is false before any update()', () => {
    const policy = new SecurityPolicy();
    assert.equal(policy.isLoaded(), false);
  });

  it('checkIp() rejects before the first successful policy fetch', () => {
    const policy = new SecurityPolicy();
    const result = policy.checkIp('10.0.0.1', 9000);
    assert.equal(result.allowed, false);
    assert.match(result.reason, /not yet loaded/);
  });

  it('checkCommand() rejects before the first successful policy fetch', () => {
    const policy = new SecurityPolicy();
    const result = policy.checkCommand('PRESET-1');
    assert.equal(result.allowed, false);
    assert.match(result.reason, /not yet loaded/);
  });

  it('isLoaded() becomes true after update(), even with empty rule arrays', () => {
    const policy = new SecurityPolicy();
    policy.update({ ipRules: [], commandRules: [] });
    assert.equal(policy.isLoaded(), true);
    assert.equal(policy.checkIp('10.0.0.1', 9000).allowed, true, 'default-allow once loaded with no rules');
  });

  it('update() with no argument still marks the policy loaded (default-allow)', () => {
    const policy = new SecurityPolicy();
    policy.update();
    assert.equal(policy.isLoaded(), true);
    assert.equal(policy.checkCommand('anything').allowed, true);
  });
});

describe('SecurityPolicy.checkIp — precedence', () => {
  it('deny-only mode blocks a matching pattern, allows everything else', () => {
    const policy = new SecurityPolicy();
    policy.update({ ipRules: [{ ruleType: 'deny', pattern: '10.0.0.1' }] });
    assert.equal(policy.checkIp('10.0.0.1', 9000).allowed, false);
    assert.equal(policy.checkIp('10.0.0.2', 9000).allowed, true);
  });

  it('allow-only mode switches to default-deny', () => {
    const policy = new SecurityPolicy();
    policy.update({ ipRules: [{ ruleType: 'allow', pattern: '10.0.0.1' }] });
    assert.equal(policy.checkIp('10.0.0.1', 9000).allowed, true);
    assert.equal(policy.checkIp('10.0.0.2', 9000).allowed, false);
  });

  it('deny always wins over an overlapping allow rule', () => {
    const policy = new SecurityPolicy();
    policy.update({ ipRules: [
      { ruleType: 'allow', pattern: '10.0.0.0/24' },
      { ruleType: 'deny', pattern: '10.0.0.50' },
    ] });
    assert.equal(policy.checkIp('10.0.0.50', 9000).allowed, false);
    assert.equal(policy.checkIp('10.0.0.51', 9000).allowed, true);
  });

  it('honours a :port suffix on the pattern', () => {
    const policy = new SecurityPolicy();
    policy.update({ ipRules: [{ ruleType: 'deny', pattern: '10.0.0.1:9000' }] });
    assert.equal(policy.checkIp('10.0.0.1', 9000).allowed, false);
    assert.equal(policy.checkIp('10.0.0.1', 9001).allowed, true);
  });

  it('matches a CIDR range', () => {
    const policy = new SecurityPolicy();
    policy.update({ ipRules: [{ ruleType: 'deny', pattern: '192.168.1.0/24' }] });
    assert.equal(policy.checkIp('192.168.1.99', 80).allowed, false);
    assert.equal(policy.checkIp('192.168.2.99', 80).allowed, true);
  });
});

describe('SecurityPolicy.checkCommand — precedence', () => {
  it('deny-only mode blocks a matching command, allows the rest', () => {
    const policy = new SecurityPolicy();
    policy.update({ commandRules: [{ ruleType: 'deny', pattern: '^FACTORY-RESET$' }] });
    assert.equal(policy.checkCommand('FACTORY-RESET').allowed, false);
    assert.equal(policy.checkCommand('PRESET-1').allowed, true);
  });

  it('allow-only mode switches to default-deny', () => {
    const policy = new SecurityPolicy();
    policy.update({ commandRules: [{ ruleType: 'allow', pattern: '^PRESET-[0-9]+$' }] });
    assert.equal(policy.checkCommand('PRESET-3').allowed, true);
    assert.equal(policy.checkCommand('FACTORY-RESET').allowed, false);
  });

  it('an invalid regex never matches (fails safe, not throws)', () => {
    const policy = new SecurityPolicy();
    policy.update({ commandRules: [{ ruleType: 'deny', pattern: '(unclosed' }] });
    assert.doesNotThrow(() => policy.checkCommand('anything'));
    assert.equal(policy.checkCommand('anything').allowed, true, 'a malformed deny pattern never matches, so nothing is blocked by it');
  });
});

describe('SecurityPolicy — stale-cache-on-refetch-failure semantics', () => {
  it('a later update() call fully replaces the previous rule set', () => {
    const policy = new SecurityPolicy();
    policy.update({ ipRules: [{ ruleType: 'deny', pattern: '10.0.0.1' }] });
    assert.equal(policy.checkIp('10.0.0.1', 80).allowed, false);

    // Simulate a successful refetch with a rule removed server-side.
    policy.update({ ipRules: [] });
    assert.equal(policy.checkIp('10.0.0.1', 80).allowed, true);
  });

  it('the caller is expected to skip update() on a failed refetch, keeping the last known-good policy', () => {
    // This is exercised at the Bridge._fetchSecurityPolicy() level (only
    // calls securityPolicy.update() on a successful fetch) — documented
    // here as the contract SecurityPolicy itself relies on: it has no
    // implicit expiry, so whatever was last passed to update() stays live
    // until a new update() call arrives.
    const policy = new SecurityPolicy();
    policy.update({ ipRules: [{ ruleType: 'deny', pattern: '10.0.0.1' }] });
    // No further update() — policy must still reflect the old rule.
    assert.equal(policy.checkIp('10.0.0.1', 80).allowed, false);
    assert.equal(policy.isLoaded(), true);
  });
});
