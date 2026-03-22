# Hetzner Worker VM Snapshot Runbook

Summary
- Purpose: produce a pre-baked Hetzner VM snapshot that contains Docker, Node.js,
  the lcyt-worker placeholder (or packaged daemon), and pre-pulled ffmpeg/dsk images.

Files created
- Cloud-init template: packages/lcyt-worker-daemon/dist/cloud-init-worker.yaml
- Systemd unit (packaged): packages/lcyt-worker-daemon/dist/lcyt-worker-daemon.service
- Snapshot helper script: scripts/prepare_snapshot.sh

Snapshot image contents and size
- Target OS: Debian 12 (Bookworm) cloud image
- Installed: Docker Engine (docker-ce), Node.js 18, required system utilities
- Pre-pulled images: lcyt-ffmpeg:latest, lcyt-dsk-renderer:latest
- Typical snapshot size: base Debian 12 (~200MB) + Docker runtime + pre-pulled images.
  Expect snapshots to be 1–3 GB depending on pre-pulled image sizes.

Firewall & networking
- Allow outbound connections to ORCHESTRATOR_URL and any container registries.
- Minimal inbound rules:
  - SSH (TCP 22) restricted to admin IPs
  - Optional management ports for metrics or health (restrict by firewall)

Registering the worker (first boot)
1. After booting from snapshot, edit /etc/lcyt-worker.env and set:
   - WORKER_ID (unique identifier for this instance)
   - ORCHESTRATOR_URL (URL of your orchestrator service)
   - any other values (STORAGE_DIR, LOG_LEVEL)
2. Restart the daemon:

   systemctl daemon-reload
   systemctl restart lcyt-worker-daemon
   systemctl status lcyt-worker-daemon

3. Verify logs via journald:

   journalctl -u lcyt-worker-daemon -f

Pre-pull recommendations
- The cloud-init template pulls the two images listed below; snapshot with them
  pre-pulled so new VMs start faster and avoid registry throttling on boot.
  - lcyt-ffmpeg:latest
  - lcyt-dsk-renderer:latest

Local testing (cloud-init emulation)
- You can verify cloud-init locally using `cloud-localds` + `virt-install` (libvirt):

  # create an ISO with the user-data
  cloud-localds worker-seed.iso packages/lcyt-worker-daemon/dist/cloud-init-worker.yaml

  # launch a test VM (example, requires libvirt and virt-install)
  virt-install --name test-lcyt-worker --memory 2048 --vcpus 1 \
    --disk size=8 --import --os-variant debian12 \
    --disk path=worker-seed.iso,device=cdrom --network network=default \
    --graphics none --noautoconsole --quiet

  # After the VM boots, ssh in (ssh user 'lcyt' or 'root' depending on cloud image)

If you do not have libvirt, you can also test on a local Debian VM by copying the
cloud-init YAML to /var/lib/cloud/seed/nocloud/user-data and rebooting.

Checklist before snapshot
- Boot fresh Debian 12 server with cloud-init user-data attached.
- SSH in and verify:
  - Docker is running: `docker version`
  - Images exist: `docker image ls | grep lcyt`
  - Node is installed: `node -v`
  - Worker files are in place: `/usr/local/lib/lcyt-worker-daemon`
  - `systemctl status lcyt-worker-daemon` shows running (placeholder okay)
- Stop services before snapshot (recommended): `systemctl stop lcyt-worker-daemon; systemctl stop docker`
- Run `sync` and ensure no heavy IO is in flight.

Notes
- Do NOT include secrets or API keys in the snapshot. Use environment variables stored
  in a secrets manager or set them at first boot by editing /etc/lcyt-worker.env or
  using Hetzner Cloud metadata to inject run-time values.
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
