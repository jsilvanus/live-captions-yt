Hetzner burst integration

Environment variables used by the orchestrator for Hetzner integration:

- `HETZNER_API_TOKEN` (required for real Hetzner; tests use a fake local server)
- `HETZNER_API_BASE_URL` (optional) - override Hetzner API base URL (useful for mocks)
- `HETZNER_SNAPSHOT_ID` (optional) - snapshot/image id to use for burst servers
- `HETZNER_SERVER_TYPE_BURST` (optional) - server type, default `cx31`
- `MAX_CONCURRENT_BURST_CREATES` (optional) - concurrent create operations, default `2`
- `ORCHESTRATOR_MAX_PENDING_JOBS` (optional) - pending queue size, default `50`
- `ORCHESTRATOR_BACKOFF_MS` (optional) - base backoff ms for 429 handling, default `1000`
- `ORCHESTRATOR_HETZNER_TIMEOUT_MS` (optional) - poll timeout ms for server ready, default `120000`

Running tests (no real Hetzner credentials):

From repository root:

```bash
# run the orchestrator package tests
npm test -w packages/lcyt-orchestrator
```

The tests use a local fake Hetzner HTTP server and do not contact the real Hetzner API.
