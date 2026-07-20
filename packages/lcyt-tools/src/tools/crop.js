/**
 * crop.* tools — recall a vertical-crop preset (plan_vertical_crop.md §4)
 * the same way `camera.preset`/`mixer.switch` (tools/cameras.js,
 * tools/mixers.js) drive other production hardware.
 *
 * Unlike cameras/mixers (project-wide, unscoped `prod_cameras`/`prod_mixers`
 * tables — see tools/cameras.js's header comment), crop config/presets are
 * scoped per apiKey (`crop_config`/`crop_presets` in lcyt-rtmp's
 * db/crop.js), so these handlers use the real per-call `ctx.apiKey` instead
 * of ignoring it.
 *
 * Mirrors lcyt-rtmp's routes/crop.js dispatch exactly (GET /crop/presets,
 * POST /crop/presets/:id/activate) so a tool call and the operator UI button
 * behave identically.
 */

/**
 * @param {{ db, cropManager, getCropConfig, getCropPreset, listCropPresets }} deps
 *   db from 'lcyt-backend' (shared instance); cropManager + the crop db
 *   helpers from 'lcyt-rtmp'
 * @returns {Array<{ name, description, inputSchema, annotations, handler }>}
 */
export function createCropTools(deps) {
  const { db, cropManager, getCropConfig, getCropPreset, listCropPresets } = deps;

  return [
    {
      name: 'crop.list_presets',
      description: 'List the vertical-crop presets in the project\'s active preset set, along with the {key}-crop renderer\'s current status (running, active preset/position, live-vs-restart repositioning mode).',
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true },
      handler: (_args, ctx) => ({
        ok: true,
        presets: listCropPresets(db, ctx.apiKey),
        ...cropManager.getStatus(ctx.apiKey),
      }),
    },
    {
      name: 'crop.activate_preset',
      description: 'Activate a vertical-crop preset live — shifts the {key}-crop output to that preset\'s position. The crop renderer must already be running (crop_config.enabled and the project publishing).',
      inputSchema: {
        type: 'object',
        properties: {
          presetId: { type: 'string' },
          transitionMs: { type: 'number', description: 'Optional eased-pan duration in ms; defaults to the project\'s configured crop_config.transitionMs.' },
        },
        required: ['presetId'],
      },
      annotations: { destructiveHint: true },
      handler: async ({ presetId, transitionMs }, ctx) => {
        const apiKey = ctx.apiKey;
        const preset = getCropPreset(db, apiKey, presetId);
        if (!preset) return { ok: false, error: 'Preset not found' };
        if (!cropManager.isRunning(apiKey)) return { ok: false, error: 'Crop renderer is not running' };

        const ms = Number.isFinite(Number(transitionMs)) && Number(transitionMs) >= 0
          ? Number(transitionMs)
          : getCropConfig(db, apiKey).transitionMs;

        try {
          const result = await cropManager.applyPosition(apiKey, {
            xNorm: preset.xNorm,
            yNorm: preset.yNorm,
            transitionMs: ms,
            activePresetId: preset.id,
          });
          return { ok: true, presetId: preset.id, ...result };
        } catch (err) {
          return { ok: false, error: err.message };
        }
      },
    },
  ];
}
