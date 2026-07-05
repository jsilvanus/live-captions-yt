# `packages/lcyt-cli` — CLI Tool (v1.4.0)

Published to npm. ESM shebang script.

**Entrypoint:** `bin/lcyt`

**Modes:**
- Full-screen blessed UI (default)
- Interactive line-by-line (`-i`)
- Single caption: `lcyt "text"`
- Heartbeat test: `lcyt --heartbeat`

**Key options:** `--stream-key`, `--base-url`, `--region`, `--verbose`, `--log-stderr`

**Full-screen UI** (`src/interactive-ui.js`): blessed terminal panels — text preview, input field, sent-captions log, status bar. Supports `/load <file>`, batch mode, vim/arrow key navigation.

**Tests:** `packages/lcyt-cli/test/`.

## CLI Usage

```bash
node_modules/.bin/lcyt                     # Full-screen mode
node_modules/.bin/lcyt "Hello, world!"    # Send single caption
node_modules/.bin/lcyt /batch "text"      # Batch mode
node_modules/.bin/lcyt --stream-key KEY   # Set stream key
node_modules/.bin/lcyt --heartbeat        # Test connection
node_modules/.bin/lcyt -i                 # Interactive line-by-line mode
```

## Test Coverage

**Test files:** `test/cli.test.js` (25 tests), `test/interactive-ui.test.js` (49 tests, added 2026-03-16).

**Covered:** Argument parsing, `--heartbeat`, config precedence, session lifecycle. Pure-logic methods of `InteractiveUI`: `loadFile`, `shiftPointer`, `gotoLine`, `isSendableLine`, `sendCurrentLine`, `sendCustomCaption`, `sendBatch`, all `handleCommand` branches (`/load`, `/goto`, `/batch`, `/timestamps`, `/ts`, `/send`, `/stream`, `/reload`), `_parseVideoId`.

**Gaps (Medium):**
- `bin/lcyt` entry point — CLI argument error handling, `LCYT_LOG_STDERR` flag, env-variable precedence.
- Blessed rendering (`initScreen`, `updateTextPreview`, `updateStatus`) — requires a full blessed mock or snapshot approach.

---

See root `CLAUDE.md` for repo-wide conventions (error hierarchy, timestamp handling, logger usage, configuration precedence).
