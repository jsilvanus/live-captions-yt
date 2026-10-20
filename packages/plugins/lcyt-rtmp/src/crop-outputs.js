/**
 * Crop per output (plan_egress_outputs.md PR 2): which MediaMTX paths a crop reads and writes, which feed it hangs on,
 * and starting / stopping the crops of a project when a feed starts or stops publishing.
 *
 * A project's default crop (crop_config) keeps the session key = api key and the legacy output path `{apiKey}-crop`, so every
 * caller that predates outputs (relay slots with sourceView 'crop', lcyt-tools, auto-follow) is unchanged. Any other
 * output's crop uses the session key = output id and writes `out-<id>-crop`.
 */
import logger from 'lcyt/logger';
import { listCropScopes, cropSessionKey } from './db/crop.js';
import { getPrimaryFeedId } from './db/feeds.js';

import { outputCropPath, outputSourcePath, MAX_CROP_SOURCE_DEPTH } from './output-paths.js';

export { outputCropPath, outputSourcePath, MAX_CROP_SOURCE_DEPTH };

/**
 * Walk an output's source chain down to its feed.
 * @returns {Promise<{ feedId: string, feedKey: string, chain: string[] }|null>} chain = output ids from the output to the last one before the feed
 */
export async function resolveRootFeed(db, apiKey, outputId) {
  const chain = [];
  let cursor = outputId;
  for (let i = 0; i < MAX_CROP_SOURCE_DEPTH; i++) {
    if (chain.includes(cursor)) return null;
    const out = await db.outputs.findFirst({ where: { id: cursor, owner_api_key: apiKey }, select: { id: true, source_type: true, source_id: true } });
    if (!out) return null;
    chain.push(out.id);
    if (out.source_type === 'feed') {
      const feed = await db.prod_feeds.findFirst({ where: { id: out.source_id, owner_api_key: apiKey }, select: { id: true, feed_key: true } });
      return feed ? { feedId: feed.id, feedKey: feed.feed_key, chain } : null;
    }
    cursor = out.source_id;
  }
  return null;
}

/**
 * Everything CropManager.start needs besides the config for a scope. The default crop of a project that has no output
 * (no primary feed) gets no paths: CropManager falls back to its legacy `{apiKey}` and `{apiKey}-crop`.
 * @returns {Promise<{ sessionKey: string, apiKey: string, sourcePath?: string, outputPath?: string, rootFeedId: string|null }>}
 */
export async function cropSpec(db, scope) {
  const sessionKey = cropSessionKey(scope);
  const { apiKey } = scope;
  if (!scope.outputId) {
    return { sessionKey, apiKey, rootFeedId: await getPrimaryFeedId(db, apiKey) };
  }
  const defaultId = scope.isDefault ? scope.outputId : (await db.crop_config.findUnique({ where: { api_key: apiKey }, select: { output_id: true } }))?.output_id ?? null;
  const [root, sourcePath] = await Promise.all([
    resolveRootFeed(db, apiKey, scope.outputId),
    outputSourcePath(db, apiKey, scope.outputId, defaultId),
  ]);
  return {
    sessionKey, apiKey,
    sourcePath: sourcePath ?? undefined,
    outputPath: outputCropPath(apiKey, scope.outputId, scope.isDefault),
    rootFeedId: root?.feedId ?? null,
  };
}

/** A crop may not read the crop of another output yet (the second hop needs the step supervisor, PR 3). */
export async function checkCropChain(db, apiKey, outputId) {
  const out = await db.outputs.findFirst({ where: { id: outputId, owner_api_key: apiKey }, select: { source_type: true, source_id: true } });
  if (out?.source_type !== 'output') return null;
  const parent = await db.outputs.findFirst({ where: { id: out.source_id, owner_api_key: apiKey }, select: { crop_enabled: true } });
  return parent?.crop_enabled === 1 ? 'cropping the picture of an output that is itself cropped is not supported yet' : null;
}

/**
 * Start every enabled crop of the project whose feed just started publishing. `feedId` null means the project's main stream
 * (the primary feed). Best effort: failures are logged, never thrown.
 */
export async function startCropsForFeed(db, cropManager, readThrough, apiKey, feedId = null) {
  try {
    const primary = await getPrimaryFeedId(db, apiKey);
    const wanted = feedId ?? primary;
    for (const { scope, config } of await listCropScopes(db, apiKey)) {
      if (!config.enabled) continue;
      const spec = await cropSpec(db, scope);
      if ((spec.rootFeedId ?? primary) !== wanted) continue;
      if (await readThrough(cropManager, 'isRunning', spec.sessionKey)) continue;
      const { sessionKey, ...opts } = spec;
      cropManager.start(sessionKey, config, opts).catch(err => {
        logger.error(`[crop] renderer start failed for ${apiKey.slice(0, 8)}… (${sessionKey.slice(0, 12)}): ${err.message}`);
      });
    }
  } catch (err) {
    logger.error(`[crop] could not start the crops of ${apiKey.slice(0, 8)}…: ${err.message}`);
  }
}

/** Stop the running crops of the project that hang on a feed (`feedId` null = the main stream). */
export async function stopCropsForFeed(db, cropManager, readThrough, apiKey, feedId = null) {
  try {
    const primary = await getPrimaryFeedId(db, apiKey);
    const wanted = feedId ?? primary;
    for (const { scope } of await listCropScopes(db, apiKey)) {
      const spec = await cropSpec(db, scope);
      if ((spec.rootFeedId ?? primary) !== wanted) continue;
      if (!(await readThrough(cropManager, 'isRunning', spec.sessionKey))) continue;
      cropManager.stop(spec.sessionKey).catch(err => {
        logger.error(`[crop] renderer stop failed for ${apiKey.slice(0, 8)}… (${spec.sessionKey.slice(0, 12)}): ${err.message}`);
      });
    }
  } catch (err) {
    logger.error(`[crop] could not stop the crops of ${apiKey.slice(0, 8)}…: ${err.message}`);
  }
}
