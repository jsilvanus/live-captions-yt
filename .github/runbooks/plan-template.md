# Runnable Plan Template

Purpose: a reproducible, executable plan that assigns steps to agents, lists inputs/outputs, includes validation commands, and provides rollback.

Usage: copy this file to a task-specific runbook (e.g., `.github/runbooks/migrate-captions-schema.md`) and fill the placeholders.

---

Title: <short descriptive title>
Scope: <what is included / excluded>
Owner: @<team/owner>
Mode: Planning | Execution | Debug

Assumptions:
- <assumption 1>
- <assumption 2>

Constraints:
- No DB downtime > 10m
- No new external services

Agent Map (for this plan):
- backend: Backend Engineer
- db: Databases & Migrations
- infra: Platform Engineer
- qa: Testing & QA
- frontend: Frontend Engineer
- dsk: DSK Renderer

Plan Steps (ordered)

1) Step: Design migration
   - agent: `db`
   - input:
     - schema diff file: `migrations/000X-add-caption-errors.sql` (draft)
     - test DB snapshot: `./tmp/test.db`
   - output:
     - migration script (idempotent)
     - rollback SQL
   - validations:
     - Run migration on copy DB: `node scripts/run-migration.js --db ./tmp/test.db --migration migrations/000X-add-caption-errors.sql`
     - Verify table exists: `sqlite3 ./tmp/test.db "SELECT name FROM sqlite_master WHERE type='table' AND name='caption_errors';"`
   - estimated: 2h
   - on-failure: revert migration file and notify `@db` lead

2) Step: Add DB migration PR
   - agent: `backend`
   - input:
     - migration script from `db`
     - migration runner test
   - output:
     - PR with migration + tests
   - validations:
     - `npm test -w packages/lcyt-backend --silent`
     - `node scripts/run-migration.js --dry-run`
   - estimated: 1h

3) Step: Deploy migration to staging
   - agent: `infra`
   - input: migration PR merged to `staging` branch
   - output: staging DB migrated; backup completed
   - validations:
     - Backup exists: `ls /backups/lcyt-backend/$(date +%F).sql`
     - Smoke test: `curl -sS http://staging.example/health | jq .status` -> `ok`
   - rollback:
     - Restore backup: `pg_restore --clean -d lcyt_staging /backups/...`
   - estimated: 30m

4) Step: Run regression tests
   - agent: `qa`
   - input: staging deployment
   - output: test report
   - validations:
     - `npm test -w packages/lcyt-backend`
     - `npm run test:components -w packages/lcyt-web`
   - estimated: 1h

5) Step: Approve and roll to production
   - agent: `infra`
   - input: green tests, approvals
   - output: production DB migrated
   - validations:
     - Production health: `curl -sS https://api.example/health | jq .uptime` (not empty)
     - Monitor logs for 15m for errors: `journalctl -u lcyt-backend -n 200 --no-pager`
   - rollback: restore prod backup
   - estimated: 45m

Post-deploy checks
- Verify sample caption ingestion: `curl -X POST https://api.example/captions -H "Authorization: Bearer $SESSION" -d '{"text":"test"}'`
- Check SSE event emitted: connect to `/events` and observe `caption_result` for the requestId

Escalation
- If any validation fails, collect logs, create an incident note, and contact `@oncall-db`.

Notes
- Replace `example` URLs and paths with workspace-specific values.
- Keep validation commands idempotent and scriptable.

Template variables to fill before executing:
- `MIGRATION_FILE`, `STAGING_URL`, `PROD_URL`, `BACKUP_PATH`, `CONTACTS`

---

Example: to run validations for Step 1 locally

```bash
# run migration on temp DB
node scripts/run-migration.js --db ./tmp/test.db --migration migrations/000X-add-caption-errors.sql
# verify table
sqlite3 ./tmp/test.db "SELECT name FROM sqlite_master WHERE type='table' AND name='caption_errors';"
```

Copy this template, fill placeholders, and follow the Plan Steps in order. Use the `agent` field to determine who should open PRs or run the commands. When in Execution mode, the director may invoke agents to create PR templates, but must not implement the code directly.
