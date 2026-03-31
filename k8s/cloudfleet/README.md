# LCYT — Cloudfleet / Kubernetes deployment manifests

This directory contains Kubernetes manifests for deploying LCYT on a
[Cloudfleet](https://cloudfleet.ai) managed cluster (or any standard
Kubernetes cluster).

## Quick start

```bash
# 1. Edit secrets (fill in real values — do NOT commit to version control)
cp k8s/cloudfleet/01-secret.yaml /tmp/lcyt-secret.yaml
$EDITOR /tmp/lcyt-secret.yaml

# 2. Apply all manifests
kubectl apply -f k8s/cloudfleet/00-namespace.yaml
kubectl apply -f /tmp/lcyt-secret.yaml
kubectl apply -f k8s/cloudfleet/02-configmap.yaml
kubectl apply -f k8s/cloudfleet/03-pvc.yaml
kubectl apply -f k8s/cloudfleet/10-backend-deployment.yaml
kubectl apply -f k8s/cloudfleet/11-backend-service.yaml
kubectl apply -f k8s/cloudfleet/20-mediamtx-configmap.yaml
kubectl apply -f k8s/cloudfleet/21-mediamtx-deployment.yaml
kubectl apply -f k8s/cloudfleet/22-mediamtx-service.yaml
kubectl apply -f k8s/cloudfleet/30-ingress.yaml
```

Or apply the non-secret files all at once:

```bash
kubectl apply -f k8s/cloudfleet/
```

## Files

| File | Purpose |
|------|---------|
| `00-namespace.yaml` | `lcyt` Kubernetes namespace |
| `01-secret.yaml` | Sensitive env vars (JWT_SECRET, ADMIN_KEY, …) — **edit before applying** |
| `02-configmap.yaml` | Non-sensitive env vars (domains, feature flags, …) |
| `03-pvc.yaml` | PersistentVolumeClaim for SQLite database |
| `10-backend-deployment.yaml` | `lcyt-backend` Deployment |
| `11-backend-service.yaml` | `lcyt-backend` ClusterIP Service |
| `20-mediamtx-configmap.yaml` | MediaMTX configuration file |
| `21-mediamtx-deployment.yaml` | `mediamtx` Deployment |
| `22-mediamtx-service.yaml` | `mediamtx` Services (ClusterIP + LoadBalancer for RTMP) |
| `30-ingress.yaml` | nginx Ingress + TLS (cert-manager) |
| `40-orchestrator-deployment.yaml` | `lcyt-orchestrator` Deployment (distributed mode only) |
| `41-orchestrator-service.yaml` | `lcyt-orchestrator` ClusterIP Service |

## Image configuration

Update the `image:` fields in deployment manifests to use your registry.
On Cloudfleet, push images to the Cloudfleet Container Registry (CFCR):

```bash
REGISTRY=registry.<your-cluster>.cloudfleet.io

docker build -t $REGISTRY/lcyt/lcyt-site:latest .
docker push $REGISTRY/lcyt/lcyt-site:latest

docker build -t $REGISTRY/lcyt/lcyt-ffmpeg:latest docker/lcyt-ffmpeg/
docker push $REGISTRY/lcyt/lcyt-ffmpeg:latest

# Distributed mode only (FFMPEG_RUNNER=worker):
docker build -t $REGISTRY/lcyt/lcyt-worker-daemon:latest packages/lcyt-worker-daemon/
docker push $REGISTRY/lcyt/lcyt-worker-daemon:latest
```

Then update `image:` in `10-backend-deployment.yaml` and
`21-mediamtx-deployment.yaml`.

## Prerequisites on the cluster

- **nginx Ingress Controller** (install via Cloudfleet Charts Marketplace or
  `kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/...`)
- **cert-manager** with a `ClusterIssuer` named `letsencrypt-prod`
  (install via Cloudfleet Charts Marketplace or `helm install cert-manager`)
- For Cloudfleet on Hetzner: the default StorageClass `hcloud-volumes` is used
  by the PVC. Adjust `storageClassName` if using a different provider.

## See also

- `docs/plans/plan_cloudfleet.md` — full hosting mode comparison and plan
- `docs/DEPLOY.md` — Tier 1 (single VM) and Tier 2 (orchestrator) guides
- `.env.example` — complete list of supported environment variables
