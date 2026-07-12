// Named / composite action parsing + expansion.
// See docs/plans/plan_named_actions.md.
//
// A named action is a bundle of metacode "atoms" run together as a one-shot at
// send. A composite is a `|`-separated ORDERED sequence ("then / also run", NOT
// boolean OR like cues). Each item is either a named reference `@name` or an
// atom `metacode:value`.

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
