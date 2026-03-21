# Hetzner snapshot preparation (Phase 6.3)

Follow these steps to prepare a pre-baked Hetzner VM snapshot for burst workers.

1. Boot a fresh Hetzner `cx21` VM (Debian 12).
2. Install Docker Engine and enable live-restore:

```bash
sudo apt update && sudo apt install -y docker.io
sudo mkdir -p /etc/docker
cat > /etc/docker/daemon.json <<'JSON'
{
  "live-restore": true
}
JSON
sudo systemctl restart docker
```

3. Pre-pull required images:

```bash
docker pull lcyt-ffmpeg:latest
# optional: docker pull lcyt-dsk-renderer:latest
```

4. Install and enable the `lcyt-worker-daemon` as a systemd service. Example service unit:

```ini
[Unit]
Description=LCYT Worker Daemon
After=docker.service

[Service]
Type=simple
EnvironmentFile=/etc/lcyt-worker.env
ExecStart=/usr/bin/node /opt/lcyt-worker-daemon/dist/index.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

5. Verify the worker daemon is running and registers with your orchestrator.

6. Create a snapshot of the VM in the Hetzner Console and copy the snapshot ID to your orchestrator config (`HETZNER_SNAPSHOT_ID`).

## Cloud-init example

Use the following cloud-init to provision a new burst VM from the snapshot and start the worker:

```yaml
#cloud-config
write_files:
  - path: /etc/lcyt-worker.env
    permissions: "0600"
    content: |
      WORKER_ID=<uuid>
      WORKER_TYPE=burst
      ORCHESTRATOR_URL=http://<orchestrator-private-ip>:4000
      MAX_JOBS=8
      PORT=5000
      FFMPEG_IMAGE=lcyt-ffmpeg:latest
runcmd:
  - systemctl start lcyt-worker-daemon
```

Notes

- Replace `<uuid>` and `<orchestrator-private-ip>` with your actual values before use.
- Ensure that Hetzner private networking is configured and the `HETZNER_NETWORK_ID` is passed when creating servers.
