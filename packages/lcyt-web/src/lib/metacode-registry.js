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
//   kind:    'action' | 'variable' | 'block'  — what assigning the name does
//   lexer:   'dedicated'                       — parsed by its own regex earlier
//                                                (cue/api); the generic loop skips it
//   boolean: true                              — value coerced to a boolean
//   apply(value, actions)                      — action one-shots: write the
//                                                parsed result into `actions`
//   emitsTopic                                 — event-bus topic on assignment
//                                                (declared now, wired when the bus lands)

import { parseDuration } from './metacode-ttl.js';

export const RESERVED_METACODES = {
  // --- Action one-shots (no persisted value; drained by the runtime) ---
  audio: {
    kind: 'action',
    emitsTopic: 'session.mic_state',
    apply: (value, actions) => {
      if (value === 'start' || value === 'stop') actions.audioCapture = value;
    },
  },
  timer: {
    kind: 'action',
    // Bare number = seconds (back-compat) or explicit ms/s/m; stored in seconds
    // since the runtime multiplies by 1000. Shares parseDuration with the TTL grammar.
    apply: (value, actions) => {
      const ms = parseDuration(value, { defaultUnit: 's' });
      if (ms != null) actions.timer = ms / 1000;
    },
  },
  goto: {
    kind: 'action',
    apply: (value, actions) => {
      const lineN = parseInt(value, 10);
      if (!isNaN(lineN) && lineN > 0) actions.goto = lineN;
    },
  },
  file: {
    kind: 'action',
    apply: (value, actions) => {
      if (value !== '') actions.fileSwitch = value;
    },
  },
  'file[server]': {
    kind: 'action',
    apply: (value, actions) => {
      if (value !== '') actions.fileSwitchServer = value;
    },
  },

  // --- Dedicated-lexer codes (parsed by their own regex before the generic
  //     loop; listed here so the taxonomy is complete and the loop skips them) ---
  cue: { kind: 'action', lexer: 'dedicated', emitsTopic: 'cue.fired' },
  api: { kind: 'action', lexer: 'dedicated', emitsTopic: 'variable.updated' },

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
