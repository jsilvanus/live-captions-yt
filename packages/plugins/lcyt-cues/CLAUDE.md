# `packages/plugins/lcyt-cues` — Cue Engine Plugin (v0.1.0)

Cue engine for detecting spoken phrases, sounds, and AI-analyzed events to auto-advance rundown files. Supports inline cue metacodes in caption files. Imported by `lcyt-backend` as `lcyt-cues`.

**Main entry:** `src/api.js`
**Usage in lcyt-backend:**
```js
import { initCueEngine, createCueProcessor, createCueRouter, createSoundCueListener, createTrackerCueListener } from 'lcyt-cues';

const { engine } = await initCueEngine(db);
const cueProcessor = createCueProcessor({ store, db, engine });
createSoundCueListener({ store, engine });
createTrackerCueListener({ store, engine }); // fires once lcyt-backend's perception-aggregator emits track_state — see below
app.use('/cues', createCueRouter(db, auth, engine));
```

**Source files (`src/`):**
- `api.js` — `initCueEngine(db)` + `createCueProcessor()` + `createCueRouter()` + `createSoundCueListener()` + `createTrackerCueListener()`.
- `cue-engine.js` — `CueEngine`: evaluates cue rules per caption, per API key. Standalone match types: `phrase` (substring), `regex`, `section`, `fuzzy` (Jaro-Winkler), `semantic` (embedding-based), `event_cue` (LLM-based), `music_start`/`music_stop`/`silence` (sound-state), `track` (cached tracker-state check), `composite` (condition-tree evaluation, Phase 9). Per-rule cooldown enforcement (non-zero default for `track` and `composite`-with-`track`-leaf rules — see `routes/cues.js`). Silence timer logic. Embedding + AI config + agent evaluate function injection via setters.
  - `evaluateComposite(apiKey, node, ctx, localDefs, visited)` — async recursive condition-tree evaluator (Phase 9). Leaf types: `phrase`/`exact`, `regex`, `fuzzy`, `section`, `context`, `track` (sync), `semantic`, `event`/`event_cue` (async). Group nodes `and`/`or`/`not` short-circuit and evaluate cheap sync leaves before async ones within a group regardless of source order. `ref`/`@name` leaves resolve against a caller-supplied `localDefs` map first (inline `cueDefs` from the active file), then the DB-backed `cue_named_conditions` cache, with a cycle guard (`visited` set) — a self-referencing chain degrades to a no-match with a warning log, not an infinite loop or throw. Returns `{ matched, leaf }` so callers can report which leaf fired.
  - `evaluateCompositeRules(apiKey, text, codes, onFired)` — evaluates DB-backed `match_type: 'composite'` rules (async, additive alongside `evaluate()`/`evaluateEventCues()`).
  - `evaluateTrackerEvent(apiKey, state, onFired)` — evaluates standalone `match_type: 'track'` rules against `{ labels: [{ label, confidence, region? }] }` tracker state; also updates the `_trackerState` cache that `track:` leaves inside composite trees read.
  - Inline cues (session-scoped, from `POST /cues/inline`) are evaluated separately via `evaluateInlineCues()` — not merged into the DB-rule cache, since they never need regex precompilation or DB persistence.
- `cue-processor.js` — `createCueProcessor()`: strips `<!-- cue:label -->` metacodes from caption text, fires cue events on session emitter, triggers CueEngine automatic/inline/event-cue/composite-rule evaluation. `createSoundCueListener()`/`createTrackerCueListener()`: mirror-image session-emitter listeners for `sound_label`/`track_state` events (music/silence and tracker-state cue rules respectively). `track_state` is now produced by `packages/lcyt-backend/src/perception-aggregator.js` (`plan_video_perception.md` Phase 2, dedicated-feed cameras only so far — Phase 3 adds shared/mixer-only cameras) — the fps30 tracker subsystem itself lives in `lcyt-worker-daemon`'s `perception/` runner, a separate package `plan_cues.md` always anticipated but didn't build (Phase 9 "Tracker-state leaves"); this listener needed no changes to start firing, the same relationship `createSoundCueListener()` has always had with `lcyt-music`.
- `db.js` — `cue_rules`, `cue_events`, `cue_named_conditions` tables, all indexed by `api_key`. `cue_rules.condition_tree` (additive column) holds a composite rule's JSON tree. Migrations run on init.
- `routes/cues.js` — `GET/POST/PUT/DELETE /cues/rules`, `GET /cues/events`, `POST /cues/inline` (session-scoped inline cue sync), `GET/POST/PUT/DELETE /cues/defs` (named conditions, Phase 9). Regex pattern validation on create/update. Condition-tree validation (known leaf types, `not:` exactly one child) shared by `/cues/rules` composite rules and `/cues/defs`; named-condition writes additionally reject self-reference and multi-hop reference cycles at write time (400, not caught later at evaluation time).

**Cue metacode syntax (frontend inline markers):**
| Syntax | Mode | Matching |
|---|---|---|
| `<!-- cue:phrase -->` | next (default) | Exact/wildcard |
| `<!-- cue*:phrase -->` | skip (forward past other cues) | Exact/wildcard |
| `<!-- cue**:phrase -->` | any (including backwards) | Exact/wildcard |
| `<!-- cue~:phrase -->` | next + fuzzy | Jaro-Winkler |
| `<!-- cue[semantic]:phrase -->` | next + semantic | Embedding similarity (backend only) |
| `<!-- cue[events]:description -->` | next + AI event | LLM evaluation (backend only) |

Composite condition-tree cues (`<!-- cue:\nor:\n  exact: ...\n-->`) and `<!-- cue-def:name: ... -->` named-condition blocks — specced in `docs/plans/plan_cues.md` Phase 9 — are now parsed by the frontend too (`packages/lcyt-web/src/lib/metacode-parser.js`'s `parseIndentedConditionBlock()`), alongside the pre-existing compact `|`-pipe syntax that produces the same tree shape. `lcyt-web`'s `ConditionTreeEditor` component (`CuesPage.jsx`/`CuesManager`) is the visual builder for both `/cues/rules` composite rules and `/cues/defs` named conditions — see `packages/lcyt-web/CLAUDE.md`.

**Sound cue match types:** `music_start`, `music_stop`, `silence` (with minimum duration timer).
**Tracker cue match type:** `track` (label + confidence threshold, checked against the latest cached `track_state` — no timer, unlike `silence`).

**Tests:** `packages/plugins/lcyt-cues/test/*.test.js` — uses `node:test`.

---

The `cue` metacode is handled entirely by `cue-processor.js` here (see root `CLAUDE.md`'s Metacode Organization note). Semantic and event-cue matching delegate to `packages/plugins/lcyt-agent` (embeddings + LLM evaluation) — see its `CLAUDE.md`.
