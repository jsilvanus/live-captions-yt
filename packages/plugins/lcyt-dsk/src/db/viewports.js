// ─── Viewport helpers ─────────────────────────────────────────────────────────

/**
 * List all user-defined viewports for an API key.
 * @param {import('lcyt-backend/db').Db} db Prisma client
 * @param {string} apiKey
 * @returns {Promise<Array>}
 */
export async function listViewports(db, apiKey) {
  return db.dsk_viewports.findMany({ where: { api_key: apiKey }, orderBy: [{ created_at: 'asc' }, { id: 'asc' }] });
}

/**
 * Get a single viewport by name for an API key.
 * @param {import('lcyt-backend/db').Db} db Prisma client
 * @param {string} apiKey
 * @param {string} name
 * @returns {Promise<object|null>}
 */
export async function getViewport(db, apiKey, name) {
  return (await db.dsk_viewports.findUnique({ where: { api_key_name: { api_key: apiKey, name } } })) ?? null;
}

/**
 * Create or update a viewport. Name is immutable once set (use delete + create to rename).
 * @param {import('lcyt-backend/db').Db} db Prisma client
 * @param {string} apiKey
 * @param {{ name: string, label?: string, viewportType?: string, width?: number, height?: number, textLayersJson?: string, displaySettingsJson?: string }} data
 * @returns {Promise<object>} the upserted row
 */
export async function upsertViewport(db, apiKey, { name, label, viewportType, width, height, textLayersJson, displaySettingsJson }) {
  const now = db.$util.sqlNow();
  const fields = {
    label: label ?? null,
    viewport_type: viewportType ?? 'landscape',
    width: width ?? 1920,
    height: height ?? 1080,
    text_layers_json: textLayersJson ?? null,
    display_settings_json: displaySettingsJson ?? null,
    updated_at: now,
  };
  await db.dsk_viewports.upsert({
    where: { api_key_name: { api_key: apiKey, name } },
    create: { api_key: apiKey, name, created_at: now, ...fields },
    update: fields,
  });
  return getViewport(db, apiKey, name);
}

/**
 * Enforce the single-composite-stream invariant (plan_dsk_viewport_settings
 * Phase 4): at most one viewport per api_key may have
 * `displaySettings.stream.mode === 'composite'`. Demotes every OTHER composite
 * viewport to `'standalone'` (keeping it enabled — only the composite bit is
 * exclusive). No-op unless `keepName`'s own stream is composite.
 *
 * @param {import('lcyt-backend/db').Db} db Prisma client
 * @param {string} apiKey
 * @param {string} keepName  the viewport allowed to stay composite
 * @returns {Promise<string[]>} names of viewports that were demoted
 */
export async function demoteOtherCompositeViewports(db, apiKey, keepName) {
  const rows = await db.dsk_viewports.findMany({
    where: { api_key: apiKey, name: { not: keepName } },
    select: { name: true, display_settings_json: true },
  });

  const demoted = [];
  await db.$transaction(async (tx) => {
    for (const r of rows) {
      let settings;
      try { settings = JSON.parse(r.display_settings_json || 'null'); } catch { continue; }
      if (settings?.stream?.mode !== 'composite') continue;
      settings.stream.mode = 'standalone';
      await tx.dsk_viewports.updateMany({
        where: { api_key: apiKey, name: r.name },
        data: { display_settings_json: JSON.stringify(settings), updated_at: db.$util.sqlNow() },
      });
      demoted.push(r.name);
    }
  });
  return demoted;
}

/**
 * Return the chroma-key config of the api_key's composite-mode viewport, or
 * null. Used by the DSK RTMP program composite (Phase 5) to key the overlay.
 * Only an enabled chromaKey is returned.
 * @param {import('lcyt-backend/db').Db} db Prisma client
 * @param {string} apiKey
 * @returns {Promise<{ enabled: boolean, color?: string, similarity?: number, blend?: number }|null>}
 */
export async function getCompositeChromaKey(db, apiKey) {
  const rows = await db.dsk_viewports.findMany({ where: { api_key: apiKey }, select: { display_settings_json: true } });
  for (const r of rows) {
    let s;
    try { s = JSON.parse(r.display_settings_json || 'null'); } catch { continue; }
    if (s?.stream?.mode === 'composite' && s.stream.chromaKey?.enabled) {
      return s.stream.chromaKey;
    }
  }
  return null;
}

/**
 * Delete a viewport by name.
 * @param {import('lcyt-backend/db').Db} db Prisma client
 * @param {string} apiKey
 * @param {string} name
 * @returns {Promise<boolean>} true if a row was deleted
 */
export async function deleteViewport(db, apiKey, name) {
  const res = await db.dsk_viewports.deleteMany({ where: { api_key: apiKey, name } });
  return res.count > 0;
}
