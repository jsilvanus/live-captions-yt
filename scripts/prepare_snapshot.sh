#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"

echo "LCYT Hetzner snapshot preparation helper"

usage(){
  cat <<'USAGE'
Usage: prepare_snapshot.sh

This script is a non-destructive checklist and helper for preparing a Hetzner VM
to create a snapshot for pre-baked lcyt worker images. It does not call the
Hetzner API — follow your Hetzner Console or `hcloud` commands to create the
snapshot after you verify the VM state.

Steps performed interactively by this script; it will prompt before making
service-stopping changes.
USAGE
}

if [[ "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

echo "Repository root: $repo_root"

cat <<'CHECK'
Before running:
 - Boot a Debian 12 (bookworm) Hetzner cloud server using the provided cloud-init
   user-data (packages/lcyt-worker-daemon/dist/cloud-init-worker.yaml).
 - SSH into the VM as root or an admin user.
 - Verify Docker is running and required images are present.
 - Copy the real lcyt-worker-daemon package into /usr/local/lib/lcyt-worker-daemon
   and run `npm ci --production` there (or install the packaged distribution).

Interactive steps below will stop services to ensure a clean snapshot.
CHECK

read -p "Continue to interactive checklist? (y/N) " yn
if [[ "$yn" != "y" && "$yn" != "Y" ]]; then
  echo "Aborted by user. No changes made."; exit 0
fi

echo "1) Verify Docker images are pulled on target VM"
echo "   SSH into the server and run: docker image ls | grep lcyt || true"

echo
echo "2) Verify worker daemon files:"
echo "   Ensure /usr/local/lib/lcyt-worker-daemon contains your production files."
echo "   Recommended: scp -r packages/lcyt-worker-daemon/dist/ deploy@<vm>:/tmp/ && rsync to /usr/local/lib/..."

read -p "Ready to stop services for snapshot? (this will stop docker and the worker) (y/N) " yn
if [[ "$yn" != "y" && "$yn" != "Y" ]]; then
  echo "Skipping service stop. You can create snapshot manually from the console."; exit 0
fi

echo "Stopping lcyt-worker-daemon (if running) and Docker to flush disk state..."
ssh root@<VM_IP> 'set -e; systemctl stop lcyt-worker-daemon || true; systemctl stop docker || true; sync'

echo "Services stopped. Recommended next steps (manual):"
cat <<'NEXT'
 - From Hetzner Console or `hcloud` create a snapshot of the server disk.
 - After snapshot is created, you can restore it to a new server and boot.
 - On first boot from the snapshot, update /etc/lcyt-worker.env with real
   WORKER_ID and ORCHESTRATOR_URL and then `systemctl restart lcyt-worker-daemon`.
NEXT

echo "Done. Remember: do not embed any credentials in the snapshot." 
