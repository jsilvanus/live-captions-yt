/**
 * SecurityPolicy — bridge-side cache of this instance's TCP command / target
 * IP allow-deny rules, evaluated locally before any command touches the
 * network. Defense-in-depth: `BridgeManager.sendCommand()` on the backend
 * (packages/plugins/lcyt-production/src/bridge-manager.js) already checks
 * the same rules before a command is ever put on the SSE stream — that's
 * the authoritative check. This is a second, independent layer in case the
 * backend is ever compromised or a bug slips a bad command past it.
 *
 * Rule evaluation logic is intentionally duplicated from
 * packages/plugins/lcyt-production/src/bridge-security.js rather than
 * shared as a package dependency — same "copy, keep in sync" convention
 * this repo already uses for mediamtx-client.js.
 *
 * Fail-safe behavior:
 *   - A command arriving before the *first* successful policy fetch is
 *     rejected — a freshly-started bridge never has an unguarded window.
 *   - A later refetch failure keeps using the last known-good policy
 *     (stale beats undefined).
 */
import { BlockList, isIP } from 'node:net';

/** Parse an IP-rule pattern into { kind: 'host'|'ip'|'cidr', value, port|null }. */
function parseHostPattern(pattern) {
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

function matchesHostPattern(pattern, host, port) {
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
    return hostIsIp && parsed.value === host;
  }
  if (!hostIsIp) return false;
  try {
    const [net, prefixStr] = parsed.value.split('/');
    const prefix = Number(prefixStr);
    const family = isIP(net) === 6 ? 'ipv6' : 'ipv4';
    const bl = new BlockList();
    bl.addSubnet(net, prefix, family);
    return bl.check(host, isIP(host) === 6 ? 'ipv6' : 'ipv4');
  } catch {
    return false;
  }
}

function matchesCommandPattern(pattern, payload) {
  try {
    return new RegExp(pattern).test(String(payload ?? ''));
  } catch {
    return false;
  }
}

function evaluate(rules, matches) {
  const denyMatch = rules.find((r) => r.ruleType === 'deny' && matches(r.pattern));
  if (denyMatch) {
    return { allowed: false, reason: `Blocked by deny rule${denyMatch.description ? `: ${denyMatch.description}` : ` (${denyMatch.pattern})`}` };
  }

  const allowRules = rules.filter((r) => r.ruleType === 'allow');
  if (allowRules.length > 0) {
    const allowMatch = allowRules.find((r) => matches(r.pattern));
    if (allowMatch) return { allowed: true };
    return { allowed: false, reason: 'Blocked: allow-list is active and no rule matched' };
  }

  return { allowed: true };
}

export class SecurityPolicy {
  constructor() {
    this._ipRules = [];
    this._commandRules = [];
    this._loaded = false;
  }

  /** @returns {boolean} whether a policy has been successfully fetched at least once */
  isLoaded() {
    return this._loaded;
  }

  /** @param {{ ipRules?: Array, commandRules?: Array }} policy */
  update({ ipRules = [], commandRules = [] } = {}) {
    this._ipRules = ipRules;
    this._commandRules = commandRules;
    this._loaded = true;
  }

  /**
   * @param {string} host
   * @param {number|null} port
   * @returns {{ allowed: boolean, reason?: string }}
   */
  checkIp(host, port) {
    if (!this._loaded) return { allowed: false, reason: 'bridge security policy not yet loaded' };
    return evaluate(this._ipRules, (pattern) => matchesHostPattern(pattern, host, port));
  }

  /**
   * @param {string} payload
   * @returns {{ allowed: boolean, reason?: string }}
   */
  checkCommand(payload) {
    if (!this._loaded) return { allowed: false, reason: 'bridge security policy not yet loaded' };
    return evaluate(this._commandRules, (pattern) => matchesCommandPattern(pattern, payload));
  }
}
