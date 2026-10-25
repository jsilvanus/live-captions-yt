/**
 * ffmpeg arguments of locked outputs (plan_locked_outputs.md): several outputs rendered by ONE ffmpeg.
 *
 * Pure, no I/O. Input 0 is the shared source, inputs 1..n are the distinct viewport streams the members use. Each member has a
 * list of viewports that are keyed and overlaid on the source in order (later = on top) and writes its own encoded picture to
 * its own URL. Members whose viewport lists start the same share that part of the chain: the picture is composited once and
 * `split` where the lists diverge. A viewport stream used on more than one branch is `split` first, because a filter label
 * can only be consumed once.
 *
 * With one member the arguments are exactly those of a plain DSK step (`buildDskStepArgs` in output-steps.js delegates here).
 */

/** `colorkey` filter body for a viewport's chromaKey, same rules as buildDskCompositeFilter (0xRRGGBB, similarity, blend). */
export function colorkeyFilter(chromaKey) {
  const raw = typeof chromaKey.color === 'string' ? chromaKey.color.trim() : '#00B140';
  const color = /^#[0-9a-fA-F]{6}$/.test(raw) ? `0x${raw.slice(1)}` : raw.replace(/[^0-9a-zA-Z]/g, '') || '0x00B140';
  const clamp01 = (v, d) => (Number.isFinite(Number(v)) ? Math.max(0, Math.min(1, Number(v))) : d);
  return `colorkey=${color}:${clamp01(chromaKey.similarity, 0.3)}:${clamp01(chromaKey.blend, 0.1)}`;
}

/** Two viewports are the same chain step when they read the same stream and key it the same way. */
function stepKey(v) {
  return `${v.url}|${v.chromaKey?.enabled ? JSON.stringify(v.chromaKey) : ''}`;
}

/**
 * @typedef {{ url: string, chromaKey?: object|null }} GroupViewport
 * @typedef {{ viewports: GroupViewport[], outputUrl: string, videoBitrate?: string|null }} GroupMember
 */

/**
 * @param {{ sourceUrl: string, members: GroupMember[] }} p  at least one member
 * @returns {string[]}  ffmpeg arguments
 */
export function buildGroupArgs({ sourceUrl, members }) {
  if (!Array.isArray(members) || members.length === 0) throw new Error('a group needs at least one member');

  // Inputs: one per distinct viewport stream, in first-seen order.
  const inputUrls = [];
  const inputIndex = new Map();
  for (const m of members) {
    for (const v of m.viewports) {
      if (!inputIndex.has(v.url)) { inputUrls.push(v.url); inputIndex.set(v.url, inputUrls.length); }
    }
  }

  // Trie of the members' viewport chains: members with the same leading steps share them.
  const root = { children: new Map(), ends: [] };
  for (let i = 0; i < members.length; i++) {
    let node = root;
    for (const v of members[i].viewports) {
      const k = stepKey(v);
      if (!node.children.has(k)) node.children.set(k, { viewport: v, children: new Map(), ends: [] });
      node = node.children.get(k);
    }
    node.ends.push(i);
  }

  // How many branches read each viewport stream (more than one needs a split of the input).
  const usage = new Map();
  const countUsage = (node) => {
    for (const child of node.children.values()) {
      const idx = inputIndex.get(child.viewport.url);
      usage.set(idx, (usage.get(idx) ?? 0) + 1);
      countUsage(child);
    }
  };
  countUsage(root);

  const parts = [];
  const nextViewportLabel = new Map();
  for (const [idx, n] of usage) {
    if (n > 1) {
      const labels = Array.from({ length: n }, (_, j) => `[v${idx}_${j}]`);
      parts.push(`[${idx}:v]split=${n}${labels.join('')}`);
      nextViewportLabel.set(idx, labels);
    }
  }

  const memberLabel = new Array(members.length).fill(null);
  let splitSeq = 0;
  let edgeSeq = 0;

  // Emit the filters below `node`, whose picture arrives on `inLabel`.
  const emit = (node, inLabel) => {
    const branches = node.children.size + node.ends.length;
    let labels = [inLabel];
    if (branches > 1) {
      const id = splitSeq++;
      labels = Array.from({ length: branches }, (_, j) => `[g${id}_${j}]`);
      parts.push(`${inLabel}split=${branches}${labels.join('')}`);
    }
    let b = 0;
    for (const m of node.ends) memberLabel[m] = labels[b++];
    for (const child of node.children.values()) {
      const idx = inputIndex.get(child.viewport.url);
      const shared = usage.get(idx) > 1;
      const sfx = shared ? `_${edgeSeq++}` : '';
      let ov = shared ? nextViewportLabel.get(idx).shift() : `[${idx}:v]`;
      if (child.viewport.chromaKey?.enabled) {
        parts.push(`${ov}${colorkeyFilter(child.viewport.chromaKey)}[k${idx}${sfx}]`);
        ov = `[k${idx}${sfx}]`;
      }
      // the viewport renders at its own size; fit it to the picture under it
      parts.push(`${ov}${labels[b]}scale2ref=w=main_w:h=main_h[s${idx}${sfx}][b${idx}${sfx}]`);
      parts.push(`[b${idx}${sfx}][s${idx}${sfx}]overlay=0:0:eof_action=pass[o${idx}${sfx}]`);
      b++;
      emit(child, `[o${idx}${sfx}]`);
    }
  };

  if (root.children.size === 0 && root.ends.length === 1) {
    // One member without viewports: a plain re-encode.
    parts.push('[0:v]null[o0]');
    memberLabel[root.ends[0]] = '[o0]';
  } else {
    emit(root, '[0:v]');
  }

  const args = ['-rtsp_transport', 'tcp', '-i', sourceUrl];
  for (const url of inputUrls) args.push('-rtsp_transport', 'tcp', '-i', url);
  args.push('-filter_complex', parts.join(';'));
  members.forEach((m, i) => {
    args.push('-map', memberLabel[i], '-map', '0:a?');
    args.push('-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency');
    if (m.videoBitrate) args.push('-b:v', m.videoBitrate);
    args.push('-c:a', 'copy', '-f', 'flv', m.outputUrl);
  });
  return args;
}

/** Filters the compiled group needs from the worker (`requires` of the fleet job). */
export function groupRequires(members) {
  const out = ['encoder:libx264'];
  if (members.some(m => m.viewports.some(v => v.chromaKey?.enabled))) out.push('filter:colorkey');
  return out;
}
