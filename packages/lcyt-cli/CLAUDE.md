# `packages/lcyt-cli` — CLI Tool (v2.0.0)

Published to npm. ESM shebang script.

**Entrypoint:** `bin/lcyt`

**Modes:**
- Full-screen blessed UI (default)
- Interactive line-by-line (`-i`)
- Single caption: `lcyt "text"`
- Heartbeat test: `lcyt --heartbeat`
- Project admin commands (new)
- Feature management commands (new)

**Key options:** `--stream-key`, `--base-url`, `--region`, `--verbose`, `--log-stderr`, `--backend-url`, `--admin-key`, `--jwt-token`

**Full-screen UI** (`src/interactive-ui.js`): blessed terminal panels — text preview, input field, sent-captions log, status bar. Supports `/load <file>`, batch mode, vim/arrow key navigation.

**Project Admin Commands** (`src/commands/project-admin.js`): CRUD operations for projects and setup settings via backend admin API.

**Tests:** `packages/lcyt-cli/test/`.

## CLI Usage

### Caption Sending (Legacy)

```bash
node_modules/.bin/lcyt                     # Full-screen mode
node_modules/.bin/lcyt "Hello, world!"    # Send single caption
node_modules/.bin/lcyt /batch "text"      # Batch mode
node_modules/.bin/lcyt --stream-key KEY   # Set stream key
node_modules/.bin/lcyt --heartbeat        # Test connection
node_modules/.bin/lcyt -i                 # Interactive line-by-line mode
```

### Project Admin Commands (New)

**Requires:** `--backend-url`, `--admin-key` (or `ADMIN_KEY` env var) or `--jwt-token`

```bash
# Project CRUD
lcyt project create --owner "Project Name" --email "owner@example.com"
lcyt project list [--limit 50] [--offset 0]
lcyt project get <api-key>
lcyt project update <api-key> --owner "New Name" --email "new@example.com"
lcyt project delete <api-key>

# Project Export/Import/Script Generation
lcyt project export <api-key> --output project.json
lcyt project import --file project.json
lcyt project generate-script <api-key> --output setup.sh

# Feature Flag Management
lcyt features get <api-key>
lcyt features set <api-key> --enable captions,file-saving --disable graphics-client
lcyt features reset <api-key>
```

### Project Admin Examples

```bash
# Create a project
export ADMIN_KEY="your-admin-key"
export LCYT_BACKEND_URL="http://localhost:3000"
lcyt project create --owner "My Project" --email "admin@example.com"

# Export current project config
lcyt project export <key> --output backup.json

# Generate a reusable setup script
lcyt project generate-script <key> --output setup.sh

# Apply setup script on another server
bash setup.sh --backend-url http://production:3000 --admin-key "prod-key"

# Enable/disable features
lcyt features set <key> --enable ingest,radio --disable graphics-server
lcyt features get <key> > features.json
```

## Export/Import Format

Projects can be exported as JSON and re-imported to recreate configurations:

```json
{
  "version": "1.0",
  "exportedAt": "2026-10-08T15:00:00.000Z",
  "project": {
    "key": "...",
    "owner": "...",
    "email": "...",
    "dailyLimit": 1000,
    "lifetimeLimit": null,
    "active": true
  },
  "features": {
    "captions": true,
    "file-saving": true,
    "files-local": true,
    "graphics-client": false
  },
  "members": [],
  "deviceRoles": []
}
```

## Generated Setup Scripts

The `project generate-script` command creates a bash script that:
1. Verifies the project exists
2. Applies feature flags
3. Can be version-controlled or documented in runbooks

Usage:
```bash
lcyt project generate-script <key> --output setup.sh
bash setup.sh --backend-url http://localhost:3000 --admin-key "key"
```

## Architecture

- **`src/commands/project-admin.js`** — Command handlers for project/features subcommands
- **`src/lib/project-client.js`** — HTTP client for admin API (handles auth, requests)
- **`src/lib/project-import-export.js`** — Export/import logic (JSON serialization)
- **`src/lib/script-generator.js`** — Bash/Node.js script generation utilities
- **`bin/lcyt`** — CLI entry point, registers all commands with yargs

## Test Coverage

**Test files:** 
- `test/cli.test.js` (25+ tests) — caption sending, config, argument parsing
- `test/interactive-ui.test.js` (49 tests) — full-screen UI logic
- `test/project-admin.test.js` (6 tests) — project client initialization and authentication

**Covered:** Argument parsing, `--heartbeat`, config precedence, session lifecycle. Pure-logic methods of `InteractiveUI`: `loadFile`, `shiftPointer`, `gotoLine`, `isSendableLine`, `sendCurrentLine`, `sendCustomCaption`, `sendBatch`, all `handleCommand` branches (`/load`, `/goto`, `/batch`, `/timestamps`, `/ts`, `/send`, `/stream`, `/reload`), `_parseVideoId`. ProjectAdminClient auth and header generation.

**Gaps (Medium):**
- `bin/lcyt` entry point — CLI argument error handling for new commands, full integration testing.
- Blessed rendering (`initScreen`, `updateTextPreview`, `updateStatus`) — requires a full blessed mock or snapshot approach.
- ProjectAdminClient — full HTTP mock testing (currently only testing constructor/headers).
- Import/export — end-to-end backend integration testing.

---

See root `CLAUDE.md` for repo-wide conventions (error hierarchy, timestamp handling, logger usage, configuration precedence).
