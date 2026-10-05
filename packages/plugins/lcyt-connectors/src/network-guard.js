/**
 * Outbound connector request SSRF guard.
 *
 * The matching engine (default-blocked ranges, pattern syntax, DNS-resolved
 * address checks) lives in the `varfetch` package. This module only adds
 * LCYT's two layers of admin-managed rules from the database on top:
 *   - global  — site-wide, managed by server admins
 *   - org     — per-organization, managed by that org's owner/admin; an org's
 *               own `deny` rules can never be bypassed by an `allow` rule
 *
 * Evaluation order (first match wins): non-http(s) scheme, org deny, global
 * deny, org allow, global allow, default-deny of private/reserved addresses.
 * Pattern syntax is documented in varfetch's network-guard.
 */
import { lookup as dnsLookup } from 'node:dns/promises';
import { checkUrlAllowed as checkWithPatterns, parsePattern } from 'varfetch';
import { listNetworkRules } from './db.js';

export { parsePattern };

const POLICY_REASON = 'Blocked by network policy';

/**
 * Org and global rules as the plain `{ allow, deny }` pattern lists varfetch takes.
 * @param {import('better-sqlite3').Database} db
 * @param {number|null} orgId
 */
export function loadNetworkPolicy(db, orgId) {
  const orgRules = orgId != null ? listNetworkRules(db, { scope: 'org', orgId }) : [];
  const globalRules = listNetworkRules(db, { scope: 'global' });
  const patterns = (rules, type) => rules.filter((r) => r.rule_type === type).map((r) => r.pattern);
  return {
    orgDeny: patterns(orgRules, 'deny'),
    globalDeny: patterns(globalRules, 'deny'),
    allow: [...patterns(orgRules, 'allow'), ...patterns(globalRules, 'allow')],
  };
}

/** The merged lists to hand to varfetch's own redirect-following fireRequest. */
export function toNetworkOptions(policy) {
  return { allow: policy.allow, deny: [...policy.orgDeny, ...policy.globalDeny] };
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {URL} url
 * @param {number|null} orgId
 * @returns {Promise<{ allowed: boolean, reason?: string }>}
 */
export async function checkUrlAllowed(db, url, orgId) {
  const policy = loadNetworkPolicy(db, orgId);

  // One DNS lookup shared by the up to three checks below.
  let lookupResult;
  const lookup = (hostname, options) => (lookupResult ??= dnsLookup(hostname, options).catch(() => []));

  // Deny layers are tried on their own so the reason names the layer. A deny
  // hit is the only way to get POLICY_REASON back with no allow list given.
  const layers = [
    [policy.orgDeny, 'Blocked by organization network policy'],
    [policy.globalDeny, 'Blocked by site network policy'],
  ];
  for (const [deny, reason] of layers) {
    if (deny.length === 0) continue;
    const result = await checkWithPatterns(url, { deny, lookup });
    if (!result.allowed && result.reason === POLICY_REASON) return { allowed: false, reason };
    if (!result.allowed && result.reason !== POLICY_REASON && !result.reason.startsWith('Blocked: ')) return result;
  }
  return checkWithPatterns(url, { allow: policy.allow, lookup });
}
