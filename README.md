# DEPI DevOps Graduation Project

A microservices demonstration platform for the Digital Egypt Pioneers Initiative (DEPI) DevOps track. The application models cargo, telemetry, and routing operations and includes controlled failure, latency, and CPU-load scenarios for observing Kubernetes and Istio behavior.

## Repository layout

```text
services/
  frontend/              Static dashboard and Nginx reverse proxy
  cargo-service/         Python/FastAPI orchestration API
  telemetry-service/     Python/FastAPI telemetry and load API
  routing-service/       Go routing and latency API
infrastructure/
  terraform/              AWS VPC, EKS, IAM, and administration-host definitions
  ansible/                Repeatable EKS administration and deployment playbooks
  docker/                Local Docker Compose environment
  helm/space-cargo/      Kubernetes and Istio application Helm chart
  istio/                 AWS ALB gateway values and Ingress manifest
  monitoring/            In-cluster Prometheus and monitoring-server configuration
```

See [`infrastructure/README.md`](infrastructure/README.md) for deployment commands and prerequisites.

See [`docs/PROJECT_DOCUMENTATION.md`](docs/PROJECT_DOCUMENTATION.md) for architecture, operations, security, and delivery documentation. The [`docs/DEVOPS_PRESENTATION_GUIDE.md`](docs/DEVOPS_PRESENTATION_GUIDE.md) provides a detailed file-by-file presentation reference.

## Architecture notes

The browser reaches the frontend and APIs through the Istio ingress gateway. The cargo service calls telemetry and routing internally. Istio enforces strict mTLS and workload authorization, while Kubernetes provides probes, resource controls, disruption budgets, restricted pod security, network policy, and telemetry HPA behavior.

Cargo records and chaos settings are currently in memory. For that reason, the cargo deployment intentionally has one replica. A later production phase should move this state to a database before enabling horizontal scaling.
