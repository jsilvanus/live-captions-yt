---
id: plan/named_actions
title: "Named Actions — @name Composite Action Macros (backend registry + Assets UI)"
status: draft
summary: "Named, composite action macros — the imperative sibling of the cue system's declarative named/composite matchers. A named action is a reusable bundle of metacode 'atoms' (audio/timer/goto/file/api/graphics/variable assignments) run together as a one-shot at send. Syntax mirrors cues: invoke `<!-- action: @intro -->`, inline composite `<!-- action: audio:start | graphics:+banner | section:Intro -->` (| = ordered 'then', NOT boolean), inline definition `<!-- action-def: intro: … -->`. Atoms dispatch through the Phase-3 reserved-name registry. Decisions: fire on SEND; nesting allowed with a cycle guard; NO conditionals in v1 (future `when:` guards noted); backend `action_defs` table + `/actions` CRUD + an Assets-page editor from the start; the registry's action taxonomy is refined so timer/audio/goto/file are tagged pointer-fired vs. named actions send-fired."
related: plan/metacode_variable_unification, plan/cues, plan/api_connectors_variables, plan/dsk, plan/dashboard_console_redesign
---

# Named Actions — `@name` Composite Action Macros

## Concept

A **named action** is a reusable, named bundle of one or more metacode **atoms**
run together as a one-shot. It is the **imperative** sibling of the cue system's
**declarative** named/composite matchers: cues decide *whether* to fire; actions
decide *what to run*.

This slots directly onto the Phase-3 reserved-name registry
(`metacode-registry.js`): an atom is an ordinary metacode, so a named action is
literally "apply these metacodes," dispatched through the same registry handlers.

**Three-sigil model** this completes:

| Sigil | Role | Example |
|---|---|---|
| `{{ name }}` | **read** a variable value | `Now: {{viewers}}` |
| `@name` | **invoke** a named action | `<!-- action: @intro -->` |
| `key: value` | **assign / act** (a metacode) | `<!-- section: Intro -->` |

## Syntax (mirrors cues)

```
<!-- action: @intro -->                                   invoke a named action
<!-- action: audio:start | graphics:+banner | section:Intro -->   inline composite
<!-- action: @intro | api:cam.preset1 -->                 named + an extra atom
<!-- action-def: intro: audio:start | graphics:+banner --> inline definition (parallels cue-def)
```

- **`|` means "then / also run"** — an **ordered sequence**, NOT boolean OR. This
  is the key difference from cues: `|+`/`|-` (AND/NOT) do **not** apply to actions.
  Flag this in docs so `|` doesn't mislead.
- **`@name`** is a named reference, exactly like cues' `@named`. Since it lives in
  `action:` (vs `cue:`), there is no collision — `@` uniformly means "named ref".
- **Atoms** are ordinary metacodes: `audio:`, `timer:`, `goto:`, `file:`,
  `file[server]:`, `api:`/`!api:`/`api!:`, `graphics:`/`graphics[vp]:`, and
  variable assignments (`section:Intro`, including `=>` TTL). Each atom runs
  through its existing registry handler / runtime path.

## Semantics — DECIDED

- **Composite = ordered sequence** of atoms, executed in order. (No conditionals
  in v1 — see Future.)
- **Fire on SEND.** A named action runs at the instant the line is sent, alongside
  that line's own inline codes — one call site in `InputBar.doSend()`. (Not on
  pointer arrival; see the registry taxonomy note below for why that distinction
  now matters.)
- **Nesting allowed.** An action definition may reference other `@actions`;
  expansion carries a **visited-set cycle guard** — a cycle drops the offending
  ref with a console warning rather than looping.
- **No conditionals (v1).** `when:section=Intro -> audio:start`-style guards are a
  **future** idea (they reintroduce cue-style matching *inside* an action) —
  noted, not built.

## Registry taxonomy refinement (the `timer` "kind" fix)

Phase 3's `RESERVED_METACODES` marks `timer`/`audio`/`goto`/`file`/`file[server]`
as `kind: 'action'` — but those fire on **pointer arrival** (drained by
`drainActions` in `metacode-runtime.js`), whereas a named `action:` fires on
**send**. Conflating both under `kind: 'action'` is now wrong.

**Change:** add a fire-timing dimension to action entries:

| Name(s) | classification |
|---|---|
| `timer`, `audio`, `goto`, `file`, `file[server]` | `kind: 'action', fires: 'pointer'` |
| `action` (new) | `kind: 'action', fires: 'send'` |
| `action-def` (new) | `kind: 'definition'` (registers, never fires) |
| `cue` | matcher (unchanged; `lexer: 'dedicated'`) |
| `api` | tiered — pointer/send/prefetch per its own `apiTriggers` (unchanged) |

`fires` is orthogonal to `kind`, so it's additive and behavior-preserving for the
existing pointer-fired one-shots; it just makes the timing explicit and lets the
named-action executor know it runs in the send path.

## Backend — `action_defs` table + `/actions` CRUD

Project-scoped (`api_key`), parallel to `cue_rules` / `api_connectors`:

```sql
CREATE TABLE IF NOT EXISTS action_defs (
  id          TEXT PRIMARY KEY,
  api_key     TEXT NOT NULL,
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL,          -- @-addressable; unique per api_key
  definition  TEXT NOT NULL,          -- the composite expression string (or parsed atom-list JSON)
  description TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (api_key, slug)
);
```

- **Routes:** `GET/POST/PUT/DELETE /actions[/:slug]` — project auth (same as
  `/variables`). CRUD only; execution is client-side (below).
- **Ownership:** a new `lcyt-actions` plugin (schema, CRUD, an expand/parse
  helper) parallel to `lcyt-connectors`/`lcyt-cues` — **open decision** vs.
  folding into `lcyt-cues` (both are trigger/behaviour systems). Recommend a new
  plugin for a clean seam.

## Execution model (client-side at send)

Atoms span **frontend-runtime** actions (`goto`/`file`/`audio`) and
**backend-effecting** ones (`api`/`graphics`/variable writes), so a named action
executes on the **client at send**, reusing every existing mechanism rather than
inventing a new engine:

1. `useActions()` hook fetches defs (`GET /actions`) + subscribes to changes,
   exactly like `useVariables`/connectors.
2. The parser turns `<!-- action: … -->` into a structured `actions` entry on
   `lineCodes` (dedicated lexer, like `cue`/`api`); `action-def` registers a
   file-local named def (parallel to `cue-def` / `CUE_DEF_RE`).
3. `InputBar.doSend()`, on a line carrying `actions`, **expands** each `@name`
   (from file-local defs then the `/actions` store, with the cycle guard) into a
   flat ordered atom list, then applies each atom through the path it already
   uses for that metacode: `goto`/`file`/`audio` via `metacode-runtime`, `api:`
   via `variables.refresh`, `section:`/`graphics:` via the merged `codes`
   payload / `writeFileCode`.

## UI — Named Actions editor on the Assets page

A Named Actions manager on `/assets` (`AssetsPage`), from the start:
- list / create / edit / delete named actions;
- a **composite builder**: pick atoms (audio/timer/goto/file/api/graphics/
  variable), order them, and reference other `@actions`;
- parallels the planned cue-rules editor UI.

`/assets` is the cross-content library view (`plan_dashboard_console_redesign.md`)
— named actions are a natural asset kind to surface there.

## Implementation status

- **Done:** registry `fires` taxonomy + `action`/`action-def` entries; parser
  (`ACTION_DEF_RE`/`ACTION_RE` → `lineCodes.actions` + returned `actionDefs`);
  `metacode-actions.js` (`parseActionItems`/`expandActionItems` cycle guard/
  `applyAtoms`); `lcyt-actions` backend plugin (`action_defs` + `/actions` CRUD,
  wired into `lcyt-backend`); `useActions` hook; `useFileStore` surfaces
  `actionDefs`; `InputBar` send-time expand-and-apply; `NamedActionsManager` CRUD
  UI on the Assets page. Tests: lcyt-web node 391 + vitest 371, lcyt-actions 4.
- **v1 scope / follow-ons:** send-fired actions apply **persistent/variable/
  graphics atoms** (→ codes + durable variables), **`api:`** (→ connector
  refresh), and **`audio:`**; **pointer/navigation atoms** (`goto`/`file`/
  `timer`) are parsed but **skipped with a warning** inside a send action (they'd
  need post-send sequencing). `graphics:` atoms merge into `codes` (best-effort;
  whether that drives the DSK pipeline the same as an in-text `graphics` metacode
  is unverified). The Assets editor uses a definition textarea, not yet a visual
  atom builder. Conditionals remain a future idea (below).

## Effort estimate

- `lcyt-actions` plugin: schema + CRUD + expand/parse helper (small-medium,
  mirrors `lcyt-connectors`' shape).
- Registry: `fires` field + `action`/`action-def` entries; parser dedicated
  lexer for `action:`/`action-def:` → `lineCodes.actions` (small-medium — mirrors
  the `cue`/`api` parsing).
- Frontend: `useActions` hook; `doSend` expand-and-apply (medium — the one real
  new runtime seam; reuses existing atom paths).
- Assets-page editor (medium-large — real UI, same caveat every sibling plan
  makes about frontend scope).

## Future ideas (noted, not built)

- **Conditional guards** — `when:<cue-expression> -> <atom>` inside an action,
  reusing the cue matcher grammar for imperative guards. The main reason a
  composite might one day want cue-style boolean logic back.
- **Parallel atoms** (vs the v1 ordered sequence); **error handling** if an atom
  fails mid-sequence (v1: best-effort continue + log).
- **Pointer-fired named actions** (v1 is send-only); the `fires` dimension already
  makes this expressible later.

## Index Entry

Add to `docs/PLANS.md`'s Draft table:

```
| [plan_named_actions.md](plans/plan_named_actions.md) | Named Actions — @name Composite Action Macros | Named/composite action macros (imperative sibling of cues): a named action is a bundle of metacode atoms (audio/timer/goto/file/api/graphics/variable) run together as a one-shot at send. Invoke `@name`, inline composite with `|` (ordered "then", not boolean), inline `action-def`, dispatched through the Phase-3 registry. Decisions: fire on send; nesting + cycle guard; no conditionals in v1 (future `when:` guards); backend `action_defs` table + `/actions` CRUD + an Assets-page editor from the start; registry action taxonomy refined (timer/audio/goto/file = pointer-fired vs named actions = send-fired). | |
```
