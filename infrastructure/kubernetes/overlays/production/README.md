# Production overlay

This overlay removes the gateway's single-writer PVC, switches replay evidence to S3/KMS, runs critical services and the collector with disruption budgets, spreads replicas across nodes, and adds deliberately conservative HPAs. The collector uses a bounded disk-backed queue and retry budget so a telemetry backend outage does not create unbounded memory growth.

Before rendering, copy `production.env.example` to the gitignored `production.env` and replace its three values with outputs from `infrastructure/terraform/aws`. Kustomize injects the IRSA role annotation and S3/KMS configuration. Set `OTEL_BACKEND_ENDPOINT` to the in-cluster OTLP endpoint; the checked-in default targets a Datadog Agent service, so change it if your namespace or backend differs.

```bash
cp infrastructure/kubernetes/overlays/production/production.env.example \
  infrastructure/kubernetes/overlays/production/production.env
kubectl kustomize infrastructure/kubernetes/overlays/production >/tmp/spanreplay-production.yaml
kubectl apply --server-side --dry-run=server -f /tmp/spanreplay-production.yaml
```
