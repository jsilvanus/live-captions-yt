/**
 * metacodeAutocomplete.js — plan_ui.md v2 §5d's inline DSK metacode helper:
 * when the cursor sits inside an unclosed `<!-- ... -->` comment in
 * InputBar's caption field, offer completions for the `graphics`/
 * `graphics[viewport]` metacode (docs/METACODE.md) — the metacode keyword
 * itself, viewport names, and the image shorthand names `graphics:` values
 * actually resolve against (`getImageByShorthand()`,
 * `packages/plugins/lcyt-dsk/src/caption-processor.js` — not DSK template
 * names, despite this proposal's original "template names" wording; the
 * plugin never addresses graphics by template name).
 *
 * Pure, DOM-free — takes the input's raw text + cursor position, returns
 * either `null` (cursor isn't inside a relevant metacode) or a context
 * describing what's being typed and the exact text range a chosen
 * completion should replace.
 */

const KEYWORD_OPTIONS = [
  { name: 'graphics',  insertText: 'graphics: ' },
  { name: 'graphics[', insertText: 'graphics[' },
];

const LANDSCAPE_ALIASES = ['landscape', 'default', 'main'];

/**
 * @param {string} text
 * @param {number} cursorPos
 * @returns {{ kind: 'keyword'|'viewport'|'value', query: string, matchStart: number, matchEnd: number } | null}
 */
export function getMetacodeContext(text, cursorPos) {
  if (typeof text !== 'string' || cursorPos < 0) return null;
  const head = text.slice(0, cursorPos);
  const openIdx = head.lastIndexOf('<!--');
  if (openIdx === -1) return null;
  // Already closed before the cursor — not inside a comment anymore.
  if (head.indexOf('-->', openIdx) !== -1) return null;

  const inner = head.slice(openIdx + 4);

  // Stage 1: no ":" typed yet — either the bare keyword, or inside an
  // unclosed "[...]" viewport-name list right after "graphics".
  if (!inner.includes(':')) {
    const kwMatch = inner.match(/^\s*([a-zA-Z]*)(\[[^\]]*)?$/);
    if (!kwMatch) return null;
    if (kwMatch[2] !== undefined) {
      const bracketInner = kwMatch[2].slice(1); // drop the leading "["
      const parts = bracketInner.split(',');
      const query = parts[parts.length - 1].trim();
      return { kind: 'viewport', query, matchStart: cursorPos - query.length, matchEnd: cursorPos };
    }
    const query = kwMatch[1];
    return { kind: 'keyword', query, matchStart: cursorPos - query.length, matchEnd: cursorPos };
  }

  // Stage 2: after "graphics" (+ optional closed "[...]") + ":" — typing
  // shorthand name(s), comma-separated, each optionally "+"/"-" prefixed
  // (delta mode, see caption-processor.js).
  const valMatch = inner.match(/^\s*graphics(?:\[[^\]]*\])?\s*:\s*(.*)$/i);
  if (!valMatch) return null;
  const parts = valMatch[1].split(',');
  const last = parts[parts.length - 1];
  const prefixMatch = last.match(/^(\s*[+-]?)(.*)$/);
  const query = prefixMatch[2];
  return { kind: 'value', query, matchStart: cursorPos - query.length, matchEnd: cursorPos };
}

/**
 * @param {{kind, query}} context — from getMetacodeContext()
 * @param {{ shorthands?: string[], viewports?: string[] }} sources
 * @returns {Array<{ label: string, insertText: string }>}
 */
export function getMetacodeOptions(context, { shorthands = [], viewports = [] } = {}) {
  if (!context) return [];
  const q = context.query.toLowerCase();

  if (context.kind === 'keyword') {
    return KEYWORD_OPTIONS
      .filter(o => o.name.toLowerCase().startsWith(q))
      .map(o => ({ label: o.name === 'graphics[' ? 'graphics[viewport]: — target specific viewport(s)' : 'graphics: — all viewports', insertText: o.insertText }));
  }

  if (context.kind === 'viewport') {
    const names = [...new Set([...LANDSCAPE_ALIASES, ...viewports])];
    return names
      .filter(n => n.toLowerCase().startsWith(q))
      .map(n => ({ label: n, insertText: n }));
  }

  // 'value'
  return shorthands
    .filter(n => n.toLowerCase().startsWith(q))
    .map(n => ({ label: n, insertText: n }));
}

/**
 * Replaces the matched token with `insertText`, returning the new full text
 * and the cursor position right after the inserted text.
 * @param {string} text
 * @param {{matchStart, matchEnd}} context
 * @param {string} insertText
 * @returns {{ text: string, cursorPos: number }}
 */
export function applyMetacodeSuggestion(text, context, insertText) {
  const newText = text.slice(0, context.matchStart) + insertText + text.slice(context.matchEnd);
  return { text: newText, cursorPos: context.matchStart + insertText.length };
}
