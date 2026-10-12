/**
 * asset.* tools — Assets page (Asset Control Assistant role). "Assets" here
 * are the caption_files rows with type='image' that back DSK overlay image
 * layers (upload happens through the existing multipart /images POST route —
 * not exposed as a tool, since a tool-calling LLM turn has no binary payload
 * to attach).
 */

/**
 * @param {{ db, listImages, getImageByKey, updateImageSettings, deleteImage }} deps
 *   db + image DB helpers from 'lcyt-dsk'
 * @returns {Array<{ name, description, inputSchema, annotations, handler }>}
 */
export function createAssetTools(deps) {
  const { db, listImages, getImageByKey, updateImageSettings, deleteImage } = deps;

  return [
    {
      name: 'asset.list',
      description: 'List uploaded DSK overlay image assets for this project.',
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true },
      handler: async (_args, { apiKey }) => ({ ok: true, assets: await listImages(db, apiKey) }),
    },
    {
      name: 'asset.update',
      description: 'Update an image asset\'s settings (e.g. crop/display metadata).',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'number' }, settings: { type: 'object' } },
        required: ['id', 'settings'],
      },
      annotations: {},
      handler: async ({ id, settings }, { apiKey }) => {
        const updated = await updateImageSettings(db, id, apiKey, settings);
        if (!updated) return { ok: false, error: 'Asset not found' };
        return { ok: true, asset: await getImageByKey(db, id, apiKey) };
      },
    },
    {
      name: 'asset.delete',
      description: 'Delete an image asset.',
      inputSchema: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] },
      annotations: { destructiveHint: true },
      handler: async ({ id }, { apiKey }) => {
        const deleted = await deleteImage(db, id, apiKey);
        return deleted ? { ok: true } : { ok: false, error: 'Asset not found' };
      },
    },
  ];
}
