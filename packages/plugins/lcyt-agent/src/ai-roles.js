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
 * Seed the role catalog (idempotent upsert). The tables themselves come from the backend schema.
 * @param {import('lcyt-backend/db').Db} db
 */
export async function runAiRolesMigrations(db) {
  for (const role of BUILTIN_ROLES) {
    const data = {
      name: role.name,
      description: role.description,
      input_types: JSON.stringify(role.input_types),
      output_type: role.output_type,
      runtime_kind: role.runtime_kind,
      available_tools: JSON.stringify(role.available_tools),
    };
    await db.ai_roles.upsert({
      where: { role_code: role.role_code },
      create: { role_code: role.role_code, ...data },
      update: data,
    });
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

export async function listRoles(db) {
  const rows = await db.ai_roles.findMany({ orderBy: { role_code: 'asc' } });
  return rows.map(formatRole);
}

export async function getRole(db, roleCode) {
  return formatRole(await db.ai_roles.findUnique({ where: { role_code: roleCode } }));
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
export async function getRoleConfig(db, apiKey, roleCode) {
  const row = await db.project_ai_role_configs.findUnique({
    where: { api_key_role_code: { api_key: apiKey, role_code: roleCode } },
  });
  return row ? formatConfig(row) : defaultRoleConfig(roleCode);
}

/**
 * Upsert a project's config for a role. Only provided fields change.
 * @param {object} input — { enabled?, providerId?, modelName?, harnessConfig? }
 */
export async function setRoleConfig(db, apiKey, roleCode, input) {
  const existing = await db.project_ai_role_configs.findUnique({
    where: { api_key_role_code: { api_key: apiKey, role_code: roleCode } },
    select: { id: true },
  });

  if (!existing) {
    await db.project_ai_role_configs.create({
      data: {
        api_key: apiKey,
        role_code: roleCode,
        enabled: input.enabled ? 1 : 0,
        provider_id: input.providerId ?? null,
        model_name: input.modelName ?? '',
        harness_config: JSON.stringify(input.harnessConfig ?? {}),
        updated_at: Math.floor(Date.now() / 1000),
      },
    });
  } else {
    const data = {};
    if (input.enabled !== undefined) data.enabled = input.enabled ? 1 : 0;
    if (input.providerId !== undefined) data.provider_id = input.providerId || null;
    if (input.modelName !== undefined) data.model_name = input.modelName;
    if (input.harnessConfig !== undefined) data.harness_config = JSON.stringify(input.harnessConfig);
    if (Object.keys(data).length > 0) {
      data.updated_at = Math.floor(Date.now() / 1000);
      await db.project_ai_role_configs.updateMany({ where: { api_key: apiKey, role_code: roleCode }, data });
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
