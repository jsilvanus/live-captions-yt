/**
 * AI Roles Framework (plan/ai_roles_framework).
 *
 * Tables:
 *   ai_roles                 — developer-maintained catalog of AI capability
 *                              kinds. Seeded with seven rows (two
 *                              continuous_vision roles, five agentic_chat
 *                              roles). Growing this list is exactly what it's
 *                              for; adding a role never changes the schema.
 *   project_ai_role_configs  — one row per (api_key, role_code): which
 *                              provider/model a project uses for a role, plus
 *                              its harness (JSON blob whose interpreted keys
 *                              differ per role).
 *
 * The config schema is the *amended* form from plan/ai_model_registry:
 * a provider_id FK into ai_providers instead of per-role credential fields.
 */

export const RUNTIME_KINDS = ['continuous_vision', 'agentic_chat'];

/** The seeded role catalog. Idempotent upsert on startup. */
export const BUILTIN_ROLES = [
  {
    role_code: 'tracker',
    name: 'Tracker',
    description: 'Vision model tracking a person/object across video frames.',
    input_types: ['video_frames'],
    output_type: 'structured_json',
    runtime_kind: 'continuous_vision',
    available_tools: [],
  },
  {
    role_code: 'describer',
    name: 'Describer',
    description: 'Describes what is happening on screen, as text or structured JSON.',
    input_types: ['video_frames', 'video_segments'],
    output_type: 'text',
    runtime_kind: 'continuous_vision',
    available_tools: [],
  },
  {
    role_code: 'setup_assistant',
    name: 'Setup Assistant',
    description: 'Chat assistant that configures Setup Hub cards by filling in and submitting their existing Add/Edit dialogs.',
    input_types: ['user_text'],
    output_type: 'suggestion',
    runtime_kind: 'agentic_chat',
    available_tools: [
      'caption_target.list', 'caption_target.create', 'caption_target.update', 'caption_target.delete',
      'camera.list', 'camera.create', 'camera.update', 'camera.delete',
      'mixer.list', 'mixer.create', 'mixer.update', 'mixer.delete',
    ],
  },
  {
    role_code: 'asset_control_assistant',
    name: 'Asset Control Assistant',
    description: 'Chat assistant scoped to the Assets page, same dialog-driving pattern as Setup Assistant.',
    input_types: ['user_text'],
    output_type: 'suggestion',
    runtime_kind: 'agentic_chat',
    available_tools: ['asset.list', 'asset.update', 'asset.delete'],
  },
  {
    role_code: 'planner',
    name: 'Planner Assistant',
    description: 'Assists a human writing a show rundown/plan from a natural-language goal.',
    input_types: ['user_text'],
    output_type: 'text',
    runtime_kind: 'agentic_chat',
    available_tools: [],
  },
  {
    role_code: 'dsk_designer',
    name: 'Graphics Editor Assistant',
    description: 'Generates and edits DSK overlay templates and suggests styles from a natural-language goal.',
    input_types: ['user_text'],
    output_type: 'suggestion',
    runtime_kind: 'agentic_chat',
    available_tools: ['dsk_template.generate', 'dsk_template.edit', 'dsk_template.suggest_styles'],
  },
  {
    role_code: 'assistant',
    name: 'Production Assistant',
    description: 'Follows tracker/describer/STT/user signals and proposes or executes camera and mixer changes.',
    input_types: ['tracker_events', 'describer_events', 'stt_transcript', 'user_text'],
    output_type: 'suggestion',
    runtime_kind: 'agentic_chat',
    available_tools: ['camera.preset', 'mixer.switch', 'crop.list_presets', 'crop.activate_preset'],
  },
];

/**
 * Run migrations and seed the role catalog (idempotent).
 * @param {import('better-sqlite3').Database} db
 */
export function runAiRolesMigrations(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_roles (
      role_code       TEXT PRIMARY KEY,
      name            TEXT NOT NULL,
      description     TEXT NOT NULL DEFAULT '',
      input_types     TEXT NOT NULL DEFAULT '[]',
      output_type     TEXT NOT NULL,
      runtime_kind    TEXT NOT NULL,
      available_tools TEXT NOT NULL DEFAULT '[]',
      is_builtin      INTEGER NOT NULL DEFAULT 1,
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS project_ai_role_configs (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      api_key         TEXT    NOT NULL,
      role_code       TEXT    NOT NULL REFERENCES ai_roles(role_code),
      enabled         INTEGER NOT NULL DEFAULT 0,
      provider_id     TEXT,
      model_name      TEXT    NOT NULL DEFAULT '',
      harness_config  TEXT    NOT NULL DEFAULT '{}',
      updated_at      INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      UNIQUE (api_key, role_code)
    );
    CREATE INDEX IF NOT EXISTS idx_project_ai_role_configs_key ON project_ai_role_configs(api_key);
  `);

  const upsert = db.prepare(`
    INSERT INTO ai_roles (role_code, name, description, input_types, output_type, runtime_kind, available_tools)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (role_code) DO UPDATE SET
      name = excluded.name,
      description = excluded.description,
      input_types = excluded.input_types,
      output_type = excluded.output_type,
      runtime_kind = excluded.runtime_kind,
      available_tools = excluded.available_tools
  `);
  for (const role of BUILTIN_ROLES) {
    upsert.run(
      role.role_code, role.name, role.description,
      JSON.stringify(role.input_types), role.output_type, role.runtime_kind,
      JSON.stringify(role.available_tools),
    );
  }
}

function formatRole(row) {
  if (!row) return null;
  let inputTypes = [];
  let availableTools = [];
  try { inputTypes = JSON.parse(row.input_types); } catch { /* keep [] */ }
  try { availableTools = JSON.parse(row.available_tools); } catch { /* keep [] */ }
  return {
    roleCode: row.role_code,
    name: row.name,
    description: row.description,
    inputTypes,
    outputType: row.output_type,
    runtimeKind: row.runtime_kind,
    availableTools,
    isBuiltin: row.is_builtin === 1,
  };
}

export function listRoles(db) {
  return db.prepare('SELECT * FROM ai_roles ORDER BY role_code').all().map(formatRole);
}

export function getRole(db, roleCode) {
  return formatRole(db.prepare('SELECT * FROM ai_roles WHERE role_code = ?').get(roleCode));
}

function formatConfig(row) {
  if (!row) return null;
  let harnessConfig = {};
  try { harnessConfig = JSON.parse(row.harness_config); } catch { /* keep {} */ }
  return {
    roleCode: row.role_code,
    enabled: row.enabled === 1,
    providerId: row.provider_id,
    modelName: row.model_name,
    harnessConfig,
    updatedAt: row.updated_at,
  };
}

/** Default (unconfigured) config shape for a role. */
export function defaultRoleConfig(roleCode) {
  return { roleCode, enabled: false, providerId: null, modelName: '', harnessConfig: {}, updatedAt: null };
}

/**
 * Get a project's config for a role, or the default when none is stored.
 */
export function getRoleConfig(db, apiKey, roleCode) {
  const row = db.prepare(
    'SELECT * FROM project_ai_role_configs WHERE api_key = ? AND role_code = ?'
  ).get(apiKey, roleCode);
  return row ? formatConfig(row) : defaultRoleConfig(roleCode);
}

/**
 * Upsert a project's config for a role. Only provided fields change.
 * @param {object} input — { enabled?, providerId?, modelName?, harnessConfig? }
 */
export function setRoleConfig(db, apiKey, roleCode, input) {
  const existing = db.prepare(
    'SELECT id FROM project_ai_role_configs WHERE api_key = ? AND role_code = ?'
  ).get(apiKey, roleCode);

  if (!existing) {
    db.prepare(`
      INSERT INTO project_ai_role_configs (api_key, role_code, enabled, provider_id, model_name, harness_config)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      apiKey, roleCode,
      input.enabled ? 1 : 0,
      input.providerId ?? null,
      input.modelName ?? '',
      JSON.stringify(input.harnessConfig ?? {}),
    );
  } else {
    const sets = [];
    const vals = [];
    if (input.enabled !== undefined) { sets.push('enabled = ?'); vals.push(input.enabled ? 1 : 0); }
    if (input.providerId !== undefined) { sets.push('provider_id = ?'); vals.push(input.providerId || null); }
    if (input.modelName !== undefined) { sets.push('model_name = ?'); vals.push(input.modelName); }
    if (input.harnessConfig !== undefined) { sets.push('harness_config = ?'); vals.push(JSON.stringify(input.harnessConfig)); }
    if (sets.length > 0) {
      sets.push("updated_at = strftime('%s','now')");
      vals.push(apiKey, roleCode);
      db.prepare(
        `UPDATE project_ai_role_configs SET ${sets.join(', ')} WHERE api_key = ? AND role_code = ?`
      ).run(...vals);
    }
  }
  return getRoleConfig(db, apiKey, roleCode);
}

/**
 * The confirm/auto safety gate (plan/ai_roles_framework, Runtime Shape 2):
 * 'auto' requires BOTH harness_config.mode === 'auto' AND
 * harness_config.autoConfirmed === true — otherwise the effective mode is
 * 'confirm'. Applied in code at runtime, never trusted from a single field.
 * @param {object} harnessConfig
 * @returns {'confirm'|'auto'}
 */
export function effectiveMode(harnessConfig = {}) {
  return harnessConfig.mode === 'auto' && harnessConfig.autoConfirmed === true
    ? 'auto'
    : 'confirm';
}
