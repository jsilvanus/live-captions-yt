# Consider

Findings from `/code-review` and `/simplify` passes that were deliberately
**skipped** rather than fixed — real observations, judged not worth acting on
immediately (too invasive for the diff at hand, out of scope, or the "fix"
wouldn't actually be simpler). Logged here instead of silently dropped so a
future pass can revisit them with fresh eyes and full context, rather than
rediscovering the same tradeoff from scratch.

Each entry: what was found, why it was skipped, and where.

---

## `VariablesBus` duplicates `DskBus`'s SSE subscriber/broadcast logic

**Where:** `packages/plugins/lcyt-connectors/src/variables-bus.js` vs.
`packages/lcyt-backend/src/dsk-bus.js`

**Finding:** `VariablesBus`'s `addSubscriber`/`removeSubscriber`/
`emitVariableUpdated` (Map<apiKey, Set<Response>>, write-with-prune-on-failure
emit) is a line-for-line copy of `DskBus`'s `addDskSubscriber`/
`removeDskSubscriber`/`emitDskEvent`. `VariablesBus`'s own header comment
admits it "mirrors" `dsk-bus.js`.

**Why skipped:** `DskBus` also carries DSK-specific graphics-state fields and
is load-bearing for the DSK feature elsewhere in the app. Extracting a shared
`SseSubscriberBus` base class is the right fix, but doing it safely means
touching `dsk-bus.js` and re-verifying DSK's SSE behavior — outside the
tested surface of the connectors-plugin diff that surfaced this. Do it as its
own change with DSK regression coverage in scope, not as a side effect of an
unrelated feature branch.

(Found during: `/simplify` on `claude/api-connectors-variables-0wce55`, 2026-07-05.)

---

## `useVariables.js` hand-rolls fetch instead of using `lib/api.js`'s `createApi()`

**Where:** `packages/lcyt-web/src/hooks/useVariables.js` (and
`packages/lcyt-web/src/components/setup-hub/ConnectorsSection.jsx`'s local
`useApi()`)

**Finding:** Both do raw `fetch(..., { headers: { Authorization: ... } })`
with manual `.ok` checking — exactly the boilerplate `lib/api.js`'s
`createApi(senderRef, backendUrlRef)` exists to eliminate, and which
`useSession.js` already uses internally.

**Why skipped:** `createApi` takes `senderRef`/`backendUrlRef` — refs
internal to `useSession`, not currently exposed on its public return value.
Wiring `useVariables`/`ConnectorsSection` through it would mean widening
`useSession`'s contract (e.g. exposing its internal `api` object), which is
consumed by many unrelated components across the app. Reasonable to do, but
as a deliberate `useSession` API change with its own review, not folded into
a feature diff that doesn't otherwise touch `useSession`'s public shape.

(Found during: `/simplify` on `claude/api-connectors-variables-0wce55`, 2026-07-05.)

---

## `db.js`'s three `update*` functions repeat the same coalesce-with-fallback shape

**Where:** `packages/plugins/lcyt-connectors/src/db.js` — `updateConnector`,
`updateRequest`, `updateMapping`

**Finding:** All three build a `next = { col: fields.x !== undefined ? fields.x : existing.col, ... }`
object by hand, one line per column, then spell the same columns again in the
`UPDATE ... SET` string.

**Why skipped:** Checked whether a generic `coalesceFields(existing, fields, columnMap)`
helper would actually shrink this — it wouldn't. Two of the three tables need
per-field transforms that read the *existing* row, not just the incoming
value (`auth_config`/`headers` need `JSON.stringify`; `prefetch_interval_ms`/
`timeout_ms` need clamping against the existing value). A column-map generic
enough to express that ends up needing a transform function per field anyway,
which is roughly as much code as the current three explicit blocks — and
harder to read at each call site. Only 3 call sites total, which doesn't
clear the bar for an abstraction. Left as-is on purpose, not an oversight.

(Found during: `/simplify` on `claude/api-connectors-variables-0wce55`, 2026-07-05.)
