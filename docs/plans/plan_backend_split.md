---
id: plan/backend-split
title: "lcyt-backend Modularization & Plugin Extraction Assessment"
status: implemented
summary: "lcyt-backend modularization complete: lcyt-rtmp, lcyt-dsk, lcyt-production, lcyt-files, lcyt-cues, lcyt-agent, lcyt-music all extracted as workspace plugins. Internal refactoring done (route group factories, DB module split, metacode helper). lcyt-translate remains exploratory (see plan_translate_server.md)."
---

# lcyt-backend — Modularization Plan

## Summary

The backend is **already well-partitioned** for its scale. Three substantial plugins have been extracted (`lcyt-rtmp` ~5,700 LOC, `lcyt-production` ~3,300 LOC, `lcyt-dsk` ~2,300 LOC), leaving a ~5,200 LOC core that handles authentication, session management, caption delivery, and key/user administration. This document assesses what — if anything — should be extracted further, and why.

---

## Current State

### Size overview

| Component | LOC | Notes |
|---|---|---|
| `src/server.js` | 352 | App factory; wires everything together |
| `src/store.js` | 401 | In-memory session store |
| `src/index.js` | 72 | Entry point + graceful shutdown |
| `src/db/index.js` | 348 | Schema init + barrel re-export |
| `src/db/*.js` (12 files) | ~1,440 | Domain DB modules |
| `src/routes/*.js` (19 files) | ~3,150 | Route handlers |
| `src/middleware/*.js` (4 files) | 192 | CORS, auth, admin |
| `src/caption-files.js` | 112 | VTT composition |
| `src/backup.js` | 67 | DB backup utilities |
| **Core total** | **~5,200** | |
| Extracted plugins | ~11,200 | lcyt-rtmp + lcyt-dsk + lcyt-production |

### What was already extracted and why it worked

The three existing plugins share a common property: they are **operationally optional**. `lcyt-rtmp` needs `RTMP_RELAY_ACTIVE=1` to mount its routes. `lcyt-dsk` needs `GRAPHICS_ENABLED=1`. `lcyt-production` is unconditionally initialized but only useful if production hardware is configured. Each plugin:
- Has its own DB migrations
- Manages its own background services (ffmpeg, Playwright, TCP sockets)
- Can be initialized with a clean `init*(db, store)` / `createRouter*()` pattern
- Has no hard dependency on the session delivery path

This "optional heavy-lifting feature" profile is what made extraction clean and worthwhile.

---

## What Remains and How Coupled It Is

### The caption delivery core (do not extract)

Routes `/live`, `/captions`, `/events`, `/sync`, `/mic` form an inseparable unit. They all depend on `SessionStore` (`store.js`), share sequence tracking and send queue, and together implement the caption delivery contract. Splitting them into a plugin would gain nothing — they *are* the core product.

`store.js` itself is the session spine. Its DSK SSE subscription helpers are slightly out of place (graphics concerns in a session store), but extracting them would add more complexity than it removes.

### Route clusters that could become plugins — but probably shouldn't

Three clusters in the remaining codebase have reasonably clean boundaries:

#### A. User / project management

Files: `src/routes/auth.js` + `keys.js` + `project-members.js` + `project-features.js` + `device-roles.js` and their matching `src/db/` modules (~1,700 LOC combined).

These form a coherent "IAM" cluster. However:
- They are **always required** — a backend without auth is not usable.
- They are **tightly inter-dependent**: device-roles check project membership; project-features gate which routes are available; keys carry user ownership FKs. A plugin boundary here would require passing 4–5 DB modules across the boundary.
- Moving them to `packages/plugins/lcyt-authz` would add a package with no operational toggle and a larger import surface than what it replaces.

**Verdict: Keep in core. Refactor intra-file if individual files grow beyond ~400 LOC.**

#### B. Analytics (`/stats`, `/usage`, `/viewer`)

Files: `src/routes/stats.js`, `usage.js`, `viewer.js` and matching DB modules (~350 LOC).

These are read-only, DB-only routes with no shared services. They could move to `lcyt-analytics`, but the gain is marginal — each file is small, and they have no background services to manage.

**Verdict: Keep in core. No compelling reason to extract.**

#### C. Caption file management (`/file`)

Files: `src/routes/files.js`, `src/caption-files.js`, `src/db/files.js` (~320 LOC).

Self-contained filesystem + DB operations with no external dependencies. Same argument as analytics — small, no background services.

**Verdict: Keep in core.**

---

## What Would Actually Help: Internal Refactoring

The codebase does not suffer from a plugin-extraction problem. It suffers from **`server.js` being a 352-line wiring manifest** with 18 hard-coded route imports and sequential, order-dependent mounting. This is the correct place to invest.

### Recommendation 1: Route group factories

Group related route imports into logical namespaces that can be initialized together.

```js
// src/routes/session/index.js — exports createSessionRouters(db, store, jwtSecret, auth)
//   mounts: /live, /captions, /events, /sync, /mic
//   returns a single Express router

// src/routes/account/index.js — exports createAccountRouters(db, opts)
//   mounts: /auth, /keys, /keys/:key/features, /keys/:key/members, /keys/:key/device-roles
//   returns a single Express router

// src/routes/content/index.js — exports createContentRouters(db, auth, managers)
//   mounts: /file, /stats, /usage, /viewer, /video, /stt, /youtube
//   returns a single Express router
```

`server.js` then becomes:
```js
app.use(createSessionRouters(db, store, jwtSecret, auth));
app.use(createAccountRouters(db, opts));
app.use(createContentRouters(db, auth, { hlsManager, hlsSubsManager, sttManager }));
// ... plugins ...
```

This keeps all code in `lcyt-backend` (no new packages, no new `package.json`) but collapses `server.js` from ~30 route-mounting calls to ~5.

### Recommendation 2: DSK state out of SessionStore

`store.js` manages DSK (graphics) SSE subscriptions and graphics state via `addDskSubscriber`, `removeDskSubscriber`, `emitDskEvent`, `getDskGraphicsState`, `setDskGraphicsState` (~65 LOC). These are graphics concerns living in a session store. They exist there because the DSK plugin needs to reach into the session context to broadcast events.

A cleaner pattern: expose a narrow `EventBus` (or reuse Node's `EventEmitter`) that both `store.js` and `lcyt-dsk` can import, removing graphics state from the session object entirely.

This is a low-urgency refactor — it doesn't affect correctness — but it would make `store.js` easier to reason about.

### Recommendation 3: `src/db/index.js` — split schema from barrel

`src/db/index.js` does two things: defines all 17 table schemas (with migrations and backfill logic, 348 LOC) and re-exports all domain DB modules. These responsibilities could be separated into `src/db/schema.js` (schema + migrations only) and `src/db/index.js` (barrel re-export only). No functional change, just easier to navigate.

---

## New Plugin Extraction: When Would It Make Sense?

A new plugin is warranted when:
1. It has a meaningful operational toggle (can be disabled at deploy time).
2. It manages background services or external client lifecycles.
3. It introduces external dependencies that the core backend does not need.
4. It has a natural injection point — a seam where the core can call it without knowing its internals.

Based on current features, no remaining cluster met all four criteria in the initial assessment. Two subsequent discussions changed that: the potential move to S3 for file storage, and the gap in server-side translation for STT-originated captions.

---

## Candidate Plugin: `lcyt-files` — Caption File Storage

### Why the S3 migration changes the calculus

The original verdict ("keep in core, small, no background services") was correct for local-filesystem-only storage. S3 changes two of the four criteria:

**External dependency**: `@aws-sdk/client-s3` (~450 kB) is a substantial new dependency that `lcyt-backend` core does not otherwise need. Conditional `require()` at the call site is messy; a plugin with its own `package.json` keeps the dependency isolated.

**Operational toggle**: The storage mode becomes a meaningful deployment decision (`FILE_STORAGE=none|local|s3`), the same pattern that justified `lcyt-rtmp` (`RTMP_RELAY_ACTIVE=1`) and `lcyt-dsk` (`GRAPHICS_ENABLED=1`).

The other two criteria are also satisfied once S3 is in scope: S3 client initialization is a lifecycle concern (credentials, region, bucket config), and there is already a clean injection seam in `captions.js`.

### Current structure

| File | LOC | Role |
|---|---|---|
| `src/caption-files.js` | 112 | Write path: `writeToBackendFile`, VTT formatting, FS helpers |
| `src/routes/files.js` | 125 | Read path: list/download/delete routes |
| `src/db/files.js` | 80 | DB helpers: `registerCaptionFile`, `getCaptionFile`, `listCaptionFiles`, `deleteCaptionFile` |
| **Total** | **317** | |

The write path is called inline from `captions.js`:
```js
import { writeToBackendFile } from '../caption-files.js';
// inside the send queue, per caption:
writeToBackendFile({ apiKey, sessionId, lang, format, fileHandles }, text, timestamp, db);
```

### Proposed plugin design

**Package:** `packages/plugins/lcyt-files`

**Storage adapter interface** (duck-typed, no formal base class needed):
```js
// Both adapters expose the same 4 methods:
adapter.write(context, text, timestamp, db)   // appends one caption line
adapter.read(id, apiKey)                       // returns { stream, filename, contentType, size }
adapter.delete(id, apiKey)                     // removes from storage + DB
adapter.list(apiKey)                           // returns file rows from DB
```

**Adapters:**
- `src/adapters/local.js` — migrated from current `caption-files.js`; `FILES_DIR` env var
- `src/adapters/s3.js` — `@aws-sdk/client-s3`; `S3_BUCKET`, `S3_REGION`, `S3_PREFIX` env vars; keeps the same DB metadata rows, stores object keys instead of local paths

**Plugin entry (`src/api.js`):**
```js
export function initFileStorage(db, { mode = process.env.FILE_STORAGE || 'local' } = {})
// returns { adapter, createFileRouter }
```

**`server.js` changes:**
```js
import { initFileStorage } from 'lcyt-files';
const { adapter: fileStorage, createFileRouter } = initFileStorage(db);
// inject into captions router:
app.use(createSessionRouters(db, store, jwtSecret, auth, { relayManager, dskCaptionProcessor, fileStorage }));
// mount /file routes:
app.use('/file', createFileRouter(db, auth, store, jwtSecret));
```

**`captions.js` change (single injection point):**
```js
export function createCaptionsRouter(store, auth, db, relayManager, dskProcessor, fileStorage = null) {
  // ...
  if (fileStorage && backendFileEnabled) {
    fileStorage.write({ apiKey, sessionId, lang, format, fileHandles }, text, timestamp, db);
  }
```

**Env vars added by the plugin:**
| Variable | Purpose | Default |
|---|---|---|
| `FILE_STORAGE` | Storage backend: `local`, `s3`, `none` | `local` |
| `S3_BUCKET` | S3 bucket name | required when `FILE_STORAGE=s3` |
| `S3_REGION` | AWS region | `us-east-1` |
| `S3_PREFIX` | Key prefix for caption objects | `captions/` |
| `S3_ENDPOINT` | Custom endpoint (MinIO, R2, etc.) | AWS default |

### Migration path

1. Create plugin package, move existing local adapter code in.
2. Wire `FILE_STORAGE=local` as default — **zero behavioural change** for existing deployments.
3. Implement S3 adapter; test against MinIO locally.
4. Update CLAUDE.md to list new env vars.

**Verdict: Recommended when S3 migration is planned. No urgency until then — the existing local code works fine.**

---

## Candidate Plugin: `lcyt-translate` — Server-Side Translation

### Current state

Translation is **entirely client-side** today. The lcyt-web app:
1. Calls external vendor APIs directly from the browser (MyMemory, Google, DeepL, LibreTranslate) via `src/lib/translate.js`
2. Sends already-translated text in the `captions` payload: `{ text, translations: { 'fi-FI': '...' }, captionLang, showOriginal }`
3. The backend's `captions.js` is a pass-through — it writes the `translations` blob to files and forwards it to viewer/generic targets, but never produces translations itself

There is **no translation route, no translation DB table, no server-side vendor call** in the backend today.

### Why a server-side plugin would be valuable

**The STT gap.** When `SttManager` injects transcripts server-side (via `POST /stt/start`), those transcripts bypass the browser entirely. A Finnish speaker streams audio, Google STT transcribes in Finnish, the transcript goes straight into the send queue — but no English translation is ever sent, because the browser translation pipeline never ran. A `lcyt-translate` plugin closes this gap by translating transcripts before they reach the send queue.

**API key security.** Vendor API keys (DeepL, Google Cloud) currently live in browser `localStorage`. Moving translation server-side means API keys stay in environment variables.

**Consistency.** A generic-target consumer receiving captions currently gets translations only if the client was a browser with translation configured. Server-side translation makes the `translations` field consistent regardless of the caption source (browser, STT, MCP, CLI).

### Proposed plugin design

**Package:** `packages/plugins/lcyt-translate`

**Translation adapter interface:**
```js
// Each vendor adapter exposes one method:
adapter.translate(text, sourceLang, targetLang)  // → Promise<string>
```

**Adapters:**
- `src/adapters/mymemory.js` — free tier, no key required
- `src/adapters/google.js` — Google Cloud Translation v2 REST API
- `src/adapters/deepl.js` — DeepL REST API (free + pro)
- `src/adapters/libretranslate.js` — self-hosted LibreTranslate

**Per-key translation config** (new DB table `project_translations`):
```sql
CREATE TABLE project_translations (
  api_key      TEXT NOT NULL REFERENCES api_keys(key) ON DELETE CASCADE,
  target_lang  TEXT NOT NULL,       -- BCP-47
  enabled      INTEGER NOT NULL DEFAULT 1,
  show_original INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (api_key, target_lang)
);
```

**Plugin entry (`src/api.js`):**
```js
export function initTranslate(db, { vendor, apiKey, libreUrl } = {})
// returns { translate, createTranslateRouter }
// translate(apiKey, text, sourceLang) → Promise<{ [lang]: string }>
//   reads per-key target list from DB, calls adapter for each enabled target
```

**Routes added by plugin:**
```
GET  /translate/config         — get per-key translation settings (Bearer token)
PUT  /translate/config         — update per-key translation settings (Bearer token)
POST /translate/test           — test translation for a given text + lang (Bearer token)
```

**Injection into `captions.js` (single point):**
```js
export function createCaptionsRouter(store, auth, db, relayManager, dskProcessor, fileStorage = null, translate = null) {
  // In the send queue, before building sendCaptions:
  if (translate && !caption.translations) {
    caption.translations = await translate(session.apiKey, caption.text, caption.captionLang);
  }
```

The `if (!caption.translations)` guard means: if the client already translated (browser mode), the server translation is skipped — no double-translation.

**Injection into `SttManager` (the main new capability):**
```js
// In lcyt-rtmp/src/stt-manager.js, after receiving a transcript:
let translations = {};
if (this._translate) {
  translations = await this._translate(session.apiKey, transcript, this._language);
}
session._sendQueue = session._sendQueue.then(() =>
  session.sender?.send(transcript, new Date(), { translations })
);
```

**Env vars added by the plugin:**
| Variable | Purpose | Default |
|---|---|---|
| `TRANSLATE_VENDOR` | Default vendor: `mymemory`, `google`, `deepl`, `libretranslate` | none (plugin disabled) |
| `TRANSLATE_API_KEY` | Vendor API key | none |
| `TRANSLATE_LIBRE_URL` | LibreTranslate base URL | none |

Note: `TRANSLATE_VENDOR` being unset disables the plugin entirely — no config, no routes, zero overhead.

### Relationship to existing client-side translation

The two pipelines are complementary, not competing:

| Scenario | What translates |
|---|---|
| Browser caption (STT off) | Client-side (unchanged) |
| Browser caption + server translate | Server translate takes over (client skips if server provides) |
| STT caption (server transcript) | Server translate only (no browser involved) |
| MCP/CLI caption | Server translate only |

Migrating fully to server-side translation is a separate future decision. Initially, both pipelines can coexist: the browser still translates by default, the server translates STT transcripts.

**Verdict: Recommended — primarily to serve STT-originated captions. The gap is real and will grow as STT adoption increases. The plugin boundary is clean and the injection point in `captions.js` already exists (empty today).**

---

## Updated Summary of Recommendations

| Recommendation | Priority | Type | Effort | Status |
|---|---|---|---|---|
| Group routes into 3 sub-routers (`session/`, `account/`, `content/`) | Medium | Internal refactor | Small | ✅ Done |
| Move DSK event/state out of `store.js` into DskBus | Low | Internal refactor | Small | ✅ Done |
| Split `src/db/index.js` schema from barrel | Low | Internal refactor | Trivial | ✅ Done |
| Extract caption file storage into `lcyt-files` plugin | Medium | Plugin | Medium | Pending (defer until S3 needed) |
| Add server-side translation as `lcyt-translate` plugin | Medium | Plugin | Medium | Pending (prioritise for STT gap) |
| Extract user/IAM cluster into `lcyt-authz` plugin | Not recommended | Plugin | Large | — |
| Extract analytics into `lcyt-analytics` plugin | Not recommended | Plugin | Small | — |

**The backend is not monolithic in a problematic sense.** The three internal refactors (route groups, DskBus, db split) are now done. Two new plugins are warranted by concrete upcoming needs: `lcyt-files` when S3 storage is needed, and `lcyt-translate` to close the translation gap for server-side STT. Both have clean injection points already defined in `captions.js` and `SttManager`.
