# Deployment guide

## Docker Compose

Docker Desktop and Colima both expose a standard Docker Engine API, so SpanReplay uses the same commands with either runtime.

```bash
# Colima option on macOS
brew install colima docker docker-compose
colima start --cpu 4 --memory 8

docker version
docker compose version
docker compose config --quiet
docker compose up --build
```

Run the deterministic no-container check first with `npm run demo`. The full stack needs approximately 4 GB of free memory; 8 GB assigned to the VM gives Grafana, Loki, Tempo, Prometheus, and the build stages comfortable headroom.

## Kubernetes

Build and push the two images, then update image tags in `infrastructure/kubernetes/spanreplay.yaml`:

```bash
docker build -t ghcr.io/victoria824/spanreplay:0.1.0 .
docker build -f Dockerfile.console -t ghcr.io/victoria824/spanreplay-console:0.1.0 .
docker push ghcr.io/victoria824/spanreplay:0.1.0
docker push ghcr.io/victoria824/spanreplay-console:0.1.0
kubectl apply --server-side -f infrastructure/kubernetes/spanreplay.yaml
```

The manifest assumes an NGINX Ingress controller and the development host `spanreplay.local`. Replace the host, add TLS, set the CORS allow-list, and place the Console/API behind organizational identity before an internet-facing deployment.

The local file-backed replay store is mounted on a PVC and the gateway intentionally runs one replica. Before scaling it, replace `ReplayStore` with an approved shared datastore that implements authentication, encryption, tenant isolation, retention, and deletion.

## Promotion checklist

- Immutable image digests and signed artifacts.
- Separate environment credentials and collectors.
- Explicit sampling and retention policies.
- Identity-aware proxy/OIDC plus authorization for replay records.
- NetworkPolicy and outbound allow-list for real providers/tools.
- Managed replay storage with backups and deletion controls.
- Alert routing tested with a synthetic incident.
- Rollback command and owner recorded in the release.

