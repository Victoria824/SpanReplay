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

For release images, the `Publish container images` workflow publishes linux/amd64 and linux/arm64 images to GHCR with an SBOM, provenance, attestation, and immutable commit tag. It uses `GITHUB_TOKEN`; a Docker Hub account or password is not required. The runtime images run as non-root, include health checks, and the Compose services use read-only filesystems plus `no-new-privileges`.

Run the deterministic no-container check first with `npm run demo`. The full stack needs approximately 4 GB of free memory; 8 GB assigned to the VM gives Grafana, Loki, Tempo, Prometheus, and the build stages comfortable headroom.

## Kubernetes

Build and push the two images, then update image tags in `infrastructure/kubernetes/base/spanreplay.yaml`:

```bash
docker build -t ghcr.io/victoria824/spanreplay:0.1.0 .
docker build -f Dockerfile.console -t ghcr.io/victoria824/spanreplay-console:0.1.0 .
docker push ghcr.io/victoria824/spanreplay:0.1.0
docker push ghcr.io/victoria824/spanreplay-console:0.1.0
kubectl apply --server-side -k infrastructure/kubernetes/base
```

The manifest assumes an NGINX Ingress controller and the development host `spanreplay.local`. Replace the host, add TLS, set the CORS allow-list, and place the Console/API behind organizational identity before an internet-facing deployment.

The base manifest intentionally uses one gateway replica and a local PVC. The production overlay removes that single-writer boundary, selects `S3ReplayRepository`, injects KMS/S3 and IRSA values from a non-committed environment file, runs at least two replicas, and adds PDB/HPA/topology constraints. Auth0 issuer/audience are injected at the same boundary and end-user tenant claims remain separate from AWS workload identity.

The manual `AWS production plan and deploy` workflow assumes a protected GitHub OIDC deployment role. `plan` is non-mutating; `apply` provisions S3/KMS/IRSA/ECR; `deploy` also builds immutable SHA-tagged images, pushes them to ECR, renders the production overlay, and waits for core rollouts. Both AWS and Datadog Terraform modules require persistent S3 remote state with native lockfiles. The one-time `infrastructure/terraform/aws-bootstrap` module creates that state bucket, OIDC trust, deploy role, and optional EKS access entry.

Follow [cloud account setup](cloud-account-setup.md) for the ordered AWS, Datadog, and GitHub Environment configuration. The helper script transfers Datadog keys only through encrypted GitHub Secrets and never uploads a long-lived AWS key.

## Promotion checklist

- Immutable image digests and signed artifacts.
- Separate environment credentials and collectors.
- Explicit sampling and retention policies.
- Identity-aware proxy/OIDC plus authorization for replay records.
- NetworkPolicy and outbound allow-list for real providers/tools.
- Managed replay storage with encryption, version-aware deletion, and access audit controls.
- Alert routing tested with a synthetic incident.
- Rollback command and owner recorded in the release.
