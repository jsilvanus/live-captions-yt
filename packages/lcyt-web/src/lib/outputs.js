/**
 * Pure helpers for the egress outputs card (plan_egress_outputs.md PR 5). An output is a named pipeline
 * `source (feed or output) -> DSK viewports -> crop -> destinations`; the server keeps it in `outputs`
 * (GET/POST/PATCH/DELETE /outputs). No React here, so node tests can import this file.
 */

/** The <select> value for a source: `feed:<id>` or `output:<id>`. */
export function outputSourceValue(output) {
  return output?.sourceType === 'output' ? `output:${output.sourceId}` : `feed:${output?.sourceId || ''}`;
}

/** @returns {{ sourceType: 'feed'|'output', sourceId: string } | null} */
export function parseOutputSource(value) {
  if (typeof value !== 'string') return null;
  const i = value.indexOf(':');
  if (i < 0) return null;
  const type = value.slice(0, i);
  const id = value.slice(i + 1);
  if ((type !== 'feed' && type !== 'output') || !id) return null;
  return { sourceType: type, sourceId: id };
}

/** The audio <select> value: `source` (the picture's own sound) or `feed:<id>`. */
export function audioSourceValue(audioSource) {
  return audioSource && typeof audioSource === 'object' && audioSource.feed ? `feed:${audioSource.feed}` : 'source';
}

/** Back from the audio <select> value to what the API stores. */
export function audioSourceFromValue(value) {
  if (typeof value === 'string' && value.startsWith('feed:') && value.length > 5) return { feed: value.slice(5) };
  return 'source';
}

/** Outputs an output may take its picture from: every other output (the server refuses loops and deep chains). */
export function selectableChainOutputs(outputs, selfId) {
  return (outputs || []).filter(o => o && o.id && o.id !== selfId);
}

/** Feeds an output may read: the project's named feeds (managed entries such as the DSK slot are left out). */
export function selectableOutputFeeds(feeds) {
  return (feeds || []).filter(f => f && f.id && !f.managed);
}

export const EMPTY_OUTPUT_FORM = Object.freeze({
  name: '', source: '', dsk: [], cropEnabled: false, audio: 'source', enabled: true,
});

/** Form state for an existing output. */
export function formFromOutput(output) {
  return {
    name: output.name,
    source: outputSourceValue(output),
    dsk: [...(output.dsk || [])],
    cropEnabled: !!output.cropEnabled,
    audio: audioSourceValue(output.audioSource),
    enabled: output.enabled !== false,
  };
}

/** Request body for POST/PATCH /outputs, or null when the form is not complete. */
export function outputBody(form) {
  const source = parseOutputSource(form.source);
  const name = (form.name || '').trim();
  if (!name || !source) return null;
  return {
    name,
    ...source,
    dsk: form.dsk || [],
    cropEnabled: !!form.cropEnabled,
    audioSource: audioSourceFromValue(form.audio),
    enabled: form.enabled !== false,
  };
}

/** Toggle a viewport name in the ordered DSK list (order is the stacking order). */
export function toggleDsk(list, name) {
  return list.includes(name) ? list.filter(n => n !== name) : [...list, name];
}
