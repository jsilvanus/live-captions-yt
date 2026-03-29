# Metacode Refactor Plan

Scope guardrails:
- Keep plugin metacode handling as-is, especially `packages/plugins/lcyt-dsk/src/caption-processor.js`.
- Only clarify core backend and frontend metacode handling by moving logic into dedicated `*metacode*` files with minimal compatibility-preserving edits.

1. Extract backend core metacode orchestration from `packages/lcyt-backend/src/routes/captions.js` into a dedicated helper such as `packages/lcyt-backend/src/caption-metacode.js`.
Rationale: the captions route currently mixes request validation, queueing, file writing, target fan-out, and the one core metacode step that strips/processes caption text before delivery.

2. Limit the backend helper to core responsibilities only: accept caption text plus codes, invoke injected processors exactly as today, and return cleaned caption payloads without changing plugin contracts.
Rationale: this keeps plugin metacodes untouched while making the backend’s own metacode handoff explicit and easier to test in isolation.

3. Split frontend file parsing from generic file utilities by moving `parseFileContent()` and its regex/helpers into a dedicated parser file such as `packages/lcyt-web/src/lib/file-metacode-parser.js`, then re-export from `fileUtils.js` during the transition.
Rationale: parser behavior is the densest metacode logic on the client, and a compatibility re-export keeps `useFileStore` and existing imports stable.

4. Extract the `InputBar.jsx` metacode runtime pieces into a dedicated helper such as `packages/lcyt-web/src/lib/input-metacode-runtime.js`, covering action draining, `goto` resolution, timer scheduling helpers, and file-switch helpers.
Rationale: this is the main runtime seam for action metacodes, and separating it reduces the current coupling between UI state management and metacode execution.

5. Rename or wrap manual-state and planner helpers behind metacode-specific files, for example `packages/lcyt-web/src/lib/manual-metacode-state.js` for active codes and `packages/lcyt-web/src/lib/planner-metacode.js` for plan serialization/deserialization, while keeping existing exports available until callers are updated.
Rationale: this makes the manual state and planner responsibilities discoverable without forcing a broad rename across unrelated UI components in one pass.

6. Update targeted tests alongside the moves: keep `packages/lcyt-backend/test/captions.test.js` focused on route behavior, add a small backend metacode helper test if extraction creates pure logic, migrate `packages/lcyt-web/test/fileUtils.test.js` coverage to the parser entry point, migrate `packages/lcyt-web/test/planner.test.js` to the planner-metacode entry point, and add a focused runtime test for drained action sequences (`audio`, `timer`, `goto`, `file`, `file[server]`).
Rationale: the refactor is mostly about code location and clarity, so tests should prove compatibility at the seams being moved rather than broaden feature scope.