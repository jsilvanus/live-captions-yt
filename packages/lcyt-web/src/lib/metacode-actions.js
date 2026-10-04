// Named / composite action parsing + expansion + apply.
// See docs/plans/plan_named_actions.md.
//
// A named action is a bundle of metacode "atoms" run together as a one-shot at
// send. A composite is a `|`-separated ORDERED sequence ("then / also run", NOT
// boolean OR like cues). Each item is either a named reference `@name` or an
// atom `metacode:value`.

import { parseValueTtl } from './metacode-ttl.js';

// Parsing and @-ref expansion live in the core package so the backend action
// runner (lcyt-actions) reads definitions exactly like the browser does.
import { parseActionItems, expandActionItems } from 'lcyt/actions';
export { parseActionItems, expandActionItems };

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

