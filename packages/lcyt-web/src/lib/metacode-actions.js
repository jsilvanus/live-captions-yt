// Named / composite action parsing + expansion + apply.
// See docs/plans/plan_named_actions.md.
//
// A named action is a bundle of metacode "atoms" run together as a one-shot at
// send. A composite is a `|`-separated ORDERED sequence ("then / also run", NOT
// boolean OR like cues). Each item is either a named reference `@name` or an
// atom `metacode:value`.

import { parseValueTtl } from './metacode-ttl.js';

/**
 * Parse a composite action expression into an ordered item list.
 * `@name` → { ref: 'name' }; `metacode:value` → { metacode, value }.
 * Splits on `|`; each atom splits on its first `:` (so values keep later colons,
 * e.g. `section:Prayer => 20s:Hymn`).
 *
 * @param {string} expr
 * @returns {Array<{ ref: string } | { metacode: string, value: string }>}
 */
export function parseActionItems(expr) {
  const raw = String(expr ?? '').trim();
  if (!raw) return [];
  const items = [];
  for (const part of raw.split('|')) {
    const p = part.trim();
    if (!p) continue;
    if (p.startsWith('@')) {
      const ref = p.slice(1).trim();
      if (ref) items.push({ ref });
      continue;
    }
    const colon = p.indexOf(':');
    if (colon <= 0) continue; // not a valid atom (no metacode key)
    const metacode = p.slice(0, colon).trim().toLowerCase();
    const value = p.slice(colon + 1).trim();
    if (metacode) items.push({ metacode, value });
  }
  return items;
}

/**
 * Expand an action item list into a flat, ordered list of atoms
 * (`{ metacode, value }`), resolving `@name` refs against a def lookup with a
 * visited-set cycle guard (nesting allowed; a cycle drops the offending ref).
 *
 * @param {Array} items — from parseActionItems
 * @param {(name: string) => Array|null} resolveDef — returns a def's item list, or null
 * @param {(msg: string) => void} [onWarn]
 * @returns {Array<{ metacode: string, value: string }>}
 */
const API_ATOM_KEYS = new Set(['api', '!api', 'api!']);
// Pointer-fired / unsupported atoms inside a send-fired named action (v1): a
// send-tier macro doesn't run pointer navigation or (re)schedule timers.
const SKIP_ATOM_KEYS = new Set(['goto', 'file', 'file[server]', 'timer', 'cue']);

/**
 * Route a flat, expanded atom list to side-effect handlers, classifying by
 * metacode. Persistent atoms (section/graphics/custom/…) → `setCode(name, value,
 * ttl)` (the `=>` TTL is parsed off); `api:`/`!api:`/`api!:` → `refreshApi`;
 * `audio:` → `audio`. Pointer/navigation atoms are skipped in v1 (`onWarn`).
 * Returns a summary (also useful for tests).
 *
 * @param {Array<{ metacode: string, value: string }>} atoms
 * @param {object} handlers
 */
export function applyAtoms(atoms, handlers = {}) {
  const summary = { codes: {}, api: [], audio: [], skipped: [] };
  for (const { metacode, value } of atoms || []) {
    if (API_ATOM_KEYS.has(metacode)) {
      const dot = String(value ?? '').indexOf('.');
      if (dot > 0 && dot < value.length - 1) {
        const t = { connectorSlug: value.slice(0, dot), requestSlug: value.slice(dot + 1) };
        summary.api.push(t);
        handlers.refreshApi?.(t.connectorSlug, t.requestSlug);
      } else {
        summary.skipped.push({ metacode, value, reason: 'bad api ref' });
        handlers.onWarn?.(`action atom "api:${value}" needs connector.request`);
      }
      continue;
    }
    if (metacode === 'audio') {
      if (value === 'start' || value === 'stop') { summary.audio.push(value); handlers.audio?.(value); }
      else { summary.skipped.push({ metacode, value, reason: 'bad audio value' }); }
      continue;
    }
    if (SKIP_ATOM_KEYS.has(metacode)) {
      summary.skipped.push({ metacode, value, reason: 'pointer/navigation atom not run in a send action (v1)' });
      handlers.onWarn?.(`action atom "${metacode}" is not supported in a send-fired action (v1)`);
      continue;
    }
    // Persistent variable / graphics / section / custom assignment: parse any
    // `=>` TTL off the value and hand to setCode.
    const { value: clean, ttl } = parseValueTtl(value);
    summary.codes[metacode] = clean;
    handlers.setCode?.(metacode, clean, ttl);
  }
  return summary;
}

export function expandActionItems(items, resolveDef, onWarn) {
  const out = [];
  const visit = (list, seen) => {
    for (const item of list || []) {
      if (item.ref) {
        if (seen.has(item.ref)) {
          onWarn?.(`named action cycle detected at "@${item.ref}" — skipping`);
          continue;
        }
        const def = resolveDef(item.ref);
        if (!def) {
          onWarn?.(`unknown named action "@${item.ref}"`);
          continue;
        }
        visit(def, new Set(seen).add(item.ref));
      } else if (item.metacode) {
        out.push({ metacode: item.metacode, value: item.value });
      }
    }
  };
  visit(items, new Set());
  return out;
}
