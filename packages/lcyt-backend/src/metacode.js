/**
 * Core backend metacode orchestration helper.
 *
 * Keeps the same processing order used historically in captions.js:
 *   1) DSK processor (async) — strips graphics metacode and may update text
 *   2) Sound processor (possibly sync) — strips sound metacode and may update text
 *   3) Cue processor (possibly sync) — strips cue metacode, evaluates rules, fires events
 */
export async function applyMetacodeProcessors(session, captions, dskProcessor = null, soundProcessor = null, cueProcessor = null) {
  if (!Array.isArray(captions) || captions.length === 0) return;

  // DSK processor first (await each call in sequence)
  if (dskProcessor) {
    for (const caption of captions) {
      caption.text = await dskProcessor(session.apiKey, caption.text || '', caption.codes ?? {});
    }
  }

  // Sound processor second — allow sync or async implementations
  if (soundProcessor) {
    for (const caption of captions) {
      // Support both sync and async processors
      caption.text = await Promise.resolve(soundProcessor(session.apiKey, caption.text || ''));
    }
  }

  // Cue processor third — allow sync or async implementations
  if (cueProcessor) {
    for (const caption of captions) {
      caption.text = await Promise.resolve(cueProcessor(session.apiKey, caption.text || '', caption.codes ?? {}));
    }
  }
}

export default applyMetacodeProcessors;
