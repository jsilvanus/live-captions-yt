/**
 * Per-bridge TCP command / target IP allow-deny policy.
 *
 * Every command a bridge agent is asked to relay (packages/lcyt-bridge) opens
 * a raw TCP/HTTP connection and, for tcp_send, writes an arbitrary payload —
 * historically with zero validation of either the target or the content.
 * This module is the evaluator; bridge-manager.js's sendCommand() calls it
 * before ever putting a command on the SSE stream (the authoritative check),
 * and lcyt-bridge's security-policy.js duplicates the same logic locally as
 * a second layer (defense in depth if the backend is ever compromised).
 *
 * Two independent rule kinds, both stored in bridge_security_rules:
 *   - 'ip'      — which host:port the bridge may dial. Pattern syntax
 *                 mirrors lcyt-connectors' connector_network_rules: exact
 *                 hostname, "*.example.com" wildcard, exact IP, CIDR, each
 *                 optionally with a ":port" suffix. No DNS resolution is
 *                 performed here (unlike network-guard.js) — bridge targets
 *                 are LAN IPs/hostnames configured directly on the device,
 *                 not arbitrary user-supplied URLs, so an 'ip'/'cidr' rule
 *                 only ever matches a literal IP target.
 *   - 'command' — a regex tested against the outgoing TCP payload string.
 *
 * Precedence (same as network-guard.js): any matching 'deny' rule blocks;
 * else if any 'allow' rule exists for that kind, only a matching 'allow'
 * rule passes (default-deny); else default-allow (no rules configured for
 * that kind, or deny-list-only mode).
 */
import { BlockList, isIP } from 'node:net';
import { listBridgeSecurityRules } from './db.js';

/** Parse an IP-rule pattern into { kind: 'host'|'ip'|'cidr', value, port|null }. */
export function parseHostPattern(pattern) {
  let value = pattern.trim();
  let port = null;

  if (value.startsWith('[')) {
    const close = value.indexOf(']');
    if (close !== -1) {
      const host = value.slice(1, close);
      const rest = value.slice(close + 1);
      const portMatch = rest.match(/^:(\d+)$/);
      value = host;
      if (portMatch) port = Number(portMatch[1]);
    }
  } else {
    const lastColon = value.lastIndexOf(':');
    if (lastColon > -1) {
      const maybePort = value.slice(lastColon + 1);
      const maybeHost = value.slice(0, lastColon);
      if (/^\d+$/.test(maybePort) && !maybeHost.includes(':')) {
        value = maybeHost;
        port = Number(maybePort);
      }
    }
  }

  if (value.includes('/')) return { kind: 'cidr', value, port };
  if (isIP(value)) return { kind: 'ip', value, port };
  return { kind: 'host', value: value.toLowerCase(), port };
}

function hostNameMatches(pattern, hostname) {
  if (pattern.startsWith('*.')) {
    const suffix = pattern.slice(2);
    return hostname === suffix || hostname.endsWith(`.${suffix}`);
  }
  return pattern === hostname;
}

/**
 * Parse a CIDR prefix length, rejecting anything that isn't a plain
 * non-negative integer string in range — in particular an *empty* prefix
 * (`"10.0.0.0/"`, e.g. a fat-fingered `"10.0.0.0/24"`), which `Number('')`
 * silently coerces to `0` (a "match every address" /0 block) rather than
 * NaN. Returns `null` for anything invalid.
 * @param {string} prefixStr
 * @param {'ipv4'|'ipv6'} family
 * @returns {number|null}
 */
function parseCidrPrefix(prefixStr, family) {
  if (!/^\d+$/.test(prefixStr ?? '')) return null;
  const prefix = Number(prefixStr);
  const maxBits = family === 'ipv6' ? 128 : 32;
  if (prefix < 0 || prefix > maxBits) return null;
  return prefix;
}

/**
 * @param {string} pattern  IP-rule pattern (see parseHostPattern)
 * @param {string} host     Literal host/IP a command targets
 * @param {number} port
 * @returns {boolean}
 */
export function matchesHostPattern(pattern, host, port) {
  let parsed;
  try {
    parsed = parseHostPattern(pattern);
  } catch {
    return false;
  }
  if (parsed.port != null && parsed.port !== port) return false;

  const hostIsIp = isIP(host) !== 0;

  if (parsed.kind === 'host') {
    return !hostIsIp && hostNameMatches(parsed.value, String(host).toLowerCase());
  }
  if (parsed.kind === 'ip') {
    // Case-insensitive: IPv6 literals are case-insensitive by spec (e.g.
    // "2001:DB8::1" and "2001:db8::1" are the same address), but this is a
    // plain string compare, not an IP-aware one.
    return hostIsIp && parsed.value.toLowerCase() === String(host).toLowerCase();
  }
  // CIDR — only ever matches when the command target is itself a literal IP
  if (!hostIsIp) return false;
  try {
    const [net, prefixStr] = parsed.value.split('/');
    const family = isIP(net) === 6 ? 'ipv6' : 'ipv4';
    const prefix = parseCidrPrefix(prefixStr, family);
    if (prefix == null) return false;
    const bl = new BlockList();
    bl.addSubnet(net, prefix, family);
    return bl.check(host, isIP(host) === 6 ? 'ipv6' : 'ipv4');
  } catch {
    return false;
  }
}

/** @returns {boolean} whether `pattern` is a well-formed IP-rule pattern */
export function isValidHostPattern(pattern) {
  if (!pattern || typeof pattern !== 'string') return false;
  try {
    const parsed = parseHostPattern(pattern);
    if (parsed.kind === 'cidr') {
      const [net, prefixStr] = parsed.value.split('/');
      const family = isIP(net) === 6 ? 'ipv6' : 'ipv4';
      const prefix = parseCidrPrefix(prefixStr, family);
      if (prefix == null) return false;
      new BlockList().addSubnet(net, prefix, family);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {string} pattern  regex source
 * @param {string} payload  outgoing TCP command payload
 * @returns {boolean}
 */
export function matchesCommandPattern(pattern, payload) {
  try {
    return new RegExp(pattern).test(String(payload ?? ''));
  } catch {
    return false;
  }
}

/** @returns {boolean} whether `pattern` compiles as a regex */
export function isValidCommandPattern(pattern) {
  if (!pattern || typeof pattern !== 'string') return false;
  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}

/**
 * Shared allow/deny precedence: deny always wins; an allow-list, if any
 * rules exist for it, switches that rule kind to default-deny.
 * @param {Array<{rule_type: 'allow'|'deny', pattern: string, description?: string}>} rules
 * @param {(pattern: string) => boolean} matches
 * @returns {{ allowed: boolean, reason?: string }}
 */
function evaluate(rules, matches) {
  const denyMatch = rules.find((r) => r.rule_type === 'deny' && matches(r.pattern));
  if (denyMatch) {
    return { allowed: false, reason: `Blocked by deny rule${denyMatch.description ? `: ${denyMatch.description}` : ` (${denyMatch.pattern})`}` };
  }

  const allowRules = rules.filter((r) => r.rule_type === 'allow');
  if (allowRules.length > 0) {
    const allowMatch = allowRules.find((r) => matches(r.pattern));
    if (allowMatch) return { allowed: true };
    return { allowed: false, reason: 'Blocked: allow-list is active and no rule matched' };
  }

  return { allowed: true };
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} bridgeInstanceId
 * @param {string} host
 * @param {number} port
 * @returns {{ allowed: boolean, reason?: string }}
 */
export function checkIpAllowed(db, bridgeInstanceId, host, port) {
  const rules = listBridgeSecurityRules(db, bridgeInstanceId, 'ip');
  return evaluate(rules, (pattern) => matchesHostPattern(pattern, host, port));
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} bridgeInstanceId
 * @param {string} payload
 * @returns {{ allowed: boolean, reason?: string }}
 */
export function checkCommandAllowed(db, bridgeInstanceId, payload) {
  const rules = listBridgeSecurityRules(db, bridgeInstanceId, 'command');
  return evaluate(rules, (pattern) => matchesCommandPattern(pattern, payload));
}

/**
 * Every rejection bridge-manager.js's _checkSecurity() produces is prefixed
 * this way — used by route catch blocks (routes/bridge.js, encoders.js,
 * cameras.js, mixers.js) to map a deliberate policy block to 403, instead
 * of falling into whatever generic infra-error status (502/400/…) that
 * catch block otherwise uses for "the bridge command failed".
 * @param {Error} err
 * @returns {boolean}
 */
export function isSecurityBlockError(err) {
  return typeof err?.message === 'string' && err.message.startsWith('Blocked by bridge security policy');
}
