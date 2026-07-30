/**
 * LocalSecurityFloor — an optional, deployer-controlled deny-only rule file
 * (`security.local.yaml`, next to this bridge's `.env`) that this bridge
 * enforces regardless of what the backend says.
 *
 * Every other layer of this bridge's security model ultimately traces back
 * to the backend: `SecurityPolicy` (security-policy.js) is a local cache of
 * rules *fetched from* the backend, and the backend's own authoritative
 * check (`BridgeManager.sendCommand()`) lives on a server this bridge has
 * no control over. If the backend is ever genuinely compromised, it can lie
 * about those rules exactly as easily as it can send a malicious command —
 * "defense in depth" that still roots entirely in the thing being defended
 * against isn't much of a floor.
 *
 * This file is the one layer the backend cannot influence at all: it is
 * read from local disk only, by whoever has filesystem/deploy access to
 * this specific machine. It is deliberately narrow in what it can do:
 *
 *   - Deny-only. A rule here can only ADD a restriction on top of whatever
 *     SecurityPolicy already decided — it can never grant extra allowance.
 *     There is no 'allow' rule type and no default-deny mode; an empty or
 *     absent file changes nothing.
 *   - Same two rule kinds as the backend's bridge_security_rules: `ip`
 *     (host/CIDR/wildcard target, optional :port) and `command` (regex
 *     against the outgoing TCP payload) — same pattern syntax, reusing
 *     security-policy.js's own matcher/validator rather than a third copy.
 *   - Checked alongside SecurityPolicy in Bridge._checkSecurity(): either
 *     layer denying blocks the command (OR, not override).
 *
 * Fail-safe behavior:
 *   - No file present → no restriction added (absence changes nothing).
 *   - File present and valid → each rule enforced as described above.
 *   - File present but malformed (bad YAML, bad structure, an invalid
 *     pattern) → fails CLOSED: every command this floor is asked about is
 *     blocked until the file is fixed or removed. Silently ignoring a
 *     broken "last line of defense" file would defeat its entire purpose —
 *     a deployer who believes they've locked something down should never
 *     be wrong about that. `loadError()` carries the specific problem so
 *     the operator isn't left guessing why the bridge stopped working.
 *   - Loaded at startup, then kept in sync via `watch()`: edits, creates,
 *     and deletes of the file are picked up automatically (debounced),
 *     with no bridge restart required — important for deployments where a
 *     restart isn't something an operator can casually rely on (e.g. a
 *     bridge running headless on a Raspberry Pi next to the hardware).
 */
import * as fs from 'node:fs';
import { join } from 'node:path';
import { load as parseYaml } from 'js-yaml';
import { matchesHostPattern, matchesCommandPattern, isValidHostPattern, isValidCommandPattern } from './security-policy.js';

export const DEFAULT_LOCAL_POLICY_FILENAME = 'security.local.yaml';

// A single save often fires more than one fs event (write + rename, or
// separate metadata/content events depending on platform/editor) — debounce
// so a save only triggers one reload.
const RELOAD_DEBOUNCE_MS = 250;

/**
 * Parse and validate a loaded YAML document into { ipRules, commandRules }.
 * Throws with a specific, human-readable message on any structural or
 * pattern problem — the caller (load()) turns that into the fail-closed state.
 * @param {*} doc  result of js-yaml's load()
 * @returns {{ ipRules: Array<{pattern:string, description?:string}>, commandRules: Array<{pattern:string, description?:string}> }}
 */
export function parseLocalPolicyDocument(doc) {
  if (doc == null) return { ipRules: [], commandRules: [] };
  if (typeof doc !== 'object' || Array.isArray(doc)) {
    throw new Error('top level must be a mapping with a "rules" list, e.g. { rules: [...] }');
  }

  const rulesRaw = doc.rules;
  if (rulesRaw === undefined) return { ipRules: [], commandRules: [] };
  if (!Array.isArray(rulesRaw)) {
    throw new Error('"rules" must be a list');
  }

  const ipRules = [];
  const commandRules = [];
  rulesRaw.forEach((entry, i) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new Error(`rules[${i}] must be a mapping with "kind" and "pattern"`);
    }
    const { kind, pattern, description } = entry;
    if (kind !== 'ip' && kind !== 'command') {
      throw new Error(`rules[${i}].kind must be "ip" or "command", got ${JSON.stringify(kind)}`);
    }
    if (kind === 'ip' && !isValidHostPattern(pattern)) {
      throw new Error(`rules[${i}].pattern is not a valid host/IP/CIDR pattern: ${JSON.stringify(pattern)}`);
    }
    if (kind === 'command' && !isValidCommandPattern(pattern)) {
      throw new Error(`rules[${i}].pattern is not a valid regular expression: ${JSON.stringify(pattern)}`);
    }
    if (description !== undefined && typeof description !== 'string') {
      throw new Error(`rules[${i}].description must be a string`);
    }
    (kind === 'ip' ? ipRules : commandRules).push({ pattern, description });
  });

  return { ipRules, commandRules };
}

export class LocalSecurityFloor {
  constructor() {
    this._ipRules = [];
    this._commandRules = [];
    this._present = false;
    this._loadError = null;
    this._dir = null;
    this._filename = null;
    this._watcher = null;
    this._watchError = null;
  }

  /** @returns {boolean} whether a security.local.yaml file was found on disk */
  isPresent() { return this._present; }

  /** @returns {string|null} the load/parse error, if the file exists but is malformed */
  loadError() { return this._loadError; }

  /** @returns {{ present: boolean, loadError: string|null, ipRuleCount: number, commandRuleCount: number }} */
  summary() {
    return {
      present:          this._present,
      loadError:        this._loadError,
      ipRuleCount:      this._ipRules.length,
      commandRuleCount: this._commandRules.length,
    };
  }

  /**
   * Load from `<dir>/<filename>`. Synchronous and only ever called once at
   * startup — a small local file read, same convention as index.js's
   * existing synchronous `.env` load.
   * @param {string} dir
   * @param {string} [filename]
   */
  load(dir, filename = DEFAULT_LOCAL_POLICY_FILENAME) {
    this._dir = dir;
    this._filename = filename;
    this._ipRules = [];
    this._commandRules = [];
    this._present = false;
    this._loadError = null;

    const filePath = join(dir, filename);
    if (!fs.existsSync(filePath)) return;

    this._present = true;
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const doc = parseYaml(raw);
      const { ipRules, commandRules } = parseLocalPolicyDocument(doc);
      this._ipRules = ipRules;
      this._commandRules = commandRules;
    } catch (err) {
      this._loadError = err.message;
    }
  }

  /**
   * Start watching `<dir>/<filename>` (as passed to the prior `load()` call)
   * for changes and reload automatically — no-op if `load()` was never
   * called, or if already watching. Watches the containing *directory*
   * rather than the file itself: that also catches the file being created
   * after `watch()` starts (it may not exist yet) or deleted, and is more
   * robust than a direct file watch against editors/deploy tools that save
   * via a temp-file-then-rename rather than an in-place write.
   * @param {(summary: ReturnType<LocalSecurityFloor['summary']>) => void} [onReload]
   *   called after every debounced reload, with the fresh `summary()`.
   */
  watch(onReload) {
    if (this._watcher || !this._dir) return;
    let timer = null;
    try {
      this._watcher = fs.watch(this._dir, { persistent: false }, (eventType, filename) => {
        if (filename && filename !== this._filename) return;
        clearTimeout(timer);
        timer = setTimeout(() => {
          this.load(this._dir, this._filename);
          if (typeof onReload === 'function') onReload(this.summary());
        }, RELOAD_DEBOUNCE_MS);
      });
    } catch (err) {
      this._watchError = err.message;
    }
  }

  /** @returns {boolean} whether watch() is actively watching for changes */
  isWatching() {
    return this._watcher != null;
  }

  /** @returns {string|null} error setting up the watcher, if watch() failed to start it */
  watchError() {
    return this._watchError;
  }

  /** Stop watching for changes, if watch() was called. Idempotent. */
  close() {
    if (this._watcher) {
      try { this._watcher.close(); } catch { /* ignore */ }
      this._watcher = null;
    }
  }

  /**
   * @param {string} host
   * @param {number|null} port
   * @returns {{ allowed: boolean, reason?: string }}
   */
  checkIp(host, port) {
    if (this._loadError) {
      return { allowed: false, reason: `security.local.yaml is malformed: ${this._loadError}` };
    }
    const hit = this._ipRules.find((r) => matchesHostPattern(r.pattern, host, port));
    if (hit) {
      return { allowed: false, reason: `Blocked by local floor rule${hit.description ? `: ${hit.description}` : ` (${hit.pattern})`}` };
    }
    return { allowed: true };
  }

  /**
   * @param {string} payload
   * @returns {{ allowed: boolean, reason?: string }}
   */
  checkCommand(payload) {
    if (this._loadError) {
      return { allowed: false, reason: `security.local.yaml is malformed: ${this._loadError}` };
    }
    const hit = this._commandRules.find((r) => matchesCommandPattern(r.pattern, payload));
    if (hit) {
      return { allowed: false, reason: `Blocked by local floor rule${hit.description ? `: ${hit.description}` : ` (${hit.pattern})`}` };
    }
    return { allowed: true };
  }
}
