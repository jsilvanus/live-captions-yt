# `packages/plugins/lcyt-cues` — Cue Engine Plugin (v0.1.0)

Cue engine for detecting spoken phrases, sounds, and AI-analyzed events to auto-advance rundown files. Supports inline cue metacodes in caption files. Imported by `lcyt-backend` as `lcyt-cues`.

**Main entry:** `src/api.js`
**Usage in lcyt-backend:**
```js
import { initCueEngine, createCueProcessor, createCueRouter, createSoundCueListener } from 'lcyt-cues';

const { engine } = await initCueEngine(db);
const cueProcessor = createCueProcessor({ store, db, engine });
createSoundCueListener({ store, engine });
app.use('/cues', createCueRouter(db, auth, engine));
```

**Source files (`src/`):**
- `api.js` — `initCueEngine(db)` + `createCueProcessor()` + `createCueRouter()` + `createSoundCueListener()`.
- `cue-engine.js` — `CueEngine`: evaluates cue rules per caption, per API key. Match types: `phrase` (substring), `regex`, `section`, `fuzzy` (Jaro-Winkler), `semantic` (embedding-based), `event_cue` (LLM-based). Per-rule cooldown enforcement. Silence timer logic. Embedding + AI config + agent evaluate function injection via setters.
- `cue-processor.js` — `createCueProcessor()`: strips `<!-- cue:label -->` metacodes from caption text, fires cue events on session emitter, triggers CueEngine automatic rules and async event cue evaluation.
- `db.js` — `cue_rules` and `cue_events` tables with indexes on `api_key`. Migrations run on init.
- `routes/cues.js` — `GET/POST/PUT/DELETE /cues/rules`, `GET /cues/events`. Regex pattern validation on create/update.

**Cue metacode syntax (frontend inline markers):**
| Syntax | Mode | Matching |
|---|---|---|
| `<!-- cue:phrase -->` | next (default) | Exact/wildcard |
| `<!-- cue*:phrase -->` | skip (forward past other cues) | Exact/wildcard |
| `<!-- cue**:phrase -->` | any (including backwards) | Exact/wildcard |
| `<!-- cue~:phrase -->` | next + fuzzy | Jaro-Winkler |
| `<!-- cue[semantic]:phrase -->` | next + semantic | Embedding similarity (backend only) |
| `<!-- cue[events]:description -->` | next + AI event | LLM evaluation (backend only) |

**Sound cue match types:** `music_start`, `music_stop`, `silence` (with minimum duration timer).

**Tests:** `packages/plugins/lcyt-cues/test/*.test.js` — uses `node:test`.

---

The `cue` metacode is handled entirely by `cue-processor.js` here (see root `CLAUDE.md`'s Metacode Organization note). Semantic and event-cue matching delegate to `packages/plugins/lcyt-agent` (embeddings + LLM evaluation) — see its `CLAUDE.md`.
