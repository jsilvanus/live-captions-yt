/**
 * Tests for LocalSecurityFloor — the optional, deployer-controlled
 * deny-only security.local.yaml floor. Covers:
 *   - No file present: everything allowed (no behavior change)
 *   - Valid file: ip/command deny rules block matches, allow the rest
 *   - Malformed YAML / malformed structure / invalid pattern: fails closed
 *   - parseLocalPolicyDocument() structural validation, directly
 *   - load() replaces (not merges) previous state on a second call
 *   - summary() output shape
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { join } from 'node:path';
import { LocalSecurityFloor, parseLocalPolicyDocument, DEFAULT_LOCAL_POLICY_FILENAME } from '../src/local-security-floor.js';

let dir;

beforeEach(() => {
  dir = fs.mkdtempSync(join(os.tmpdir(), 'lsf-test-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function writeYaml(content, filename = DEFAULT_LOCAL_POLICY_FILENAME) {
  fs.writeFileSync(join(dir, filename), content);
}

// ---------------------------------------------------------------------------
// No file present
// ---------------------------------------------------------------------------

describe('LocalSecurityFloor — no file present', () => {
  it('isPresent() is false and everything is allowed before any load()', () => {
    const floor = new LocalSecurityFloor();
    assert.equal(floor.isPresent(), false);
    assert.equal(floor.checkIp('10.0.0.1', 80).allowed, true);
    assert.equal(floor.checkCommand('anything').allowed, true);
  });

  it('load() against a directory with no security.local.yaml changes nothing', () => {
    const floor = new LocalSecurityFloor();
    floor.load(dir);
    assert.equal(floor.isPresent(), false);
    assert.equal(floor.loadError(), null);
    assert.equal(floor.checkIp('10.0.0.1', 80).allowed, true);
    assert.equal(floor.checkCommand('FACTORY-RESET').allowed, true);
  });
});

// ---------------------------------------------------------------------------
// Valid file — deny-only matching
// ---------------------------------------------------------------------------

describe('LocalSecurityFloor — valid file', () => {
  it('blocks a matching ip rule, allows everything else', () => {
    writeYaml(`
rules:
  - kind: ip
    pattern: "169.254.169.254"
    description: "never allow cloud metadata"
`);
    const floor = new LocalSecurityFloor();
    floor.load(dir);
    assert.equal(floor.isPresent(), true);
    assert.equal(floor.loadError(), null);

    const blocked = floor.checkIp('169.254.169.254', 80);
    assert.equal(blocked.allowed, false);
    assert.match(blocked.reason, /never allow cloud metadata/);

    assert.equal(floor.checkIp('10.0.0.1', 80).allowed, true);
  });

  it('blocks a matching command rule, allows everything else', () => {
    writeYaml(`
rules:
  - kind: command
    pattern: "^FACTORY-RESET$"
`);
    const floor = new LocalSecurityFloor();
    floor.load(dir);

    const blocked = floor.checkCommand('FACTORY-RESET');
    assert.equal(blocked.allowed, false);
    assert.match(blocked.reason, /FACTORY-RESET/);

    assert.equal(floor.checkCommand('PRESET-1').allowed, true);
  });

  it('a rule with no description falls back to showing the pattern in the reason', () => {
    writeYaml(`
rules:
  - kind: command
    pattern: "^X$"
`);
    const floor = new LocalSecurityFloor();
    floor.load(dir);
    const blocked = floor.checkCommand('X');
    assert.match(blocked.reason, /\^X\$/);
  });

  it('an empty rules list (or an empty file) is equivalent to no file present, behaviorally', () => {
    writeYaml('rules: []');
    const floor = new LocalSecurityFloor();
    floor.load(dir);
    assert.equal(floor.isPresent(), true); // file exists...
    assert.equal(floor.loadError(), null); // ...and is valid...
    assert.equal(floor.checkIp('10.0.0.1', 80).allowed, true); // ...just has no rules.
  });

  it('supports multiple rules of both kinds together', () => {
    writeYaml(`
rules:
  - kind: ip
    pattern: "10.0.0.0/8:22"
    description: "no SSH into internal ranges"
  - kind: ip
    pattern: "192.168.1.50"
  - kind: command
    pattern: "^FACTORY-RESET$"
  - kind: command
    pattern: "^DEBUG-.*"
`);
    const floor = new LocalSecurityFloor();
    floor.load(dir);
    assert.equal(floor.summary().ipRuleCount, 2);
    assert.equal(floor.summary().commandRuleCount, 2);
    assert.equal(floor.checkIp('10.1.2.3', 22).allowed, false);
    assert.equal(floor.checkIp('10.1.2.3', 80).allowed, true, 'port-scoped rule does not match a different port');
    assert.equal(floor.checkIp('192.168.1.50', 9999).allowed, false);
    assert.equal(floor.checkCommand('DEBUG-DUMP').allowed, false);
  });

  it('honours host/CIDR/wildcard pattern syntax (same matcher as SecurityPolicy)', () => {
    writeYaml(`
rules:
  - kind: ip
    pattern: "*.internal"
`);
    const floor = new LocalSecurityFloor();
    floor.load(dir);
    assert.equal(floor.checkIp('mixer.internal', 80).allowed, false);
    assert.equal(floor.checkIp('mixer.external', 80).allowed, true);
  });
});

// ---------------------------------------------------------------------------
// Malformed file — fails closed
// ---------------------------------------------------------------------------

describe('LocalSecurityFloor — malformed file fails closed', () => {
  it('invalid YAML syntax: isPresent() true, loadError set, everything blocked', () => {
    writeYaml('rules: [this is not: valid: yaml: at: all');
    const floor = new LocalSecurityFloor();
    floor.load(dir);

    assert.equal(floor.isPresent(), true);
    assert.ok(floor.loadError());
    assert.equal(floor.checkIp('10.0.0.1', 80).allowed, false);
    assert.match(floor.checkIp('10.0.0.1', 80).reason, /malformed/);
    assert.equal(floor.checkCommand('anything').allowed, false);
  });

  it('top level not a mapping: fails closed with a clear error', () => {
    writeYaml('- just\n- a\n- list');
    const floor = new LocalSecurityFloor();
    floor.load(dir);
    assert.ok(floor.loadError());
    assert.equal(floor.checkCommand('anything').allowed, false);
  });

  it('"rules" not a list: fails closed', () => {
    writeYaml('rules: not-a-list');
    const floor = new LocalSecurityFloor();
    floor.load(dir);
    assert.match(floor.loadError(), /"rules" must be a list/);
    assert.equal(floor.checkIp('1.2.3.4', 80).allowed, false);
  });

  it('a rule with an unknown kind: fails closed', () => {
    writeYaml(`
rules:
  - kind: allow
    pattern: "1.2.3.4"
`);
    const floor = new LocalSecurityFloor();
    floor.load(dir);
    assert.match(floor.loadError(), /kind must be "ip" or "command"/);
    assert.equal(floor.checkIp('1.2.3.4', 80).allowed, false, 'the whole file fails closed, not just the bad rule');
  });

  it('an ip rule with an invalid pattern: fails closed rather than silently never matching', () => {
    writeYaml(`
rules:
  - kind: ip
    pattern: "10.0.0.0/"
`);
    const floor = new LocalSecurityFloor();
    floor.load(dir);
    assert.match(floor.loadError(), /not a valid host\/IP\/CIDR pattern/);
    assert.equal(floor.checkIp('8.8.8.8', 80).allowed, false);
  });

  it('a command rule with an invalid regex: fails closed', () => {
    writeYaml(`
rules:
  - kind: command
    pattern: "(unclosed"
`);
    const floor = new LocalSecurityFloor();
    floor.load(dir);
    assert.match(floor.loadError(), /not a valid regular expression/);
    assert.equal(floor.checkCommand('anything').allowed, false);
  });

  it('a non-string description: fails closed', () => {
    writeYaml(`
rules:
  - kind: command
    pattern: "^X$"
    description: 123
`);
    const floor = new LocalSecurityFloor();
    floor.load(dir);
    assert.match(floor.loadError(), /description must be a string/);
  });
});

// ---------------------------------------------------------------------------
// load() replaces state on a second call
// ---------------------------------------------------------------------------

describe('LocalSecurityFloor — reload semantics', () => {
  it('a second load() call fully replaces the previous rule set', () => {
    writeYaml(`
rules:
  - kind: ip
    pattern: "1.2.3.4"
`);
    const floor = new LocalSecurityFloor();
    floor.load(dir);
    assert.equal(floor.checkIp('1.2.3.4', 80).allowed, false);

    writeYaml(`
rules:
  - kind: ip
    pattern: "5.6.7.8"
`);
    floor.load(dir);
    assert.equal(floor.checkIp('1.2.3.4', 80).allowed, true, 'old rule no longer applies');
    assert.equal(floor.checkIp('5.6.7.8', 80).allowed, false, 'new rule applies');
  });

  it('reloading after a malformed file recovers once the file is fixed', () => {
    writeYaml('rules: not-a-list');
    const floor = new LocalSecurityFloor();
    floor.load(dir);
    assert.ok(floor.loadError());

    writeYaml('rules: []');
    floor.load(dir);
    assert.equal(floor.loadError(), null);
    assert.equal(floor.checkIp('1.2.3.4', 80).allowed, true);
  });

  it('a custom filename is respected', () => {
    writeYaml(`
rules:
  - kind: ip
    pattern: "1.2.3.4"
`, 'custom.yaml');
    const floor = new LocalSecurityFloor();
    floor.load(dir); // default filename — file doesn't exist under that name
    assert.equal(floor.isPresent(), false);

    floor.load(dir, 'custom.yaml');
    assert.equal(floor.isPresent(), true);
    assert.equal(floor.checkIp('1.2.3.4', 80).allowed, false);
  });
});

// ---------------------------------------------------------------------------
// summary()
// ---------------------------------------------------------------------------

describe('LocalSecurityFloor.summary()', () => {
  it('reflects present/loadError/rule counts accurately', () => {
    const floor = new LocalSecurityFloor();
    assert.deepEqual(floor.summary(), { present: false, loadError: null, ipRuleCount: 0, commandRuleCount: 0 });

    writeYaml(`
rules:
  - kind: ip
    pattern: "1.2.3.4"
  - kind: command
    pattern: "^X$"
`);
    floor.load(dir);
    assert.deepEqual(floor.summary(), { present: true, loadError: null, ipRuleCount: 1, commandRuleCount: 1 });
  });
});

// ---------------------------------------------------------------------------
// parseLocalPolicyDocument() — structural validation, directly
// ---------------------------------------------------------------------------

describe('parseLocalPolicyDocument()', () => {
  it('null/undefined document is treated as an empty rule set', () => {
    assert.deepEqual(parseLocalPolicyDocument(null), { ipRules: [], commandRules: [] });
    assert.deepEqual(parseLocalPolicyDocument(undefined), { ipRules: [], commandRules: [] });
  });

  it('a document with no "rules" key is treated as an empty rule set', () => {
    assert.deepEqual(parseLocalPolicyDocument({}), { ipRules: [], commandRules: [] });
  });

  it('throws when the top level is a list, not a mapping', () => {
    assert.throws(() => parseLocalPolicyDocument(['a', 'b']), /top level must be a mapping/);
  });

  it('throws when the top level is a scalar', () => {
    assert.throws(() => parseLocalPolicyDocument('just a string'), /top level must be a mapping/);
  });

  it('throws when a rule entry is not a mapping', () => {
    assert.throws(() => parseLocalPolicyDocument({ rules: ['not-a-mapping'] }), /rules\[0\] must be a mapping/);
  });

  it('sorts valid entries into ipRules/commandRules by kind', () => {
    const result = parseLocalPolicyDocument({
      rules: [
        { kind: 'ip', pattern: '1.2.3.4' },
        { kind: 'command', pattern: '^X$', description: 'no X' },
      ],
    });
    assert.equal(result.ipRules.length, 1);
    assert.equal(result.commandRules.length, 1);
    assert.equal(result.commandRules[0].description, 'no X');
  });
});
