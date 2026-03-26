---
id: plan/backend-split
title: "lcyt-backend Modularization & Plugin Extraction Assessment"
status: draft
summary: "Structural analysis of the lcyt-backend monolith and recommendations for further decomposition into plugins and internal modules."
---

# lcyt-backend — Modularization Assessment

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
2. It manages background services with their own lifecycle.
3. Its route surface is large enough that mounting it in `server.js` is noisy.
4. It has external dependencies that other parts of the backend do not need.

Based on current features, no remaining cluster meets all four criteria. If a future feature like **push notifications**, **webhook fan-out**, or **billing integration** were added, those would be strong plugin candidates.

---

## Summary of Recommendations

| Recommendation | Priority | Type | Effort |
|---|---|---|---|
| Group routes into 3 sub-routers (`session/`, `account/`, `content/`) | Medium | Internal refactor | Small (no new packages) |
| Move DSK event/state out of `store.js` into a shared EventBus | Low | Internal refactor | Small |
| Split `src/db/index.js` schema from barrel | Low | Internal refactor | Trivial |
| Extract user/IAM cluster into `lcyt-authz` plugin | Not recommended | Plugin | Large, low benefit |
| Extract analytics into `lcyt-analytics` plugin | Not recommended | Plugin | Small, no benefit |
| Extract file management into `lcyt-files` plugin | Not recommended | Plugin | Small, no benefit |

**The backend is not monolithic in a problematic sense.** The three existing plugins handle the heavy, optional, infrastructure-facing features. The ~5,200 LOC core is the product's essential logic and should stay together. The main actionable item is taming `server.js` through route group factories — an internal refactor with no package boundary changes.
