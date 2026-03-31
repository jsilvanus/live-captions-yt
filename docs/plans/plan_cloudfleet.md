---
id: plan/cloudfleet
title: "Hosting Modes & Cloudfleet Deployment"
status: draft
summary: "Comprehensive hosting guide covering three tiers: Local (docker-compose), Self-managed orchestrator (docker-compose.orchestrator.yml + Hetzner VMs), and Cloudfleet managed Kubernetes. Kubernetes manifests provided in k8s/cloudfleet/."
---

# Plan: Hosting Modes & Cloudfleet Deployment

**Date:** 2026-03-31  
**Status:** Draft  
**Related plans:** [plan/dock-ffmpeg](plan_dock_ffmpeg.md)

---

## Overview

LCYT can be hosted at three distinct tiers. Each tier is independently
deployable and shares the same Docker images and environment variable
configuration.

| Tier | Compose / tooling | When to use |
|------|-------------------|-------------|
| **1 — Local (dockerised)** | `docker-compose.yml` | Development, personal use, single small event |
| **2 — Self-managed orchestrator** | `docker-compose.orchestrator.yml` + Hetzner VMs | Production, moderate scale, full control, cost-optimised |
| **3 — Cloudfleet** | `k8s/cloudfleet/` Kubernetes manifests | Managed HA cluster, multi-region, enterprise, minimal ops overhead |

All three tiers use the same images:

| Image | Purpose |
|-------|---------|
| `lcyt-site:latest` | Backend API + MCP SSE server |
| `bluenviron/mediamtx:latest` | RTMP/HLS media broker |
| `lcyt-worker-daemon:latest` | ffmpeg worker daemon (Tier 2 & 3 distributed mode) |
| `lcyt-ffmpeg:latest` | Ephemeral ffmpeg compute container |
| `lcyt-dsk-renderer:latest` | Playwright + ffmpeg DSK graphics renderer |

---

## Tier 1 — Local (Dockerised)

### Architecture

```
┌─────────────────── single VM or developer machine ────────────────────┐
│                                                                        │
│  nginx (reverse proxy)                                                 │
│    └── lcyt-backend  :3000   ← Docker Compose service "lcyt-site"     │
│    └── lcyt-mcp-sse  :3001   ← same container, secondary port         │
│  mediamtx            :1936   ← RTMP ingest                            │
│                      :8080   ← HLS + metrics                          │
│                      :9997   ← REST API (internal)                    │
│  docker-socket-proxy         ← opt-in for FFMPEG_RUNNER=docker        │
│                                                                        │
│  lcyt-db (named Docker volume) ← SQLite                               │
└────────────────────────────────────────────────────────────────────────┘
```

### Quick start

```bash
cp .env.example .env          # set JWT_SECRET + ADMIN_KEY at minimum
docker compose up             # starts lcyt-site + mediamtx
```

See `docs/DEPLOY.md` § "Quick start — single VM" for the full deployment
script and nginx configuration.

### File reference

| File | Purpose |
|------|---------|
| `docker-compose.yml` | Compose stack: lcyt-site, mediamtx, optional docker-socket-proxy |
| `.env.example` | All supported environment variables with defaults |
| `docs/DEPLOY.md` | Full deployment guide for this tier |
| `docs/FIREWALL.md` | nginx config, UFW rules, RTMP ingest |

### Feature matrix (Tier 1)

| Feature | Supported | Notes |
|---------|-----------|-------|
| Caption ingestion | ✅ | All transport targets (YouTube, viewer, generic) |
| RTMP relay + HLS | ✅ | MediaMTX mode (no ffmpeg needed for HLS/radio) |
| DSK graphics renderer | ✅ | Playwright + local ffmpeg |
| Server-side STT | ✅ | Google, Whisper HTTP, OpenAI adapters |
| Production control | ✅ | Bridge agents connect via SSE |
| Horizontal scaling | ❌ | Single process; SQLite cannot be shared |
| Burst compute workers | ❌ | Use Tier 2 or 3 for distributed ffmpeg |
| Automatic failover | ❌ | Restart policy: `unless-stopped` only |

---

## Tier 2 — Self-Managed Orchestrator

### Architecture

```
                   ┌──── Control plane VM (always-on) ─────────────────┐
                   │  lcyt-backend  :3000                               │
                   │  lcyt-orchestrator  :4000                          │
                   │  mediamtx  :1936 / :8080 / :9997                  │
                   │  lcyt-worker-daemon  :5000  ← warm-pool worker #0  │
                   └──────────────────────┬────────────────────────────┘
                           HTTP /jobs     │      Hetzner Cloud API
                                          │
           ┌──────────────────────────────┼──────────────────────────┐
           │                             │                            │
   ┌───────▼──────────────┐   ┌─────────▼──────────────┐            │
   │ Worker VM #1 (warm)  │   │ Worker VM #N (burst)    │   ...      │
   │ lcyt-worker-daemon   │   │ lcyt-worker-daemon      │            │
   │ Docker socket        │   │ Docker socket           │            │
   └──────────────────────┘   └─────────────────────────┘            │
                                         Hetzner auto-provisions ─────┘
```

### Quick start

```bash
cp .env.example .env
# also set BACKEND_INTERNAL_TOKEN, HETZNER_API_TOKEN, HETZNER_SNAPSHOT_ID
docker compose -f docker-compose.orchestrator.yml up
```

See `docs/DEPLOY.md` § "Distributed mode (orchestrator)" and
`docs/hetzner_runbook.md` for the full runbook.

### File reference

| File | Purpose |
|------|---------|
| `docker-compose.orchestrator.yml` | Three-service Compose stack |
| `packages/lcyt-orchestrator/` | Orchestrator source code |
| `packages/lcyt-worker-daemon/` | Worker daemon source + cloud-init template |
| `docs/hetzner_runbook.md` | Snapshot creation, burst VM lifecycle |
| `docs/hetzner_snapshot.md` | Pre-baking the worker snapshot |

### Feature matrix (Tier 2)

| Feature | Supported | Notes |
|---------|-----------|-------|
| All Tier 1 features | ✅ | |
| Distributed ffmpeg workers | ✅ | Worker daemon per VM |
| Burst VM autoscaling | ✅ | Hetzner Cloud API (needs `HETZNER_API_TOKEN`) |
| Warm pool | ✅ | `WARM_POOL_SIZE` keeps N workers always-on |
| Horizontal scaling | ❌ | Backend still single process; SQLite single-writer |
| Managed certificates | ❌ | Operator manages TLS via certbot |

---

## Tier 3 — Cloudfleet (Managed Kubernetes)

Cloudfleet is a fully managed Kubernetes platform running on Hetzner Cloud.
It provides a single control plane for multi-cluster, multi-cloud and on-premises
workloads with an integrated OCI-compliant container registry (CFCR).

### Why Cloudfleet over plain Hetzner

| Capability | Tier 2 (plain Hetzner VMs) | Tier 3 (Cloudfleet) |
|------------|---------------------------|----------------------|
| Cluster management | Manual (SSH + systemd) | Cloudfleet console |
| Node autoscaling | Custom orchestrator (lcyt-orchestrator) | Kubernetes Cluster Autoscaler via Cloudfleet |
| Load balancing | nginx on the VM | Kubernetes Ingress + Cloudfleet LB |
| TLS / certificates | Certbot (manual renewal) | cert-manager (auto-renewal) |
| Container registry | External (Docker Hub, GHCR, …) | Cloudfleet CFCR (built-in) |
| Rolling updates | `docker compose pull && restart` | Kubernetes rolling deployment |
| RBAC / multi-tenant | SSH key management | Kubernetes RBAC |
| Cost model | Pay per VM + ops time | Pay per managed cluster + nodes |

### Architecture on Cloudfleet

```
                    ┌──── Cloudfleet cluster ──────────────────────────────────┐
                    │                                                            │
                    │  nginx Ingress Controller (Cloudfleet-managed)            │
                    │    https://api.example.com  ──►  lcyt-backend:3000        │
                    │    https://mcp.example.com  ──►  lcyt-backend:3001        │
                    │                                                            │
                    │  lcyt-backend   Deployment (1 replica*)                   │
                    │    PVC: lcyt-db  ← SQLite  (/data)                        │
                    │                                                            │
                    │  mediamtx   Deployment (1 replica)                        │
                    │    Service/LoadBalancer :1935  ← RTMP ingest              │
                    │    Service/ClusterIP    :8080  ← HLS (internal)           │
                    │    Service/ClusterIP    :9997  ← REST API (internal)      │
                    │                                                            │
                    │  [optional] lcyt-orchestrator  Deployment (1 replica)     │
                    │  [optional] lcyt-worker-daemon DaemonSet (needs Docker)   │
                    └────────────────────────────────────────────────────────────┘

* Scale to >1 replica requires migrating SQLite → Postgres (see § Scaling)
```

### Prerequisites

- A Cloudfleet account and a provisioned cluster backed by Hetzner nodes
  (see https://cloudfleet.ai)
- `kubectl` configured to point at the Cloudfleet cluster
  (`cloudfleet kubeconfig get <cluster>` or download from the console)
- Docker images available in a registry accessible to the cluster:
  - Cloudfleet Container Registry (CFCR) — recommended
  - Docker Hub, GHCR, or any other OCI registry
- `cert-manager` and an nginx Ingress Controller installed in the cluster
  (both are available as one-click apps in the Cloudfleet Charts Marketplace)

### Manifests

All Kubernetes manifests live in `k8s/cloudfleet/`. Apply them in order:

```bash
# 1. Create namespace
kubectl apply -f k8s/cloudfleet/00-namespace.yaml

# 2. Create secrets (edit the file first to fill in your values)
kubectl apply -f k8s/cloudfleet/01-secret.yaml

# 3. ConfigMap (non-sensitive env vars)
kubectl apply -f k8s/cloudfleet/02-configmap.yaml

# 4. Persistent storage for SQLite
kubectl apply -f k8s/cloudfleet/03-pvc.yaml

# 5. Backend deployment + service
kubectl apply -f k8s/cloudfleet/10-backend-deployment.yaml
kubectl apply -f k8s/cloudfleet/11-backend-service.yaml

# 6. MediaMTX deployment + services
kubectl apply -f k8s/cloudfleet/20-mediamtx-configmap.yaml
kubectl apply -f k8s/cloudfleet/21-mediamtx-deployment.yaml
kubectl apply -f k8s/cloudfleet/22-mediamtx-service.yaml

# 7. Ingress (HTTPS via cert-manager)
kubectl apply -f k8s/cloudfleet/30-ingress.yaml

# --- optional distributed compute ---
# 8. Orchestrator (needed for FFMPEG_RUNNER=worker)
kubectl apply -f k8s/cloudfleet/40-orchestrator-deployment.yaml
kubectl apply -f k8s/cloudfleet/41-orchestrator-service.yaml
```

Or apply the whole directory at once:

```bash
kubectl apply -f k8s/cloudfleet/
```

### Pushing images to Cloudfleet Container Registry (CFCR)

```bash
# Log in to CFCR (get credentials from Cloudfleet console)
docker login registry.<your-cluster>.cloudfleet.io

# Build and push lcyt-site
docker build -t registry.<your-cluster>.cloudfleet.io/lcyt/lcyt-site:latest .
docker push registry.<your-cluster>.cloudfleet.io/lcyt/lcyt-site:latest

# Build and push worker daemon (distributed mode only)
docker build -t registry.<your-cluster>.cloudfleet.io/lcyt/lcyt-worker-daemon:latest \
  packages/lcyt-worker-daemon/
docker push registry.<your-cluster>.cloudfleet.io/lcyt/lcyt-worker-daemon:latest

# Build and push ffmpeg image
docker build -t registry.<your-cluster>.cloudfleet.io/lcyt/lcyt-ffmpeg:latest \
  docker/lcyt-ffmpeg/
docker push registry.<your-cluster>.cloudfleet.io/lcyt/lcyt-ffmpeg:latest
```

Update the `image:` fields in the deployment manifests to use your CFCR URIs.

### Configuration

All environment variables are split between a **Secret** (sensitive values)
and a **ConfigMap** (non-sensitive values). See `k8s/cloudfleet/01-secret.yaml`
and `k8s/cloudfleet/02-configmap.yaml` for the full list.

Required secrets:

| Key | Description |
|-----|-------------|
| `JWT_SECRET` | HS256 signing key for session JWTs |
| `ADMIN_KEY` | Admin endpoint API key |
| `BACKEND_INTERNAL_TOKEN` | Shared secret for orchestrator auth (distributed mode) |

To create the secret imperatively (alternative to editing the YAML):

```bash
kubectl -n lcyt create secret generic lcyt-secrets \
  --from-literal=JWT_SECRET="$(openssl rand -hex 32)" \
  --from-literal=ADMIN_KEY="$(openssl rand -hex 16)" \
  --from-literal=BACKEND_INTERNAL_TOKEN="$(openssl rand -hex 24)"
```

### Persistent storage

SQLite is stored on a `PersistentVolumeClaim`. On Cloudfleet (Hetzner),
the default StorageClass provisions Hetzner CSI block volumes.

```yaml
# k8s/cloudfleet/03-pvc.yaml (excerpt)
storageClassName: hcloud-volumes   # default on Cloudfleet/Hetzner
resources:
  requests:
    storage: 5Gi
```

Backups: mount a second volume at `BACKUP_DIR` and set `BACKUP_DAYS=30`, or
use a CronJob to snapshot the Hetzner CSI volume via the Hetzner Cloud API.

### RTMP ingest

MediaMTX exposes port 1935 (RTMP) via a `LoadBalancer` Service. Cloudfleet
provisions a Hetzner Load Balancer automatically. The allocated external IP
is used in your OBS / encoder settings.

```bash
# Get the RTMP external IP
kubectl -n lcyt get svc mediamtx-rtmp -o jsonpath='{.status.loadBalancer.ingress[0].ip}'
```

### TLS and ingress

`cert-manager` with the Let's Encrypt `ClusterIssuer` handles TLS
automatically. The `30-ingress.yaml` manifest routes:

- `https://api.example.com`  →  `lcyt-backend:3000`
- `https://api.example.com/sse` → `lcyt-backend:3001` (MCP SSE)

Update the `host:` fields to match your actual domain.

### Scaling

**Single replica (default):** SQLite is single-writer; the `lcyt-backend`
Deployment uses `replicas: 1` with a `ReadWriteOnce` PVC. This is appropriate
for most events.

**Multi-replica (horizontal scaling):** Requires migrating from SQLite to
PostgreSQL or another shared-connection-capable database. A migration path is
planned in `plan/dock-ffmpeg` Phase 8.

Intermediate option — **Litestream** sidecar: Use
[Litestream](https://litestream.io) as a sidecar container to replicate the
SQLite WAL to S3. This enables read replicas and warm standbys.

### Distributed compute on Cloudfleet

The `lcyt-orchestrator` and `lcyt-worker-daemon` services can also run on
Cloudfleet. However, the worker daemon needs Docker socket access to launch
ephemeral ffmpeg containers. Options:

| Option | Pros | Cons |
|--------|------|------|
| `hostPath` socket mount | Simple, same as Tier 2 | Requires privileged node; security risk |
| Kubernetes Jobs (no daemon) | Native K8s primitives | Requires a new ffmpeg job runner (not yet implemented) |
| Hetzner burst VMs via orchestrator | Identical to Tier 2 autoscaling | Workers are VMs outside the cluster |

The recommended path on Cloudfleet is to run `lcyt-orchestrator` inside the
cluster and let it provision **external Hetzner burst VMs** via the Hetzner
Cloud API — identical to Tier 2. The orchestrator manifest is included in
`k8s/cloudfleet/40-*.yaml`.

### Rolling updates

```bash
# Update backend image after pushing a new tag
kubectl -n lcyt set image deployment/lcyt-backend \
  lcyt-backend=registry.<your-cluster>.cloudfleet.io/lcyt/lcyt-site:new-tag

# Watch rollout
kubectl -n lcyt rollout status deployment/lcyt-backend
```

### Monitoring

The backend exposes `GET /health` and the orchestrator exposes
`GET /compute/health`. Wire these into Cloudfleet's health probes (already
set in the manifests as `readinessProbe` and `livenessProbe`).

For metrics, `GET /metrics` on the orchestrator returns Prometheus text format.
Add a `ServiceMonitor` (Prometheus Operator) to scrape it if you have Prometheus
installed on your cluster.

### Feature matrix (Tier 3)

| Feature | Supported | Notes |
|---------|-----------|-------|
| All Tier 1 features | ✅ | |
| Distributed ffmpeg workers | ✅ | Orchestrator + external Hetzner VMs |
| Burst VM autoscaling | ✅ | `HETZNER_API_TOKEN` on orchestrator pod |
| Horizontal backend scaling | ⚠️ | Requires Postgres migration |
| Managed TLS | ✅ | cert-manager + Let's Encrypt |
| Rolling deploys | ✅ | Kubernetes rolling update strategy |
| RBAC | ✅ | Kubernetes native RBAC |
| Container registry | ✅ | Cloudfleet CFCR |
| Prometheus metrics | ✅ | `/metrics` on orchestrator |

---

## Comparison summary

| Aspect | Tier 1 — Local | Tier 2 — Self-managed | Tier 3 — Cloudfleet |
|--------|---------------|----------------------|---------------------|
| **Setup effort** | Low (one `compose up`) | Medium (Compose + Hetzner API) | Medium (kubectl + Cloudfleet console) |
| **Ops effort (ongoing)** | Low | Medium (VM SSH, snapshot management) | Low (managed control plane) |
| **Cost** | Host cost only | Hetzner VM cost | Cloudfleet fee + Hetzner node cost |
| **HA / failover** | ❌ | Manual (warm-pool VMs) | ✅ (Kubernetes restarts) |
| **TLS management** | Manual (certbot) | Manual (certbot) | Automatic (cert-manager) |
| **Horizontal backend scaling** | ❌ | ❌ | ⚠️ Requires Postgres |
| **Burst compute** | ❌ | ✅ Hetzner VMs | ✅ Hetzner VMs via orchestrator |
| **Best for** | Dev / personal | Production, cost-conscious | Production, managed, enterprise |

---

## Implementation checklist

- [x] Tier 1: `docker-compose.yml` (implemented)
- [x] Tier 2: `docker-compose.orchestrator.yml` + Hetzner orchestrator (implemented)
- [x] Tier 3: Kubernetes manifests in `k8s/cloudfleet/` (this plan)
- [ ] Tier 3: Helm chart wrapping `k8s/cloudfleet/` for easier parameterisation
- [ ] Tier 3: Litestream sidecar for SQLite → S3 replication (single replica HA)
- [ ] Tier 3: Postgres migration path for true multi-replica backend
- [ ] Tier 3: `ServiceMonitor` for Prometheus Operator
- [ ] Tier 3: CI workflow step to push images to CFCR on main branch merge
- [ ] Tier 3: Cloudfleet Charts Marketplace entry (future, post-implementation)
