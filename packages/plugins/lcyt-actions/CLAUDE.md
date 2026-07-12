# `packages/plugins/lcyt-actions` — Named Actions Plugin (v0.1.0)

Project-scoped `@name` **composite action macros** — the imperative sibling of the cue system's declarative matchers. A named action is a reusable bundle of metacode "atoms" (`audio:`/`timer:`/`goto:`/`file:`/`api:`/`graphics:`/variable assignments) run together as a one-shot at **send**. Implements `docs/plans/plan_named_actions.md`. Imported by `lcyt-backend` as `lcyt-actions`.

**Main entry:** `src/api.js`
**Usage in lcyt-backend:**
```js
import { initActions, createActionsRouter } from 'lcyt-actions';
initActions(db);                                 // runs the action_defs migration
app.use('/actions', createActionsRouter(db, projectAuth));
```

**This plugin is pure storage.** Parsing, `@`-ref expansion (with cycle guard), and send-time execution all live in the web client — `packages/lcyt-web/src/lib/metacode-actions.js` (`parseActionItems`/`expandActionItems`), the parser (`action:`/`action-def:` → `lineCodes.actions` + returned `actionDefs`), and `InputBar`. The stored `definition` is the raw composite expression string (e.g. `audio:start | graphics:+banner | @other`); the client parses it on read.

**Source (`src/`):**
- `db.js` — `runActionsMigrations` (`action_defs` table: `id`, `api_key`, `name`, `slug` `UNIQUE(api_key,slug)`, `definition`, `description`, timestamps) + CRUD helpers + `serializeActionDef`.
- `routes/actions.js` — `createActionsRouter(db, auth)`: `GET/POST/GET:slug/PUT:slug/DELETE:slug /actions`. Slug validated (lowercase/hyphen), duplicate-slug 409, `requireApiKey` project scoping.
- `routes/helpers.js` — `requireApiKey` (reads `req.session.apiKey`, duplicated from lcyt-connectors to avoid a dependency cycle) + `isValidSlug`.

**API routes:** `GET/POST /actions`, `GET/PUT/DELETE /actions/:slug` (project auth).

**Tests:** `test/actions.test.js` — db round-trip + real-express CRUD (create/list/get/update/delete, name+slug validation, duplicate 409, project scoping). 4 tests.
