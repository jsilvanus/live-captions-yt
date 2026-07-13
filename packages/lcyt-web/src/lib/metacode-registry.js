// Reserved-metacode registry — the single source of truth for which metacode
// names are reserved and what they do, replacing the scattered `if (key === …)`
// dispatch in metacode-parser.js.
//
// See docs/plans/plan_metacode_variable_unification.md ("The reserved-name
// registry"). The organizing model: a metacode `<!-- name: value -->` is a
// variable assignment; names listed here are *reserved* and behave specially,
// and every other name falls through to a plain variable assignment.
//
// Entry shape:
//   kind:    'action' | 'variable' | 'block' | 'definition'  — what the name does
//   fires:   'pointer' | 'send'                — for kind 'action', WHEN the
//                                                side effect runs: pointer-tier
//                                                one-shots (timer/audio/goto/file,
//                                                drained on pointer arrival) vs.
//                                                send-tier (named `action:` macros)
//   lexer:   'dedicated'                       — parsed by its own regex earlier
//                                                (cue/api/action); the generic loop skips it
//   boolean: true                              — value coerced to a boolean
//   apply(value, actions)                      — action one-shots: write the
//                                                parsed result into `actions`
//   emitsTopic                                 — event-bus topic on assignment
//                                                (declared now, wired when the bus lands)

import { parseDuration } from './metacode-ttl.js';

export const RESERVED_METACODES = {
  // --- Pointer-fired action one-shots (no persisted value; drained by the
  //     runtime when the pointer reaches the line) ---
  audio: {
    kind: 'action', fires: 'pointer',
    emitsTopic: 'session.mic_state',
    apply: (value, actions) => {
      if (value === 'start' || value === 'stop') actions.audioCapture = value;
    },
  },
  timer: {
    kind: 'action', fires: 'pointer',
    // Bare number = seconds (back-compat) or explicit ms/s/m; stored in seconds
    // since the runtime multiplies by 1000. Shares parseDuration with the TTL grammar.
    apply: (value, actions) => {
      const ms = parseDuration(value, { defaultUnit: 's' });
      if (ms != null) actions.timer = ms / 1000;
    },
  },
  goto: {
    kind: 'action', fires: 'pointer',
    apply: (value, actions) => {
      const lineN = parseInt(value, 10);
      if (!isNaN(lineN) && lineN > 0) actions.goto = lineN;
    },
  },
  file: {
    kind: 'action', fires: 'pointer',
    apply: (value, actions) => {
      if (value !== '') actions.fileSwitch = value;
    },
  },
  'file[server]': {
    kind: 'action', fires: 'pointer',
    apply: (value, actions) => {
      if (value !== '') actions.fileSwitchServer = value;
    },
  },

  // --- Dedicated-lexer codes (parsed by their own regex before the generic
  //     loop; listed here so the taxonomy is complete and the loop skips them) ---
  cue: { kind: 'action', lexer: 'dedicated', emitsTopic: 'cue.fired' },
  api: { kind: 'action', lexer: 'dedicated', emitsTopic: 'variable.updated' },
  // Named action macro — a bundle of atoms run together on SEND. See
  // plan_named_actions.md. Parsed by its own regex into lineCodes.actions.
  action: { kind: 'action', fires: 'send', lexer: 'dedicated', emitsTopic: 'action.fired' },
  'action-def': { kind: 'definition', lexer: 'dedicated' },

  // --- Persistent codes: ordinary variables that other subsystems happen to
  //     watch. Listed for documentation/validation; the parser treats any
  //     non-action, non-boolean name identically (assign into currentCodes). ---
  lang: { kind: 'variable' },
  section: { kind: 'variable', emitsTopic: 'variable.updated' },
  speaker: { kind: 'variable' },
  explanation: { kind: 'variable' },
  stanza: { kind: 'block' }, // pure-line form handled earlier; mixed form falls through as a variable
  lyrics: { kind: 'variable', boolean: true },
  'no-translate': { kind: 'variable', boolean: true },
};

/** Names whose values are coerced to booleans (derived from the registry). */
export const BOOLEAN_CODES = Object.entries(RESERVED_METACODES)
  .filter(([, e]) => e.boolean)
  .map(([name]) => name);

/**
 * Internal fields a parsed `codes` object can carry that are NOT persistent
 * variable assignments — action outputs, cue metadata, connector triggers, and
 * markers. Everything else on a `codes` object is a persistent variable.
 */
export const NON_PERSISTENT_CODE_KEYS = new Set([
  'audioCapture', 'timer', 'goto', 'fileSwitch', 'fileSwitchServer',
  'cue', 'cueMode', 'cueFuzzy', 'cueSemantic', 'cueEvents', 'cueTree',
  'apiTriggers', 'actions', 'emptySend', 'emptySendLabel', 'codeTtls',
]);

/**
 * Given a parsed `codes` object, return only the persistent variable
 * assignments (section/speaker/lyrics/lang/custom/…), dropping action outputs
 * and markers. Used by the send-time file→variables sync (namespace unification).
 */
export function extractPersistentCodes(codes) {
  const out = {};
  if (!codes) return out;
  for (const [k, v] of Object.entries(codes)) {
    if (!NON_PERSISTENT_CODE_KEYS.has(k)) out[k] = v;
  }
  return out;
}

/** Is `name` a reserved metacode of any kind? */
export function isReservedName(name) {
  return Object.prototype.hasOwnProperty.call(RESERVED_METACODES, String(name).toLowerCase());
}

/**
 * Is `name` a reserved *actionable* metacode (fires a side effect, no persisted
 * value)? Used to keep such names from being created as plain variables.
 */
export function isReservedActionable(name) {
  const e = RESERVED_METACODES[String(name).toLowerCase()];
  return !!e && e.kind === 'action';
}
