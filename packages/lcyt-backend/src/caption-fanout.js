/**
 * Caption fan-out to a session's extra targets (YouTube / generic / viewer),
 * extracted from routes/captions.js so delivery paths that bypass the
 * captions route (server-side STT in lcyt-rtmp) share one implementation of
 * Phase 5 per-target routed composition instead of hand-rolling a subset.
 *
 * Fire-and-forget: per-target errors are logged and never affect the caller.
 */

import { composeCaptionText } from './caption-files.js';
import { getTranslationTargets } from './db/translation-config.js';
import { broadcastToViewers, registerViewerKeyOwner } from './routes/viewer.js';

/**
 * @param {{ db: object }} deps
 * @returns {(session: object, captions: Array<{
 *   text: string,
 *   composedText?: string,        // default composition; computed from captionLang/translations/showOriginal when absent
 *   timestamp?: string|Date,      // raw timestamp (Date allowed); ISO string derived for payloads
 *   translations?: Record<string,string>,
 *   captionLang?: string|null,
 *   showOriginal?: boolean,
 *   codes?: object,
 * }>) => void}
 */
export function createCaptionFanout({ db }) {
  return function fanOutToTargets(session, captions) {
    if (!session?.extraTargets || session.extraTargets.length === 0) return;
    if (!Array.isArray(captions) || captions.length === 0) return;
    const source = session.domain;

    // Phase 5: Load per-target routed translations for per-target-aware caption composition
    let translationsByTargetId = {};
    try {
      const allTranslations = getTranslationTargets(db, session.apiKey);
      for (const tr of allTranslations) {
        if (tr.enabled && tr.target === 'captions' && tr.captionTargetId) {
          if (!translationsByTargetId[tr.captionTargetId]) {
            translationsByTargetId[tr.captionTargetId] = [];
          }
          translationsByTargetId[tr.captionTargetId].push(tr);
        }
      }
    } catch (err) {
      // Ignore translation lookup errors — deliver with default composition
    }

    // Normalise entries: fill in default composition and the ISO string form
    // of the timestamp used by generic/viewer payloads.
    const entries = captions.map(c => ({
      ...c,
      composedText: c.composedText ?? composeCaptionText(c.text, c.captionLang, c.translations, c.showOriginal),
      tsStr: typeof c.timestamp === 'string' ? c.timestamp
        : (c.timestamp instanceof Date ? c.timestamp.toISOString() : undefined),
    }));

    // Full per-caption payload for generic/viewer targets: original text,
    // composed text, and all translation metadata so downstream services can
    // apply their own logic.
    const genericCaptions = entries.map(e => ({
      text: e.text,
      composedText: e.composedText,
      timestamp: e.tsStr,
      ...(e.translations && { translations: e.translations }),
      ...(e.captionLang && { captionLang: e.captionLang }),
      ...(e.showOriginal !== undefined && { showOriginal: e.showOriginal }),
      ...(e.codes && typeof e.codes === 'object' && { codes: e.codes }),
    }));

    for (const target of session.extraTargets) {
      if (target.type === 'youtube' && target.sender) {
        // Phase 5: Check for routed translation target
        const routed = (translationsByTargetId[target.id] || [])[0];
        for (const e of entries) {
          const text = routed
            ? composeCaptionText(e.text, routed.lang, e.translations, routed.showOriginal)
            : e.composedText;
          target.sender.send(text, e.timestamp).catch(err => {
            console.warn(`[captions] Extra YouTube target ${target.id} error: ${err.message}`);
          });
        }
      } else if (target.type === 'generic' && target.url) {
        // Phase 5: Use routed translation for generic targets too
        const routed = (translationsByTargetId[target.id] || [])[0];
        const targetCaptions = routed
          ? entries.map(e => ({
              text: e.text,
              composedText: composeCaptionText(e.text, routed.lang, e.translations, routed.showOriginal),
              timestamp: e.tsStr,
              ...(e.translations && { translations: e.translations }),
              ...(routed.lang && { captionLang: routed.lang }),
              ...(e.codes && typeof e.codes === 'object' && { codes: e.codes }),
            }))
          : genericCaptions;

        fetch(target.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(target.headers || {}) },
          body: JSON.stringify({ source, sequence: session.sequence, captions: targetCaptions }),
        }).catch(err => {
          console.warn(`[captions] Generic target ${target.id} error: ${err.message}`);
        });
      } else if (target.type === 'viewer' && target.viewerKey) {
        // Register the owner mapping so viewer stats can be attributed to this API key
        registerViewerKeyOwner(target.viewerKey, session.apiKey);

        // Phase 5: Use routed translation for viewer targets
        const routed = (translationsByTargetId[target.id] || [])[0];
        for (const e of entries) {
          const composedText = routed
            ? composeCaptionText(e.text, routed.lang, e.translations, routed.showOriginal)
            : e.composedText;
          broadcastToViewers(target.viewerKey, {
            text: e.text,
            composedText,
            sequence: session.sequence,
            timestamp: e.tsStr,
            ...(e.translations && { translations: e.translations }),
            ...(e.codes && { codes: e.codes }),
          });
        }
      }
    }
  };
}
