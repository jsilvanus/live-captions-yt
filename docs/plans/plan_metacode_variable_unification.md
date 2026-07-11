---
id: plan/metacode_variable_unification
title: "Metacode ↔ Variable Unification — One Namespace, a Reserved-Name Registry, Event-Bus-Coherent Names"
status: draft
summary: "Reframes every metacode `<!-- name: value -->` as a write into a single per-project variable namespace, governed by one explicit reserved-name registry: plain names are variable assignments (readable via `{{name}}`, watched by downstream consumers, emitted as `variable.updated`), reserved names are actionable (fire a side effect via a handler, may also carry state). Replaces the current scattered `if (key === 'audio')` / dedicated-regex handling in `metacode-parser.js` with a registry-driven dispatch, and makes *metacode name ≈ variable name ≈ event-bus domain* one coherent vocabulary. Reconciles the three existing plans: extends `plan_api_connectors_variables.md`'s partial (snapshot-merge) unification into a true single namespace, gives `plan_pubsub_event_bus.md`'s topic taxonomy an explicit source (the registry's `emitsTopic`), and folds `plan_metacode_refactor.md`'s mechanical file moves into building the registry rather than relocating the scattered handling as-is. One product decision is left open and flagged: how deeply plain file-metacode assignments persist (full DB namespace vs. session-scoped vs. keep-additive)."
related: plan/api_connectors_variables, plan/pubsub_event_bus, plan/metacode_refactor, plan/cues, plan/dsk, plan/authentication_refactor
---

# Metacode ↔ Variable Unification

## Why this plan exists

Three plans already touch this area, but none states the organizing idea:

> **A metacode `<!-- name: value -->` is a variable assignment. Most names are plain
> variables. Some names are reserved and actionable.**

`plan_api_connectors_variables.md` gets closest — its §5 says "codes and variables are the
same concept" — but it unifies only at the **send-time snapshot merge**
(`{ ...resolvedVariables, ...lineCodes }`), not as one namespace, and it treats
`api:`/`!api:`/`api!:` as a bespoke actionable family rather than one entry in a general
reserved-name scheme. `plan_pubsub_event_bus.md` defines a clean `<domain>.<event>` topic
taxonomy but never connects it to a metacode/variable vocabulary. `plan_metacode_refactor.md`
is a pure file-relocation that *preserves* the scattered per-key handling.

This plan makes the model explicit and reconciles the three. It is a **design/architecture**
plan — the connectors and event-bus features already ship; this is about the spine that ties
them together, and about not refactoring the parser twice.

## Current reality (what the code does today)

`packages/lcyt-web/src/lib/metacode-parser.js` already splits metacodes into exactly the two
shapes the vision describes — but implicitly, via hardcoded key checks and per-family regexes:

| Family | Names | Handling today | Persists? |
|---|---|---|---|
| Plain / persistent | `lang`, `no-translate`, `section`, `speaker`, `lyrics`, `explanation`, **any custom key** | `currentCodes[key] = value` (fallthrough `else` branch) | Yes, line-to-line until re-set or cleared with empty value |
| Action (one-shot) | `audio`→`audioCapture`, `timer`, `goto`, `file`→`fileSwitch`, `file[server]`→`fileSwitchServer` | Special-cased `if (key === …)` branches; drained by `metacode-runtime.js`'s `drainActions()` | No — fires once when the pointer reaches the line, then consumed |
| Inline marker | `cue`, `cue*`, `cue**`, `cue~`, `cue[semantic]`, `cue[events]`, `cue-def` | Dedicated `CUE_META_RE` / `CUE_DEF_RE` | Registers a trigger; not a stored value |
| API trigger | `!api:`, `api:`, `api!:` | Dedicated `API_TRIGGER_RE` → `lineCodes[i].apiTriggers` | No — fires a connector request |
| Plugin in-text | `graphics`, `graphics[viewport]` | Owned by `lcyt-dsk/src/caption-processor.js` (backend), stateful per viewport with `+`/`-` deltas | Stateful (DSK-side) |
| Block | `stanza` (multi-line + inline forms) | Special-cased; sets `currentCodes.stanza` | Yes |
| Special marker | `_` (empty-send), `_ label` | `EMPTY_SEND_RE` | No |

Separately, `lcyt-connectors` owns the **variable namespace** proper: `{{name}}` reads,
`GET /variables` snapshot, `variable_updated` SSE, `source: manual | connector`, and a
reserved `_`-prefix for system/computed variables (rejected on user write).

Two "reserved" ideas already coexist and must be kept distinct:
- **Reserved-actionable names** (`audio`, `cue`, `api`, `graphics`, …) — the subject of this plan.
- **Reserved `_`-prefix** for system variables (`_seq`, `_now`, …) — a *value* namespace guard,
  orthogonal to actionability.

## The model

### One namespace

Per project there is **one variable namespace**. Every writer targets it:

- a **file metacode** `<!-- section: Chorus -->`,
- a **manual set** via `ActionsPanel` / `QuickActionsPopover`,
- a **connector** response mapping.

They differ only by `source` and lifetime, not by which store they land in. A reader
(`{{name}}`, the DSK `bindings` payload, `CueEngine`'s `section` rule, the event bus) sees one
merged current value, regardless of who wrote it.

### The reserved-name registry (the spine)

A single registry replaces every scattered `if (key === …)` branch and per-family regex. Each
entry declares what a name *does* when assigned:

```
registry[name] = {
  kind:        'variable' | 'action' | 'stateful-action',
  parseValue:  (rawValue, modifier?) => parsed,   // e.g. boolean for lyrics/no-translate, number for timer
  persists:    boolean,                            // variable/stateful-action: true; action: false (one-shot)
  handler:     (ctx, parsed) => void,              // action & stateful-action side effect (fire connector, goto, graphics delta…)
  emitsTopic:  '<domain>.<event>' | null,          // event-bus topic on assignment (see event-bus reconciliation)
  modifier:    'bracket' | null,                   // parameterized names: file[server], graphics[viewport], cue[semantic]
  reservedVar: boolean,                            // may this name also be created as a manual variable? (reserved → no)
}
```

Dispatch becomes uniform: parse `name: value`, look up `name` (and any `[modifier]`), and:
- **not in registry** → plain variable assignment (`kind: 'variable'`), the default path.
- **`kind: 'variable'`** → same as above but with a declared `parseValue`/`emitsTopic`
  (`lang`, `no-translate`, `section`, `speaker`, `lyrics`, `explanation`, `stanza`).
- **`kind: 'action'`** → one-shot side effect, no stored value (`audio`, `timer`, `goto`,
  `file`, `file[server]`, `api`/`!api`/`api!`).
- **`kind: 'stateful-action'`** → side effect *and* state change (`graphics[…]`, `cue*`).

Key consequence: names like `section`/`speaker` stop being "special metadata" and become
*ordinary variables that other subsystems happen to watch*. DSK reading `section` and the cue
engine matching `section` are **subscribers to a variable**, not parser special cases. That is
the whole simplification the vision buys.

### Naming coherence: metacode name ≈ variable name ≈ event-bus domain

The registry's `emitsTopic` is the single source that makes the three vocabularies line up:

| Assignment | Registry `emitsTopic` | Event-bus plan's topic |
|---|---|---|
| any plain variable (`section`, custom, connector) | `variable.updated` | `variable.updated` ✅ already planned |
| `graphics[…]` | `dsk.graphics_changed` | `dsk.graphics_changed` ✅ |
| `cue…` fires | `cue.fired` | `cue.fired` ✅ |
| `audio: start/stop` | `session.mic_state` (or a new `audio.capture`) | `session.mic_state` ~ |

`plan_pubsub_event_bus.md` already lists these topics; this plan says **where they come from**
(the registry entry), so a new reserved name can't be added without also declaring its topic.

## How each existing plan measures up, and what changes

### `plan_api_connectors_variables.md` — extend, don't contradict
- **Keep:** `{{name}}` as a pure read; `api:`/`!api:`/`api!:` tiers; `_`-prefix reservation;
  `auth_config` server-side masking; the resolution engine and SSRF guard.
- **Change:** its §5 "unify the value source" becomes "unify the *namespace*." `api:` becomes
  one `kind: 'action'` registry entry (alongside `audio`/`goto`/…), not a bespoke regex. The
  additive merge (`{ ...resolvedVariables, ...lineCodes }`) is superseded by a single lookup
  — see the open decision below for how far that goes.

### `plan_pubsub_event_bus.md` — compatible, add the bridge
- **Keep:** the whole plan. Its blocker (`plan_authentication_refactor.md`) has **landed**
  (#252), so it is buildable now.
- **Change:** add one sentence to its topic-taxonomy section — topics are declared by the
  reserved-name registry's `emitsTopic`; plain variable assignment emits `variable.updated`.

### `plan_metacode_refactor.md` — fold in, don't run as-is
- Its mechanical moves (`metacode-parser.js`, a backend `caption-metacode.js`, runtime/planner
  splits) are still the right file layout — but the registry should be *built during* that move,
  not after. Running the refactor first and the registry later means touching the same code
  twice. Mark it **superseded-by / folded-into** this plan.

## The one open decision (product call, flagged not silently chosen)

How deeply does a **plain file-metacode assignment** persist? All three options share the
registry spine above; they differ only in where a plain name's value lives.

| Option | `{{section}}` reads a file-set `section`? | Shows in `GET /variables`? | Survives reload? | Cost |
|---|---|---|---|---|
| **A. Full DB namespace** | Yes | Yes | Yes | File metacodes gain a backend write path; positional/ephemeral semantics get muddier (a `section` on line 40 becomes global project state) |
| **B. Session-scoped** *(recommended)* | Yes (live) | Live-only (not stored) | No | Single namespace conceptually; live to `{{ }}` + event bus via the session snapshot; no DB write for positional codes |
| **C. Keep additive** | No | No | No | Smallest change; formalizes the registry taxonomy only; plain file codes stay ephemeral `lineCodes` as today |

**Recommendation: B.** It matches the reality that file metacodes are *positional* (a
`section` means "from here on in this file"), so persisting them to a durable project variable
row (A) overreaches — reopening the file would fight the stored value. B still delivers the
literal vision: one namespace, `{{name}}` and the event bus see file-set codes live, reserved
names are actionable — without turning every line-level code into permanent project state.
Manual (`ActionsPanel`) and connector variables remain durable (`source: manual|connector`),
because those *are* deliberate project state; file codes are session/pointer state. C is the
fallback if the appetite for change is minimal — it still buys the registry cleanup and naming
coherence, just not readability of file codes via `{{ }}`.

## Implementation sketch (once the decision above is fixed)

1. **Registry module** (frontend `packages/lcyt-web/src/lib/metacode-registry.js`; a matching
   backend descriptor if server-side dispatch needs it). Seed it from the current hardcoded
   set — no behavior change on day one.
2. **Parser rewrite** — `parseFileContent()` consults the registry instead of `if (key === …)`
   and the per-family regexes collapse into registry `modifier` handling (cue keeps its
   expression grammar as a `parseValue`). Compatibility re-exports stay per
   `plan_metacode_refactor.md`.
3. **Namespace wiring** — per the chosen option: session snapshot merge (B), DB write path (A),
   or none (C). `useVariables()` becomes the single read surface; `getActiveCodes()`
   (localStorage) is migrated onto it (this also finishes the connectors plan's own deferred
   `ActionsPanel`/`QuickActionsPopover` migration).
4. **Event-bus emit** — assignment publishes `registry[name].emitsTopic` (once
   `plan_pubsub_event_bus.md`'s `EventBus` exists; until then, keep the current per-bus emits).
5. **Validation** — reserved-actionable names can't be created as manual variables (registry
   `reservedVar`); `_`-prefix stays rejected (unchanged from connectors plan §8).
6. **Tests** — registry dispatch table (each `kind`), fallthrough-to-variable for unknown
   names, one-shot drain unchanged for `audio`/`timer`/`goto`/`file`, plain-code readability
   under the chosen option, and `docs/METACODE.md` regenerated from the registry as the single
   source of truth for the quick-reference table.

## Non-goals

- Not re-designing the connectors resolution engine, SSRF guard, or `{{ }}` interpolation —
  those stand as shipped.
- Not designing the event bus itself — that's `plan_pubsub_event_bus.md`; this plan only
  declares where its topic names originate.
- Not auth — `plan_authentication_refactor.md` (landed).

## Index entry

Add to `docs/PLANS.md`'s Draft table:

```
| [plan_metacode_variable_unification.md](plans/plan_metacode_variable_unification.md) | Metacode ↔ Variable Unification — One Namespace, Reserved-Name Registry | Reframes every metacode `<!-- name: value -->` as a write into one per-project variable namespace, governed by an explicit reserved-name registry (plain names = variable assignments readable via `{{ }}` and emitted as `variable.updated`; reserved names = actionable handlers, `audio`/`timer`/`goto`/`file`/`cue`/`api`/`graphics`). Replaces scattered `if (key === …)` parser branches with registry dispatch and makes metacode name ≈ variable name ≈ event-bus domain one vocabulary. Extends `plan_api_connectors_variables.md` §5's snapshot-merge into a true namespace, sources `plan_pubsub_event_bus.md`'s topics from the registry's `emitsTopic`, and folds `plan_metacode_refactor.md`'s file moves into building the registry. One open product call: plain file-code persistence depth (full DB / session-scoped [recommended] / keep-additive). | |
```
