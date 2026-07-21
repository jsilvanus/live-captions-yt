import { EventEmitter } from 'node:events';
import { REGISTRY, REGISTRY_BY_KEY } from './registry.js';
import {
  getAllServerSettingRows, setServerSettingRow, deleteServerSettingRow,
} from '../db/server-settings.js';

/**
 * Coerce a raw environment-variable string into the registry entry's typed
 * value. Centralised here so every read site agrees on parsing — this
 * replaces ~130 call sites that each hand-rolled their own `=== '1'` /
 * `parseInt` / `.split(',')`.
 * @param {typeof REGISTRY[number]} def
 * @param {string} raw
 */
function coerceEnvString(def, raw) {
  switch (def.type) {
    case 'bool': {
      const style = def.boolStyle || 'is1';
      if (style === 'not0') return raw !== '0';
      if (style === 'presence') return raw !== undefined && raw !== '';
      return raw === '1';
    }
    case 'int': {
      const n = Number(raw);
      if (!Number.isFinite(n)) return def.default;
      if (n === 0 && def.zeroIsInvalid) return def.default;
      return n;
    }
    case 'csv':
      return raw === '' ? [] : raw.split(',').map(s => s.trim()).filter(Boolean);
    case 'enum':
    case 'string':
    case 'secret':
    default:
      return raw;
  }
}

/**
 * Coerce a DB-stored value (already JSON-decoded — so already the right JS
 * type for most cases) into the registry entry's canonical type. Mostly a
 * pass-through; exists so a DB row written by an older/looser registry entry
 * doesn't silently misbehave.
 * @param {typeof REGISTRY[number]} def
 * @param {*} value
 */
function coerceDbValue(def, value) {
  if (def.type === 'int') {
    const n = typeof value === 'number' ? value : Number(value);
    return (n === 0 && def.zeroIsInvalid) ? def.default : n;
  }
  if (def.type === 'bool') return Boolean(value);
  if (def.type === 'csv') return Array.isArray(value) ? value : [];
  return value;
}

/**
 * SettingsService — precedence resolver for server-level configuration:
 * env var (if set) > DB row (server_settings) > registry default.
 *
 * Emits 'changed' with `{ key, source }` on set()/clear() so interested
 * plugin managers/timers can hot-reload without a restart. This is a plain
 * Node EventEmitter, not the shared per-project EventBus (`lcyt/event-bus`)
 * — that bus is strictly project-scoped (`publish(projectId, topic, data)`)
 * with no broadcast-to-everyone primitive, and server settings have no
 * project id. Forcing a global concept through a project-scoped primitive
 * would need an invented sentinel projectId for no real benefit; a plain
 * EventEmitter on the service instance every plugin already receives at
 * init (same DI convention as `db`/`store`/`metrics`) is simpler and needs
 * no changes to EventBus itself.
 */
export class SettingsService extends EventEmitter {
  /**
   * @param {import('better-sqlite3').Database} db
   */
  constructor(db) {
    super();
    this.db = db;
    /** @type {Map<string, *>} */
    this._dbCache = new Map();
    this._loadCache();
    // Boot-time snapshot of every 'restart'-apply key's effective value, so a
    // later DB write can be diffed against what the running process actually
    // used at startup — that diff is "pending restart" (see pendingRestart()).
    this._bootSnapshot = new Map(
      REGISTRY.filter(d => d.apply === 'restart').map(d => [d.key, this.get(d.key)])
    );
  }

  _loadCache() {
    this._dbCache.clear();
    for (const row of getAllServerSettingRows(this.db)) {
      try {
        this._dbCache.set(row.key, JSON.parse(row.value));
      } catch {
        // Corrupt row — ignore, falls through to env/default.
      }
    }
  }

  /**
   * @param {string} key
   * @returns {'env'|'db'|'default'}
   */
  source(key) {
    const def = REGISTRY_BY_KEY.get(key);
    if (!def) throw new Error(`Unknown setting: ${key}`);
    if (def.env && process.env[def.env] !== undefined) return 'env';
    if (this._dbCache.has(key)) return 'db';
    return 'default';
  }

  /**
   * Effective value: env > DB > registry default.
   * @param {string} key
   */
  get(key) {
    const def = REGISTRY_BY_KEY.get(key);
    if (!def) throw new Error(`Unknown setting: ${key}`);
    if (def.env && process.env[def.env] !== undefined) {
      return coerceEnvString(def, process.env[def.env]);
    }
    if (this._dbCache.has(key)) {
      return coerceDbValue(def, this._dbCache.get(key));
    }
    return def.default;
  }

  /**
   * @param {string} key
   * @param {*} value
   * @param {{ updatedBy?: string|null }} [opts]
   */
  set(key, value, { updatedBy = null } = {}) {
    const def = REGISTRY_BY_KEY.get(key);
    if (!def) throw new Error(`Unknown setting: ${key}`);
    if (def.tier === 'env') {
      const err = new Error(`'${key}' is env-only and cannot be set via the admin API.`);
      err.code = 'TIER_A_LOCKED';
      throw err;
    }
    if (def.env && process.env[def.env] !== undefined) {
      const err = new Error(`'${key}' is locked by the ${def.env} environment variable.`);
      err.code = 'ENV_LOCKED';
      throw err;
    }
    const coerced = coerceDbValue(def, value);
    setServerSettingRow(this.db, key, JSON.stringify(coerced), updatedBy);
    this._dbCache.set(key, coerced);
    this.emit('changed', { key, source: 'db', value: coerced });
  }

  /**
   * Revert a key to its env/default value by deleting the DB row.
   * @param {string} key
   * @param {{ updatedBy?: string|null }} [opts]
   */
  clear(key, { updatedBy = null } = {}) {
    const def = REGISTRY_BY_KEY.get(key);
    if (!def) throw new Error(`Unknown setting: ${key}`);
    if (def.tier === 'env') {
      const err = new Error(`'${key}' is env-only and has no DB row to clear.`);
      err.code = 'TIER_A_LOCKED';
      throw err;
    }
    deleteServerSettingRow(this.db, key);
    this._dbCache.delete(key);
    this.emit('changed', { key, source: this.source(key), value: this.get(key), updatedBy });
  }

  /**
   * True when this restart-tier key's effective value has diverged from what
   * the running process actually captured at boot — i.e. a DB write landed
   * but won't take effect until the next restart.
   * @param {string} key
   */
  pendingRestart(key) {
    if (!this._bootSnapshot.has(key)) return false;
    const bootVal = this._bootSnapshot.get(key);
    const nowVal = this.get(key);
    return JSON.stringify(bootVal) !== JSON.stringify(nowVal);
  }

  /**
   * Full effective-configuration snapshot, grouped by category. Secrets are
   * masked. Used by GET /admin/settings and by the zero-config/golden tests.
   */
  snapshot() {
    return REGISTRY.map(def => ({
      key: def.key,
      env: def.env,
      category: def.category,
      tier: def.tier,
      apply: def.apply,
      type: def.type,
      enum: def.enum,
      secret: !!def.secret,
      confirm: !!def.confirm,
      description: def.description,
      source: this.source(def.key),
      pendingRestart: def.apply === 'restart' ? this.pendingRestart(def.key) : false,
      value: def.secret
        ? (this.source(def.key) === 'default' && !def.default ? null : '***')
        : this.get(def.key),
    }));
  }
}
