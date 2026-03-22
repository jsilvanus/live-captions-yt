# Hetzner Runbook — Snapshot & Burst VM Operations

This runbook documents operator workflows for preparing, snapshotting, booting, testing, and recovering `lcyt` worker VMs on Hetzner Cloud, plus rollback and troubleshooting steps.

Files referenced in this runbook (exact paths in repository):
- Cloud-init template: packages/lcyt-worker-daemon/dist/cloud-init-worker.yaml
- Worker daemon binary / service: packages/lcyt-worker-daemon/dist/
- Orchestrator service: packages/lcyt-orchestrator/

Important env variables used by orchestrator and workers:
- HETZNER_API_TOKEN — Hetzner Cloud API token (required to create/destroy servers)
- HETZNER_SNAPSHOT_ID — ID of the pre-baked worker snapshot used for burst VMs
- HETZNER_NETWORK_ID — private network ID for worker VMs
- ORCHESTRATOR_BACKOFF_MS — back-off window after Hetzner 429 responses
- BURST_COOLDOWN_MS — idle time before destroying a burst VM
- WARM_POOL_SIZE — number of warm workers to keep online
- BACKEND_INTERNAL_TOKEN — shared secret for backend ↔ orchestrator calls

Pre-snapshot checklist (Platform Engineer)
- Choose base image: Debian 12 (bullseye/bookworm as repo requires).
- Ensure Docker Engine installed and configured with `live-restore` enabled in `/etc/docker/daemon.json`:

```json
{
  "live-restore": true
}
```

- Pull required images:

```bash
sudo docker pull lcyt-ffmpeg:latest
sudo docker pull lcyt-dsk-renderer:latest
sudo docker pull lcyt-worker-daemon:latest
```

- Install and enable `lcyt-worker-daemon` systemd unit. The service should run at boot and auto-restart on crash.

- Create `/etc/lcyt-worker.env` with production env vars or rely on cloud-init to write this file. A recommended cloud-init template is provided at:

packages/lcyt-worker-daemon/dist/cloud-init-worker.yaml

- Validate that `systemctl start lcyt-worker-daemon` yields `active (running)` and that the worker registers with the orchestrator:

```bash
sudo systemctl status lcyt-worker-daemon
curl -sS http://127.0.0.1:5000/health
# expected JSON: { "ok": true, "version": "<x.y.z>", "workerType": "warm", "workerId": "worker-0" }
```

Creating a snapshot (Hetzner console or `hcloud` CLI)
- Using Hetzner Console: Stop critical services if desired, click "Snapshots" → Create snapshot → note the snapshot ID.
- Using `hcloud` CLI:

```bash
# install hcloud CLI if not present
hcloud server list
hcloud server snapshot create <server-id> --description "lcyt-worker-base-$(date +%F)"
# record snapshot id from the response
```

Cloud-init usage
- The orchestrator uses cloud-init `user_data` when creating burst servers. We provide a default template at:

packages/lcyt-worker-daemon/dist/cloud-init-worker.yaml

- The template writes `/etc/lcyt-worker.env` with environment variables such as `ORCHESTRATOR_URL`, `WORKER_TYPE=burst`, `MAX_JOBS`, and then starts `lcyt-worker-daemon` via systemd.

Boot and test a VM (operator steps)
1. Create a VM from the snapshot (console or `hcloud`):

```bash
hcloud server create --name lcyt-test-01 --type cx21 --image <HETZNER_SNAPSHOT_ID> --user-data-file packages/lcyt-worker-daemon/dist/cloud-init-worker.yaml --network <HETZNER_NETWORK_ID>
```

2. Wait until server `status` becomes `running`:

```bash
hcloud server describe lcyt-test-01 --output json | jq .status
```

3. SSH into the VM and validate:

```bash
ssh root@<public-ip>
sudo journalctl -u lcyt-worker-daemon -f
sudo docker images | grep lcyt-ffmpeg
curl -sS http://127.0.0.1:5000/health
```

4. From orchestrator (or locally) POST a small job to the worker to verify `POST /jobs` and `POST /jobs/:id/caption` paths:

```bash
curl -X POST http://<worker-private-ip>:5000/jobs -H 'Content-Type: application/json' -d '{"id":"test-preview","type":"preview","rtmpSource":"rtmp://backend:1935/live/test","previewOutputPath":"/tmp/previews/test","image":"lcyt-ffmpeg:latest","cpuLimit":"0.5","memLimit":"256m"}'
# then check job list
curl http://<worker-private-ip>:5000/jobs
# inject caption (if relevant)
curl -X POST http://<worker-private-ip>:5000/jobs/test-preview/caption -d '{"text":"test","timestamp":"2026-03-21T00:00:00.000"}'
```

Taking a snapshot for production
- Gracefully stop `lcyt-worker-daemon` to ensure filesystem quiescence (optional):

```bash
sudo systemctl stop lcyt-worker-daemon
# verify no active docker pulls or image writes
sudo docker ps -a
# create snapshot via hcloud or console
hcloud server snapshot create <server-id> --description "lcyt-worker-prod-$(date +%F)"
```

Recovering a worker from snapshot (fast path)
1. Create VM from snapshot using `hcloud server create` + cloud-init template (see Boot and test).
2. Ensure worker posts `POST /compute/workers/register` to orchestrator and that orchestrator shows the worker as `ready`.
3. Orchestrator will dispatch any queued jobs to the worker.

Manual recovery if worker fails to register
- SSH into VM, check service logs:

```bash
sudo journalctl -u lcyt-worker-daemon -n 200 --no-pager
sudo journalctl -u lcyt-orchestrator -n 200 --no-pager  # if orchestrator co-located
```

- Check that `/etc/lcyt-worker.env` exists and contains `ORCHESTRATOR_URL` and `BACKEND_INTERNAL_TOKEN`.
- Validate network connectivity to orchestrator private IP and port 4000:

```bash
curl -sS http://<orchestrator-private-ip>:4000/compute/health
nc -zv <orchestrator-private-ip> 4000
```

Rollback steps (operator playbook)
1. Reverting orchestrator to safe mode (single-VM fallback):

```bash
# On orchestrator host or container env
export ORCHESTRATOR_FALLBACK=spawn
# Restart orchestrator service/container (systemd or container restart)
sudo systemctl restart lcyt-orchestrator
```

Effect: Backends will consult orchestrator; if orchestrator is unreachable they will use `ORCHESTRATOR_FALLBACK` runner (`spawn`), returning system to single-VM behaviour.

2. Mark worker degraded (stop scheduling):

```bash
# API call to orchestrator (requires BACKEND_INTERNAL_TOKEN)
curl -X DELETE "http://<orchestrator-ip>:4000/compute/workers/<worker-id>?mark=degraded&auth=<BACKEND_INTERNAL_TOKEN>"
```

3. De-register a worker (keep VM):

```bash
curl -X DELETE "http://<orchestrator-ip>:4000/compute/workers/<worker-id>?destroy=false&auth=<BACKEND_INTERNAL_TOKEN>"
```

4. De-register and destroy the VM (orchestrator issues Hetzner DELETE):

```bash
curl -X DELETE "http://<orchestrator-ip>:4000/compute/workers/<worker-id>?destroy=true&auth=<BACKEND_INTERNAL_TOKEN>"
# verify deletion in Hetzner console or via hcloud
hcloud server list | grep <worker-id>
```

Troubleshooting — common errors and remedies

Hetzner 429 Rate Limit on VM create
- Symptom: Orchestrator logs show 429 responses, VM creates delayed.
- Remedy: Increase `ORCHESTRATOR_BACKOFF_MS`, reduce `MAX_CONCURRENT_BURST_CREATES`, or contact Hetzner if sustained. Inspect orchestrator logs for `rateLimitReset` timestamps.

Image missing on worker
- Symptom: `docker run` exits with 125; worker logs show `IMAGE_MISSING`.
- Remedy:
  - SSH into worker, `docker pull lcyt-ffmpeg:latest`.
  - Restart `lcyt-worker-daemon`.
  - Consider baking image into snapshot for faster boot.

Registration timeout
- Symptom: VM boots but never `POST /compute/workers/register`.
- Remedy:
  - Check `journalctl -u lcyt-worker-daemon` for env errors.
  - Confirm `ORCHESTRATOR_URL` and `BACKEND_INTERNAL_TOKEN` in `/etc/lcyt-worker.env`.
  - Check private-network reachability and firewall rules.

Inspecting logs — quick commands

On worker VM:
```bash
sudo journalctl -u lcyt-worker-daemon -f
sudo docker ps --format '{{.Names}} {{.Status}}'
sudo docker logs <container-name> --tail 200
```

On orchestrator host:
```bash
sudo journalctl -u lcyt-orchestrator -f
# or inside container
docker logs lcyt-orchestrator --follow --tail 200
```

On backend host (if co-located):
```bash
sudo journalctl -u lcyt-backend -f
docker logs lcyt-worker-daemon --tail 200  # if warm worker present
```

Appendix — useful `hcloud` examples

Create server from snapshot with user-data file:

```bash
hcloud server create --name lcyt-worker-burst-001 --type cx31 --image <HETZNER_SNAPSHOT_ID> --user-data-file packages/lcyt-worker-daemon/dist/cloud-init-worker.yaml --network <HETZNER_NETWORK_ID>
```

Delete server by name:

```bash
hcloud server delete lcyt-worker-burst-001
```

Recovering from emergency (operator checklist)
1. Set `ORCHESTRATOR_FALLBACK=spawn` on orchestrator to ensure backends fallback to local mode.
2. Use existing warm worker(s) (backend VM) to accept new RTMP publishers while recovering other workers.
3. Notify on-call and create an incident ticket with timestamps and affected worker IDs.
4. After recovery, revert orchestrator env and observe metrics for 30 minutes.

Contact/Notes
- Platform Engineer: ops-team@example.com
- Hetzner account owner: infra@example.com
- Repository path for worker code: packages/lcyt-worker-daemon/


---
Runbook version: 2026-03-21
