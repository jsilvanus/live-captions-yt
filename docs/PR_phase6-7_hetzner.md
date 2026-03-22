# PR: Phase 6–7: Hetzner provisioning, snapshot, and autoscaling scaffolding

Branch: `director/phase6-7-hetzner`
PR title: "Phase 6–7: Hetzner provisioning, snapshot, and autoscaling scaffolding"

Summary
- Add Hetzner provisioning support and autoscaling scaffolding in the Compute Orchestrator (`packages/lcyt-orchestrator`).
- Include unit/integration tests for the Hetzner client and orchestrator flows.
- Add platform artifacts for worker VM snapshot boot (cloud-init + systemd unit) under `packages/lcyt-worker-daemon/dist/`.
- Add operator runbook and plan updates.

Files touched (included in this PR)
- packages/lcyt-orchestrator/src/hetzner.js
- packages/lcyt-orchestrator/src/index.js
- packages/lcyt-orchestrator/test/hetzner.mock.test.js
- packages/lcyt-orchestrator/test/hetzner.integration.test.js
- packages/lcyt-orchestrator/docs/hetzner.md
- packages/lcyt-worker-daemon/dist/cloud-init-worker.yaml
- packages/lcyt-worker-daemon/dist/lcyt-worker-daemon.service
- scripts/prepare_snapshot.sh
- docs/hetzner_runbook.md
- docs/plan_dock_ffmpeg.md (updated)

How to validate
1) Run orchestrator unit tests locally (Node.js environment):

```bash
# from repo root
npm ci
npm test -w packages/lcyt-orchestrator
```

2) Run hetzner integration test (requires `HETZNER_API_TOKEN` in environment and is gated):

```bash
HETZNER_API_TOKEN=... npm test -w packages/lcyt-orchestrator -- test/hetzner.integration.test.js
```

3) Platform artifact sanity checks (manual):

```bash
# Inspect cloud-init template
less packages/lcyt-worker-daemon/dist/cloud-init-worker.yaml

# Inspect systemd service
less packages/lcyt-worker-daemon/dist/lcyt-worker-daemon.service
```

4) Manual smoke run (single-VM mode):

```bash
# Start local orchestrator (dev)
cd packages/lcyt-orchestrator
node src/index.js

# In another terminal, run orchestrator tests or curl the health endpoint
curl http://localhost:4000/compute/health
```

Rollback plan
- If issues are observed after deploying this change to orchestrator, set `ORCHESTRATOR_FALLBACK=spawn` in the orchestrator environment and restart the orchestrator to force the backend to use local `spawn` runner and bypass orchestrator provisioning logic.
- Remove `HETZNER_API_TOKEN` from orchestrator env to prevent further Hetzner VM creates. Existing VMs must be cleaned up manually or via Hetzner console.
- Revert the orchestrator service to the previous commit or redeploy the old container image.

Notes
- This patch adds the prepared cloud-init and systemd artifacts for operators to use when creating a Hetzner snapshot. The `scripts/prepare_snapshot.sh` helper documents interactive snapshot preparation steps.
