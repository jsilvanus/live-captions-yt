/**
 * DSK caption processor.
 *
 * Extracts <!-- graphics:... --> and <!-- graphics[viewport,...]:... --> metadata from caption
 * text, emits DSK SSE events to subscribed overlay pages, and updates the RTMP relay overlay.
 *
 * Metacode syntax:
 *   <!-- graphics:logo,banner -->                         default: all viewports get logo+banner (absolute)
 *   <!-- graphics[vertical-left]:stanza,logo -->          vertical-left gets stanza+logo (overrides default)
 *   <!-- graphics[v1,v2]:stanza -->                       v1 AND v2 both get stanza
 *   <!-- graphics[vertical-right]: -->                    vertical-right gets nothing (cleared)
 *   <!-- graphics:+logo -->                               add logo to currently active set (delta mode)
 *   <!-- graphics:-banner -->                             remove banner from active set (delta mode)
 *   <!-- graphics:+logo,-banner -->                       add logo AND remove banner simultaneously
 *   <!-- graphics[v1]:+stanza -->                         add stanza only to v1's current active set
 *
 * Landscape aliases — the built-in landscape viewport (the /dsk/:key default display) can be
 * targeted by any of these names: "landscape", "default", "main".
 * All three resolve to the same "landscape" slot in the broadcast payload.
 *
 * Delta mode: triggered when ANY name in a section starts with + or -. Unprefixed names in a
 * delta section are treated as additions (+). Server maintains current active state per apiKey
 * so delta operations have something to work against. The broadcast payload always contains
 * complete resolved name lists — display pages need no changes.
 *
 * Override rule (absolute sections): if a viewport-specific section exists for a viewport, it
 * REPLACES the default for that viewport. Viewports not mentioned use the default section.
 *
 * SSE 'graphics' event payload:
 *   { default: string[]|null, viewports: { [name]: string[] }, ts: number }
 *   - default: null if no all-viewport section was found AND no delta changed the default slot
 *   - viewports: viewport-specific overrides (empty array = clear that viewport)
 *
 * SSE 'bindings' event payload (when caption has non-empty codes):
 *   { codes: { section?: string, stanza?: string, speaker?: string, ... }, ts: number }
 *
 * Used by lcyt-backend's captions route via dependency injection:
 *   const { captionProcessor } = await initDskControl(db, store, relayManager);
 *   app.use('/captions', createCaptionsRouter(store, auth, db, relayManager, captionProcessor));
 */

import { join, resolve, basename } from 'node:path';
import { getImageByShorthand, safeApiKey } from './db/images.js';

function safeParseJson(raw) {
  try {
    if (!raw) return {};
    return typeof raw === 'object' ? raw : JSON.parse(raw);
  } catch {
    return {};
  }
}

// Matches <!-- graphics[v1,v2]:name1, name2 --> (viewport-targeted section)
const VP_CODE_RE = /<!--\s*graphics\[([^\]]+)\]\s*:\s*(.*?)-->/gi;
// Matches <!-- graphics:name1, name2 --> (default / all-viewports section)
const DEFAULT_CODE_RE = /<!--\s*graphics\s*:\s*(.*?)-->/i;

const GRAPHICS_BASE_DIR = resolve(process.env.GRAPHICS_DIR || '/data/images');

// Names that target the built-in landscape / default viewport
const LANDSCAPE_ALIASES = new Set(['landscape', 'default', 'main']);

/**
 * Parse a comma-separated names string, detecting delta mode.
 * Returns { delta: false, names: string[] } or { delta: true, add: string[], remove: string[] }.
 * Delta mode is triggered when any name starts with + or -.
 * In delta mode, unprefixed names are treated as additions.
 */
function parseSection(rawNames) {
  const items = rawNames.split(',').map(n => n.trim()).filter(Boolean);
  const hasDelta = items.some(n => n[0] === '+' || n[0] === '-');

  if (!hasDelta) {
    return { delta: false, names: items };
  }

  const add    = [];
  const remove = [];
  for (const item of items) {
    if (item[0] === '-') {
      remove.push(item.slice(1).trim());
    } else if (item[0] === '+') {
      add.push(item.slice(1).trim());
    } else {
      add.push(item); // unprefixed in delta section → treat as add
    }
  }
  return { delta: true, add, remove };
}

/**
 * Apply a parsed section to a current names array.
 * Returns the new complete names array.
 */
function applySection(current, parsed) {
  if (!parsed.delta) return parsed.names;
  const set = new Set(current);
  for (const name of parsed.remove) set.delete(name);
  for (const name of parsed.add)    set.add(name);
  return [...set];
}

/**
 * Parse all DSK metacodes from a caption string.
 *
 * @param {string} text
 * @returns {{
 *   defaultSection: ReturnType<parseSection>|null,
 *   viewportSections: Object<string, ReturnType<parseSection>>,
 *   cleanText: string,
 * }}
 */
function parseDskMetacodes(text) {
  /** @type {Object<string, ReturnType<parseSection>>} */
  const viewportSections = {};

  // 1. Extract viewport-specific sections (<!-- graphics[v1,v2]:names -->)
  let m;
  VP_CODE_RE.lastIndex = 0;
  while ((m = VP_CODE_RE.exec(text)) !== null) {
    const vpList  = m[1].split(',').map(v => v.trim()).filter(Boolean);
    const section = parseSection(m[2]);
    for (const vp of vpList) {
      // Normalize landscape aliases to a single key
      const key = LANDSCAPE_ALIASES.has(vp) ? 'landscape' : vp;
      viewportSections[key] = section;
    }
  }

  // 2. Remove viewport-specific sections before looking for the default section,
  //    to prevent the default regex from matching inside them.
  const textWithoutVpSections = text.replace(/<!--\s*graphics\[[^\]]+\][^>]*-->/gi, '');

  // 3. Extract default (all-viewport) section
  const defMatch = textWithoutVpSections.match(DEFAULT_CODE_RE);
  const defaultSection = defMatch ? parseSection(defMatch[1]) : null;

  // 4. Build clean text: remove ALL graphics metacodes
  const cleanText = text
    .replace(/<!--\s*graphics(?:\[[^\]]+\])?\s*:[^>]*-->/gi, '')
    .trim();

  return { defaultSection, viewportSections, cleanText };
}

/**
 * Create a DSK caption processor function.
 *
 * @param {{ db: import('better-sqlite3').Database, store: object, relayManager: object|null }} opts
 * @returns {(apiKey: string, text: string, codes?: object) => Promise<string>}
 *   Always returns the cleaned caption text (with all <!-- graphics:... --> codes removed).
 *   If no graphics codes are present the text is returned unchanged.
 */
export function createDskCaptionProcessor({ db, dskBus, relayManager }) {
  return async function processDskCaption(apiKey, text, codes = {}) {
    // Emit 'bindings' SSE event if codes are present (section, stanza, speaker, etc.)
    if (codes && typeof codes === 'object' && Object.keys(codes).length > 0) {
      dskBus.emitDskEvent(apiKey, 'bindings', { codes, ts: Date.now() });
    }

    // Quick check: does the text contain any graphics metacode?
    if (!text.includes('<!--') || !/graphics/i.test(text)) return text;

    const { defaultSection, viewportSections, cleanText } = parseDskMetacodes(text);

    // If nothing was parsed (no default and no viewport sections), return unchanged
    if (defaultSection === null && Object.keys(viewportSections).length === 0) return text;

    // ── Apply sections against current server-side state ────────────────────
    const state = dskBus.getDskGraphicsState(apiKey);

    // Default slot
    let newDefault = null;
    if (defaultSection !== null) {
      newDefault = applySection(state.default, defaultSection);
      state.default = newDefault;
    }

    // Viewport-specific slots
    const newViewports = {};
    for (const [vpName, section] of Object.entries(viewportSections)) {
      const current = state.viewports[vpName] ?? state.default ?? [];
      const resolved = applySection(current, section);
      state.viewports[vpName] = resolved;
      newViewports[vpName] = resolved;
    }

    dskBus.setDskGraphicsState(apiKey, state);

    // Build per-image metadata map by reading image.settings_json for names
    const imageMeta = {};
    const allNames = new Set();
    if (Array.isArray(newDefault)) newDefault.forEach(n => allNames.add(n));
    for (const arr of Object.values(newViewports)) if (Array.isArray(arr)) arr.forEach(n => allNames.add(n));
    for (const name of allNames) {
      const row = getImageByShorthand(db, apiKey, name);
      if (!row) continue;
      const meta = safeParseJson(row.settings_json);
      imageMeta[name] = meta?.viewports ?? {};
    }

    // Emit SSE 'graphics' event to all open /dsk/:apikey/events subscribers
    dskBus.emitDskEvent(apiKey, 'graphics', {
      default:   newDefault,         // null if no default section touched this time
      viewports: newViewports,
      imageMeta: imageMeta,
      ts:        Date.now(),
    });

    if (cleanText) {
      dskBus.emitDskEvent(apiKey, 'text', { text: cleanText, ts: Date.now() });
    }

   

    return cleanText;
  };
}
 // Server-side DSK overlay (RTMP relay): use the resolved default for the landscape stream.
    // Relay accepts image assets and is responsible for any conversion (SVGs are allowed).
    if (relayManager && newDefault !== null) {
      // Respect per-image viewport visibility for the landscape/default slot.
      const imagePaths = [];
      for (const name of newDefault) {
        const row = getImageByShorthand(db, apiKey, name);
        if (!row) continue;
        const meta = safeParseJson(row.settings_json);
        const vpMeta = meta?.viewports?.landscape ?? meta?.viewports?.default ?? {};
        if (vpMeta?.visible === false) continue; // skip if explicitly disabled for landscape
        imagePaths.push(join(GRAPHICS_BASE_DIR, safeApiKey(apiKey), basename(row.filename)));
      }
      relayManager.setDskOverlay(apiKey, newDefault, imagePaths).catch(() => {});
    }