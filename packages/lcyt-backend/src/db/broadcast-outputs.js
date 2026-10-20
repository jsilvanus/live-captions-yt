/**
 * Broadcast outputs (plan_broadcast_lifecycle.md PR 5): which egress outputs
 * (`outputs`, plan_egress_outputs.md) a broadcast puts on air.
 *
 * A broadcast with no rows uses the project as configured (every enabled relay
 * slot, as before); with rows only the enabled linked outputs are on air.
 * `output_id` is an `outputs.id` without a foreign key, so it is checked here.
 */

const MAX_CHAIN = 4;

/**
 * The linked outputs of a broadcast, with what the output table says now.
 * @returns {Promise<Array<{ outputId: string, enabled: boolean, sortOrder: number, name: string|null, outputEnabled: boolean|null, missing: boolean }>>}
 */
export async function listBroadcastOutputs(db, broadcastId) {
  const links = await db.broadcast_outputs.findMany({
    where: { broadcast_id: broadcastId },
    orderBy: [{ sort_order: 'asc' }, { output_id: 'asc' }],
  });
  if (!links.length) return [];
  const rows = await db.outputs.findMany({ where: { id: { in: links.map((l) => l.output_id) } } });
  const byId = new Map(rows.map((r) => [r.id, r]));
  return links.map((l) => {
    const o = byId.get(l.output_id);
    return {
      outputId: l.output_id, enabled: l.enabled !== 0, sortOrder: l.sort_order,
      name: o?.name ?? null, outputEnabled: o ? o.enabled !== 0 : null, missing: !o,
    };
  });
}

/**
 * Replace the broadcast's outputs. `items` is `[{ outputId, enabled? }]` (or plain ids); order is kept as sort order.
 * @returns {Promise<{ ok: true, outputs: object[] } | { ok: false, error: string, status: number }>}
 */
export async function setBroadcastOutputs(db, apiKey, broadcastId, items) {
  if (!Array.isArray(items)) return { ok: false, error: 'outputs must be a list', status: 400 };
  const wanted = [];
  for (const it of items) {
    const outputId = typeof it === 'string' ? it : it?.outputId;
    if (typeof outputId !== 'string' || !outputId) return { ok: false, error: 'each output needs an outputId', status: 400 };
    if (wanted.some((w) => w.outputId === outputId)) return { ok: false, error: `output '${outputId}' is listed twice`, status: 400 };
    wanted.push({ outputId, enabled: typeof it === 'object' && it.enabled === false ? 0 : 1 });
  }
  if (wanted.length) {
    const owned = await db.outputs.findMany({
      where: { owner_api_key: apiKey, id: { in: wanted.map((w) => w.outputId) } }, select: { id: true },
    });
    const ok = new Set(owned.map((o) => o.id));
    const bad = wanted.find((w) => !ok.has(w.outputId));
    if (bad) return { ok: false, error: `Unknown output '${bad.outputId}'`, status: 400 };
  }
  await db.$transaction(async (tx) => {
    await tx.broadcast_outputs.deleteMany({ where: { broadcast_id: broadcastId } });
    for (let i = 0; i < wanted.length; i++) {
      await tx.broadcast_outputs.create({
        data: { broadcast_id: broadcastId, output_id: wanted[i].outputId, enabled: wanted[i].enabled, sort_order: i },
      });
    }
  });
  return { ok: true, outputs: await listBroadcastOutputs(db, broadcastId) };
}

/**
 * What the broadcast puts on air: `linked: false` = nothing chosen, the project as configured;
 * otherwise `outputIds` are the enabled links whose output still exists and is enabled.
 * @returns {Promise<{ linked: boolean, outputIds: string[] }>}
 */
export async function getOutputSelection(db, broadcastId) {
  const list = await listBroadcastOutputs(db, broadcastId);
  if (!list.length) return { linked: false, outputIds: [] };
  return {
    linked: true,
    outputIds: list.filter((l) => l.enabled && !l.missing && l.outputEnabled).map((l) => l.outputId),
  };
}

/**
 * Relay slots a selection puts on air: slots that send an output outside the selection are left out,
 * every other slot (a feed, the old program/crop view) stays. `outputIds: null` = no selection, all slots.
 */
export function filterRelaysForOutputs(relays, outputIds) {
  if (!outputIds) return relays;
  const keep = new Set(outputIds);
  return relays.filter((r) => !r.sourceOutputId || keep.has(r.sourceOutputId));
}

/**
 * Whether an output carries a picture: follow its source (feed or output) to the feed and read the feed's `media`
 * (`av|audio|video`). A broken or too deep chain counts as `av`.
 */
async function outputMedia(db, apiKey, output, byId) {
  let cur = output;
  for (let i = 0; i < MAX_CHAIN; i++) {
    if (cur.source_type === 'output') {
      cur = byId.get(cur.source_id) ?? (await db.outputs.findFirst({ where: { id: cur.source_id, owner_api_key: apiKey } }));
      if (!cur) return 'av';
      continue;
    }
    const feed = await db.prod_feeds.findFirst({ where: { id: cur.source_id }, select: { media: true } });
    return feed?.media || 'av';
  }
  return 'av';
}

/**
 * The deliverables rule (plan 2.3) for a selection: an output on a feed that has a picture is a video feed out
 * (a DSK output alone is enough, it needs no relay slot); an output on an audio-only feed is an audio feed out.
 * @returns {Promise<{ video: boolean, audio: boolean }>}
 */
export async function selectionDeliverables(db, apiKey, outputIds) {
  if (!outputIds.length) return { video: false, audio: false };
  const rows = await db.outputs.findMany({ where: { owner_api_key: apiKey } });
  const byId = new Map(rows.map((r) => [r.id, r]));
  let video = false;
  let audio = false;
  for (const id of outputIds) {
    const o = byId.get(id);
    if (!o) continue;
    const media = await outputMedia(db, apiKey, o, byId);
    if (media === 'audio') audio = true; else video = true;
  }
  return { video, audio };
}

/** Pre-flight findings about the chosen outputs (plan 2.3, step 3). */
export async function outputFindings(db, broadcastId) {
  const findings = [];
  for (const l of await listBroadcastOutputs(db, broadcastId)) {
    if (!l.enabled) continue;
    if (l.missing) {
      findings.push({ code: 'output_missing', severity: 'warn', message: `Output ${l.outputId} no longer exists and is left out`, outputId: l.outputId });
    } else if (!l.outputEnabled) {
      findings.push({ code: 'output_disabled', severity: 'warn', message: `Output "${l.name}" is disabled in the project and is left out`, outputId: l.outputId });
    }
  }
  return findings;
}
