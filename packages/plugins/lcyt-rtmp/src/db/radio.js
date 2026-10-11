/**
 * Web Radio config DB helpers (plan/selfservice_config_backend §3).
 *
 * radio_config is a single-row-per-key table for metadata (title, description,
 * cover image, autoplay). The `radio_enabled` admin entitlement itself stays
 * on api_keys and is surfaced here read-only — see the plan's §3 self-service
 * enable/disable decision.
 */

function formatConfigRow(row, radioEnabled) {
  return {
    title:         row?.title ?? null,
    description:   row?.description ?? null,
    coverImageUrl: row?.cover_image_url ?? null,
    autoplay:      row?.autoplay === 1,
    enabled:       radioEnabled === 1,
  };
}

/**
 * Get the Web Radio config for an API key, including the read-only
 * `radio_enabled` admin entitlement as `enabled`.
 * @param {object} db  Prisma client
 * @param {string} apiKey
 * @returns {Promise<{ title: string|null, description: string|null, coverImageUrl: string|null, autoplay: boolean, enabled: boolean }>}
 */
export async function getRadioConfig(db, apiKey) {
  const row = await db.radio_config.findUnique({ where: { api_key: apiKey } });
  const keyRow = await db.api_keys.findUnique({ where: { key: apiKey }, select: { radio_enabled: true } });
  return formatConfigRow(row, keyRow?.radio_enabled ?? 0);
}

/**
 * Upsert the Web Radio config for an API key. Only provided fields are changed.
 * @param {object} db  Prisma client
 * @param {string} apiKey
 * @param {{ title?: string|null, description?: string|null, coverImageUrl?: string|null, autoplay?: boolean }} patch
 * @returns {Promise<{ ok: true, config: object }>}
 */
export async function setRadioConfig(db, apiKey, patch = {}) {
  const existing = await db.radio_config.findUnique({ where: { api_key: apiKey } });
  const next = {
    title:         patch.title         !== undefined ? patch.title         : existing?.title ?? null,
    description:   patch.description   !== undefined ? patch.description   : existing?.description ?? null,
    coverImageUrl: patch.coverImageUrl !== undefined ? patch.coverImageUrl : existing?.cover_image_url ?? null,
    autoplay:      patch.autoplay      !== undefined ? Boolean(patch.autoplay) : existing?.autoplay === 1,
  };
  const values = {
    title: next.title,
    description: next.description,
    cover_image_url: next.coverImageUrl,
    autoplay: next.autoplay ? 1 : 0,
    updated_at: db.$util.sqlNow(),
  };
  await db.radio_config.upsert({
    where: { api_key: apiKey },
    create: { api_key: apiKey, ...values },
    update: values,
  });

  return { ok: true, config: await getRadioConfig(db, apiKey) };
}
