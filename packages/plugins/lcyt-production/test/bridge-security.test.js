/**
 * Unit tests for bridge-security.js — the per-bridge TCP command / target IP
 * allow-deny rule evaluator.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { runMigrations, createBridgeSecurityRule } from '../src/db.js';
import {
  matchesHostPattern, matchesCommandPattern, isValidHostPattern, isValidCommandPattern,
  checkIpAllowed, checkCommandAllowed,
} from '../src/bridge-security.js';

function makeDb() {
  const db = new Database(':memory:');
  runMigrations(db);
  return db;
}

// bridge_security_rules.bridge_instance_id has a real FK to
// prod_bridge_instances(id) — insert a stub row for every instance id a test
// references before writing rules against it.
function insertInstance(db, id) {
  db.prepare('INSERT INTO prod_bridge_instances (id, name, token) VALUES (?, ?, ?)')
    .run(id, id, randomUUID());
}

function addRule(db, bridgeInstanceId, ruleKind, ruleType, pattern, description = null) {
  return createBridgeSecurityRule(db, { id: randomUUID(), bridgeInstanceId, ruleKind, ruleType, pattern, description });
}

// ---------------------------------------------------------------------------
// matchesHostPattern
// ---------------------------------------------------------------------------

describe('matchesHostPattern', () => {
  it('matches an exact hostname', () => {
    assert.equal(matchesHostPattern('mixer.local', 'mixer.local', 1319), true);
    assert.equal(matchesHostPattern('mixer.local', 'other.local', 1319), false);
  });

  it('matches a wildcard subdomain', () => {
    assert.equal(matchesHostPattern('*.internal', 'mixer.internal', 80), true);
    assert.equal(matchesHostPattern('*.internal', 'internal', 80), true);
    assert.equal(matchesHostPattern('*.internal', 'mixer.external', 80), false);
  });

  it('matches an exact IP', () => {
    assert.equal(matchesHostPattern('192.168.1.50', '192.168.1.50', 1319), true);
    assert.equal(matchesHostPattern('192.168.1.50', '192.168.1.51', 1319), false);
  });

  it('a hostname pattern never matches a literal IP target and vice versa', () => {
    assert.equal(matchesHostPattern('192.168.1.50', 'mixer.local', 1319), false);
    assert.equal(matchesHostPattern('mixer.local', '192.168.1.50', 1319), false);
  });

  it('matches a CIDR range', () => {
    assert.equal(matchesHostPattern('192.168.1.0/24', '192.168.1.99', 1319), true);
    assert.equal(matchesHostPattern('192.168.1.0/24', '192.168.2.99', 1319), false);
  });

  it('honours a :port suffix', () => {
    assert.equal(matchesHostPattern('192.168.1.50:1319', '192.168.1.50', 1319), true);
    assert.equal(matchesHostPattern('192.168.1.50:1319', '192.168.1.50', 9999), false);
  });

  it('a pattern without a port matches any port', () => {
    assert.equal(matchesHostPattern('192.168.1.50', '192.168.1.50', 1), true);
    assert.equal(matchesHostPattern('192.168.1.50', '192.168.1.50', 65535), true);
  });

  it('returns false for a malformed pattern instead of throwing', () => {
    assert.equal(matchesHostPattern('not a valid /// pattern', '192.168.1.50', 80), false);
  });

  it('a CIDR pattern with an empty prefix never matches (does not silently become /0)', () => {
    assert.equal(matchesHostPattern('10.0.0.0/', '8.8.8.8', 80), false);
    assert.equal(matchesHostPattern('10.0.0.0/', '10.0.0.1', 80), false);
  });

  it('exact IP matching is case-insensitive for IPv6 literals', () => {
    assert.equal(matchesHostPattern('2001:DB8::1', '2001:db8::1', 80), true);
    assert.equal(matchesHostPattern('2001:db8::1', '2001:DB8::1', 80), true);
  });
});

// ---------------------------------------------------------------------------
// matchesCommandPattern
// ---------------------------------------------------------------------------

describe('matchesCommandPattern', () => {
  it('matches a regex against the payload', () => {
    assert.equal(matchesCommandPattern('^PRESET-[0-9]+$', 'PRESET-3'), true);
    assert.equal(matchesCommandPattern('^PRESET-[0-9]+$', 'POWER OFF'), false);
  });

  it('returns false for an invalid regex instead of throwing', () => {
    assert.equal(matchesCommandPattern('(unclosed', 'anything'), false);
  });
});

// ---------------------------------------------------------------------------
// isValidHostPattern / isValidCommandPattern
// ---------------------------------------------------------------------------

describe('isValidHostPattern / isValidCommandPattern', () => {
  it('accepts well-formed host patterns', () => {
    assert.equal(isValidHostPattern('mixer.local'), true);
    assert.equal(isValidHostPattern('*.internal'), true);
    assert.equal(isValidHostPattern('192.168.1.50'), true);
    assert.equal(isValidHostPattern('192.168.1.0/24'), true);
    assert.equal(isValidHostPattern('192.168.1.50:1319'), true);
  });

  it('rejects a malformed CIDR', () => {
    assert.equal(isValidHostPattern('192.168.1.0/999'), false);
  });

  it('rejects empty/non-string patterns', () => {
    assert.equal(isValidHostPattern(''), false);
    assert.equal(isValidHostPattern(null), false);
  });

  it('accepts a valid regex and rejects an invalid one', () => {
    assert.equal(isValidCommandPattern('^PRESET-[0-9]+$'), true);
    assert.equal(isValidCommandPattern('(unclosed'), false);
    assert.equal(isValidCommandPattern(''), false);
  });
});

// ---------------------------------------------------------------------------
// checkIpAllowed / checkCommandAllowed — precedence
// ---------------------------------------------------------------------------

describe('checkIpAllowed — precedence', () => {
  it('default-allow when no rules exist', () => {
    const db = makeDb();
    const result = checkIpAllowed(db, 'bridge-1', '192.168.1.50', 1319);
    assert.equal(result.allowed, true);
  });

  it('deny-only mode blocks a matching pattern, allows everything else', () => {
    const db = makeDb();
    insertInstance(db, 'bridge-1');
    addRule(db, 'bridge-1', 'ip', 'deny', '192.168.1.50');
    assert.equal(checkIpAllowed(db, 'bridge-1', '192.168.1.50', 1319).allowed, false);
    assert.equal(checkIpAllowed(db, 'bridge-1', '192.168.1.51', 1319).allowed, true);
  });

  it('allow-only mode switches to default-deny', () => {
    const db = makeDb();
    insertInstance(db, 'bridge-1');
    addRule(db, 'bridge-1', 'ip', 'allow', '192.168.1.50');
    assert.equal(checkIpAllowed(db, 'bridge-1', '192.168.1.50', 1319).allowed, true);
    assert.equal(checkIpAllowed(db, 'bridge-1', '192.168.1.99', 1319).allowed, false);
  });

  it('deny always wins over an overlapping allow rule', () => {
    const db = makeDb();
    insertInstance(db, 'bridge-1');
    addRule(db, 'bridge-1', 'ip', 'allow', '192.168.1.0/24');
    addRule(db, 'bridge-1', 'ip', 'deny', '192.168.1.50');
    assert.equal(checkIpAllowed(db, 'bridge-1', '192.168.1.50', 1319).allowed, false, 'deny carve-out inside the allowed range');
    assert.equal(checkIpAllowed(db, 'bridge-1', '192.168.1.51', 1319).allowed, true, 'rest of the allowed range still passes');
  });

  it('rules are scoped per bridge instance', () => {
    const db = makeDb();
    insertInstance(db, 'bridge-1');
    insertInstance(db, 'bridge-2');
    addRule(db, 'bridge-1', 'ip', 'deny', '192.168.1.50');
    assert.equal(checkIpAllowed(db, 'bridge-2', '192.168.1.50', 1319).allowed, true, 'a different bridge is unaffected');
  });
});

describe('checkCommandAllowed — precedence', () => {
  it('default-allow when no rules exist', () => {
    const db = makeDb();
    assert.equal(checkCommandAllowed(db, 'bridge-1', 'ANYTHING').allowed, true);
  });

  it('deny-only mode blocks a matching command, allows the rest', () => {
    const db = makeDb();
    insertInstance(db, 'bridge-1');
    addRule(db, 'bridge-1', 'command', 'deny', '^FACTORY-RESET$');
    assert.equal(checkCommandAllowed(db, 'bridge-1', 'FACTORY-RESET').allowed, false);
    assert.equal(checkCommandAllowed(db, 'bridge-1', 'PRESET-1').allowed, true);
  });

  it('allow-only mode switches to default-deny', () => {
    const db = makeDb();
    insertInstance(db, 'bridge-1');
    addRule(db, 'bridge-1', 'command', 'allow', '^PRESET-[0-9]+$');
    assert.equal(checkCommandAllowed(db, 'bridge-1', 'PRESET-3').allowed, true);
    assert.equal(checkCommandAllowed(db, 'bridge-1', 'FACTORY-RESET').allowed, false);
  });

  it('deny always wins over an overlapping allow rule', () => {
    const db = makeDb();
    insertInstance(db, 'bridge-1');
    addRule(db, 'bridge-1', 'command', 'allow', '^PRESET-[0-9]+$');
    addRule(db, 'bridge-1', 'command', 'deny', '^PRESET-13$', 'unlucky preset, blocked');
    assert.equal(checkCommandAllowed(db, 'bridge-1', 'PRESET-13').allowed, false);
    assert.equal(checkCommandAllowed(db, 'bridge-1', 'PRESET-3').allowed, true);
  });

  it('the block reason includes the deny rule description when present', () => {
    const db = makeDb();
    insertInstance(db, 'bridge-1');
    addRule(db, 'bridge-1', 'command', 'deny', '^FACTORY-RESET$', 'never allow a factory reset');
    const result = checkCommandAllowed(db, 'bridge-1', 'FACTORY-RESET');
    assert.equal(result.allowed, false);
    assert.match(result.reason, /never allow a factory reset/);
  });
});
