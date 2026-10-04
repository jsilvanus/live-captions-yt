# `packages/plugins/lcyt-actions` — Named Actions Plugin (v0.1.0)

Project-scoped `@name` **composite action macros** — the imperative sibling of the cue system's declarative matchers. A named action is a reusable bundle of metacode "atoms" (`audio:`/`timer:`/`goto:`/`file:`/`api:`/`graphics:`/variable assignments) run together as a one-shot at **send**. Implements `docs/plans/plan_named_actions.md`. Imported by `lcyt-backend` as `lcyt-actions`.

**Main entry:** `src/api.js`
**Usage in lcyt-backend:**
```js
import { initActions, createActionsRouter, createActionExecutor } from 'lcyt-actions';
initActions(db);                                 // runs the action_defs migration
const executor = createActionExecutor({ db, eventBus, handlers });  // see executor.js
app.use('/actions', createActionsRouter(db, projectAuth, { executor, checkProjectRole }));
```

**Storage plus a server-side runner.** Parsing and `@`-ref expansion (with cycle guard) are shared pure code in `lcyt/actions` (`packages/lcyt/src/actions.js`; `lcyt-web/src/lib/metacode-actions.js` re-exports it). The web client still runs actions at send time (`applyAtoms`), via the parser (`action:`/`action-def:` → `lineCodes.actions` + returned `actionDefs`), and `InputBar`. The stored `definition` is the raw composite expression string (e.g. `audio:start | graphics:+banner | @other`); the client parses it on read.

**Source (`src/`):**
- `db.js` — `runActionsMigrations` (`action_defs` table: `id`, `api_key`, `name`, `slug` `UNIQUE(api_key,slug)`, `definition`, `description`, timestamps) + CRUD helpers + `serializeActionDef`.
- `routes/actions.js` — `createActionsRouter(db, auth)`: `GET/POST/GET:slug/PUT:slug/DELETE:slug /actions`. Slug validated (lowercase/hyphen), duplicate-slug 409, `requireApiKey` project scoping.
- `routes/helpers.js` — `requireApiKey` (reads `req.session.apiKey`, duplicated from lcyt-connectors to avoid a dependency cycle) + `isValidSlug`.

**Server runner (`src/executor.js`, `docs/plans/plan_backend_actions.md`):** `createActionExecutor({ db, eventBus, handlers, stepTimeoutMs })` → `run(apiKey, { ref | expr }, { source, stopOnError, skipDevices, causation })` → `{ ok, runId, steps[], clientAtoms[], warnings[], durationMs }`. The plugin is generic: `handlers` maps an atom key to `async (apiKey, value, meta) => { ok, error?, code? }` or `{ run, device: true }`; `server.js` registers `camera` / `mixer` (via `ProductionCommands.runCameraAtom/runMixerAtom`, addressed by label slug or id), `crop` (preset id) and `api` (connector `fireRequest`). `wait:2s|500ms` is built in (max 30 s). Atoms with no server handler (`audio`, `section`, variables, …) are returned in `clientAtoms`, never dropped. Steps run in order with a per-step timeout (default 15 s); a failed step does not stop the run unless `stopOnError`. `skipDevices` reports `device: true` steps as `skipped` (`reason: 'disarmed'`). Bus events: `action.started`, `action.step` (one per atom), `action.completed` / `action.failed` (audited via `action.*`). The `graphics:` server atom is not implemented yet.

**API routes:** `GET/POST /actions`, `GET/PUT/DELETE /actions/:slug` (project auth); `POST /actions/run { ref? | expr?, stopOnError? }` (registered before `/:slug`; user callers need the `production` tier through the injected `checkProjectRole`, session/device callers pass like the DSK activate routes; 400/404 for bad or unknown input, 503 without an executor). Also exposed as the `action.run` tool (lcyt-tools).

**Tests:** `test/actions.test.js` — db round-trip + real-express CRUD (create/list/get/update/delete, name+slug validation, duplicate 409, project scoping). 4 tests. `test/executor.test.js` — wait parsing, ordering, client atoms, nested/cyclic/unknown refs, project scoping, continue vs `stopOnError`, `skipDevices`, handler throw and timeout, bus events; plus `POST /actions/run` route tests in `actions.test.js`.
