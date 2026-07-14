# Space Cargo Platform

[![CI/CD GitOps Pipeline](https://github.com/Mahmoudmetwall2y/DEPI-Graduation-Project-/actions/workflows/ci.yaml/badge.svg?branch=main)](https://github.com/Mahmoudmetwall2y/DEPI-Graduation-Project-/actions/workflows/ci.yaml)
[![Kubernetes](https://img.shields.io/badge/Kubernetes-EKS-326CE5?logo=kubernetes&logoColor=white)](https://aws.amazon.com/eks/)
[![Istio](https://img.shields.io/badge/Service%20Mesh-Istio-466BB0?logo=istio&logoColor=white)](https://istio.io/)
[![Helm](https://img.shields.io/badge/Packaging-Helm-0F1689?logo=helm&logoColor=white)](https://helm.sh/)
[![License](https://img.shields.io/badge/Project-DEPI%20Graduation-0B7285)](https://mcit.gov.eg/en/Human_Capacity/MCIT/Digital_Egypt_Pioneers_Initiative)

Space Cargo is a cloud-native microservices platform built as a graduation project for the **Digital Egypt Pioneers Initiative (DEPI)**, DevOps track. It simulates cargo operations across separate Cargo, Telemetry, and Routing services, then makes the operational effects of traffic, latency, failures, and CPU load observable on AWS EKS.

The repository is intentionally designed as both an application and a DevOps demonstration: the application generates realistic operational events, while the platform proves deployment automation, service-mesh security, autoscaling, GitOps delivery, and observability.

> **Project scope:** This is an educational demonstration platform. Cargo records and chaos-test settings are stored in memory; production use would require persistent storage, identity, secrets management, TLS/domain configuration, and an environment promotion strategy.

## Highlights

- Four containerized services: a web frontend, Cargo API, Telemetry API, and Routing API.
- Private-worker-node AWS EKS architecture, provisioned with Terraform.
- A single public AWS Application Load Balancer (ALB) forwards traffic to the Istio ingress gateway.
- Istio strict mTLS, authorization policies, gateway routing, and sidecar telemetry.
- A Helm chart as the single source of truth for Kubernetes application resources.
- GitHub Actions builds, tests, publishes Docker Hub images, and updates Helm image tags for GitOps delivery.
- Ansible bootstraps the EKS administration host and installs the platform dependencies.
- Prometheus and Grafana show application, Kubernetes, HPA, service-mesh, and worker-node behaviour.
- Built-in controlled error, latency, and CPU-load simulations for a repeatable DevOps demonstration.

## Architecture

```text
                              ┌──────────────────────────────────────┐
Internet ──► AWS ALB ────────►│ Istio Ingress Gateway                │
                              │                                      │
                              │  Istio Gateway + VirtualService      │
                              └──────────────┬───────────────────────┘
                                             │
                       ┌─────────────────────┼─────────────────────┐
                       │                     │                     │
                       ▼                     ▼                     ▼
                  Frontend              Cargo Service        Other API routes
                                             │
                         ┌───────────────────┴───────────────────┐
                         ▼                                       ▼
                 Telemetry Service                        Routing Service
                         │                                       │
                         └──────── Istio mTLS / telemetry ───────┘

    EKS Prometheus ──remote write──► Central Prometheus ──► Grafana
         │                                  Monitoring Server
         └── pod, HPA, kube-state-metrics, kubelet/cAdvisor, node metrics
```

### Request flow

1. A browser sends HTTP traffic to the public ALB.
2. The ALB forwards the request to the `istio-ingressgateway` pods using IP targets.
3. Istio routes `/`, `/api/cargo`, `/api/telemetry`, and `/api/routing` to their internal `ClusterIP` Services.
4. Cargo orchestrates requests to the Telemetry and Routing services over Istio-protected mTLS connections.
5. Prometheus collects application, mesh, Kubernetes, and node metrics; Grafana turns them into operational dashboards.

## Services

| Component | Technology | Responsibility | Notable endpoints |
| --- | --- | --- | --- |
| `frontend` | Nginx + static HTML | Browser UI and reverse proxy for API calls | `/`, `/healthz` |
| `cargo-service` | Python / FastAPI | Cargo inventory and orchestration of telemetry and routing data | `/api/cargo`, `/api/cargo/{id}` |
| `telemetry-service` | Python / FastAPI | Dynamic telemetry readings and controlled CPU-load simulation | `/api/telemetry/{id}`, `/api/telemetry/simulate-load` |
| `routing-service` | Go | Destination-aware route calculation and controlled latency simulation | `/api/routing/{id}`, `/api/routing/simulate-latency` |

All backend services expose Prometheus metrics at `/metrics` and health endpoints at `/health`.

## Repository layout

```text
.
├── services/                         # Application source code and Dockerfiles
│   ├── frontend/                     # Static UI and Nginx reverse proxy
│   ├── cargo-service/                # FastAPI cargo/orchestration API
│   ├── telemetry-service/            # FastAPI telemetry and load API
│   └── routing-service/              # Go routing API
├── infrastructure/
│   ├── terraform/                    # AWS VPC, EKS, IAM, and admin-host foundation
│   ├── ansible/                      # Admin-host bootstrap and EKS deployment playbooks
│   ├── docker/                       # Local Docker Compose environment
│   ├── helm/space-cargo/             # Authoritative Kubernetes + Istio application chart
│   ├── istio/                        # AWS ALB and Istio ingress-gateway configuration
│   └── monitoring/                   # EKS Prometheus, central Prometheus, and Grafana assets
├── docs/
│   ├── PROJECT_DOCUMENTATION.md      # Architecture, operations, security, and delivery guide
│   └── DEVOPS_PRESENTATION_GUIDE.md  # File-by-file presentation reference
└── .github/workflows/ci.yaml         # Build, test, publish, and Helm tag update workflow
```

## Quick start: local development

### Prerequisites

- Docker Engine with Docker Compose v2
- Git

### Run

```bash
git clone https://github.com/Mahmoudmetwall2y/DEPI-Graduation-Project-.git
cd DEPI-Graduation-Project-

docker compose -f infrastructure/docker/compose.yaml up --build
```

Open <http://localhost:8080>. Stop the environment with:

```bash
docker compose -f infrastructure/docker/compose.yaml down
```

## Deploying to AWS EKS

The AWS platform is organised in clear layers:

| Layer | Tool | Purpose |
| --- | --- | --- |
| Foundation | Terraform | VPC, private EKS worker nodes, IAM, and administration host |
| Platform bootstrap | Ansible | AWS CLI, `kubectl`, Helm, `eksctl`, Metrics Server, AWS Load Balancer Controller, Istio, and application release |
| Application packaging | Helm | Deployments, Services, HPA, PDBs, NetworkPolicies, Istio resources, and monitoring access |
| Continuous integration | GitHub Actions | Test services, build images, push them to Docker Hub, update image tags in Helm values |
| Continuous delivery | Argo CD | Reconcile the Helm chart state from Git to EKS |
| Observability | Prometheus + Grafana | Collect, store, query, and visualise platform and service metrics |

For the complete, repeatable deployment procedure, use the following documentation rather than manually applying individual manifests:

- [Infrastructure deployment guide](infrastructure/README.md)
- [Ansible administration-host guide](infrastructure/ansible/README.md)
- [Monitoring architecture and access](infrastructure/monitoring/README.md)
- [Full project documentation](docs/PROJECT_DOCUMENTATION.md)

### Deployment principles

- The Helm chart under `infrastructure/helm/space-cargo/` is the authoritative application deployment source.
- Application Services and the Istio gateway use `ClusterIP`; **one ALB** is created only for the Istio ingress gateway.
- EKS workers run in private subnets. The administration host accesses the EKS API with IAM authentication.
- Docker images are published to `docker.io/mahmoudmetwall2y`.
- Do not commit Docker Hub tokens, AWS credentials, private keys, Terraform state, or Grafana credentials.

## CI/CD and GitOps workflow

```text
Developer push
     │
     ▼
GitHub Actions
  ├── Test Python and Go services
  ├── Build four Docker images
  ├── Push immutable SHA-tagged images to Docker Hub
  └── Commit the SHA image tags to Helm values
     │
     ▼
Argo CD watches main
     │
     ▼
Helm release reconciled on EKS
```

Pull requests build and test images without publishing them. A push to `main` publishes the images and updates the image tags in `values.yaml`; Argo CD can then synchronise that desired state to the cluster.

## Demonstrating the platform

Set the public ALB hostname once:

```bash
export APP_URL="http://<your-alb-dns-name>"
```

### 1. Verify the end-to-end application

```bash
curl "$APP_URL/"
curl "$APP_URL/api/cargo"
curl "$APP_URL/api/cargo/CRG-101"
curl "$APP_URL/api/telemetry/CRG-101"
curl "$APP_URL/api/routing/CRG-101?destination=Mars"
```

### 2. Generate traffic and observe it

```bash
for i in {1..20}; do
  curl -fsS "$APP_URL/api/cargo/CRG-101" > /dev/null
done
```

Watch **Request Rate by Service**, **Istio HTTP Responses by Status**, and **mTLS Mesh Request Rate** in Grafana.

### 3. Demonstrate controlled latency

```bash
curl -X POST "$APP_URL/api/cargo/simulate-latency" \
  -H 'Content-Type: application/json' \
  -d '{"latency_ms":750}'

curl "$APP_URL/api/cargo/CRG-101"

# Reset when the demonstration is complete.
curl -X POST "$APP_URL/api/cargo/simulate-latency" \
  -H 'Content-Type: application/json' \
  -d '{"latency_ms":0}'
```

Watch **p95 Service Latency**.

### 4. Demonstrate controlled errors

```bash
curl -X POST "$APP_URL/api/cargo/simulate-errors" \
  -H 'Content-Type: application/json' \
  -d '{"rate":0.5}'

for i in {1..20}; do
  curl -s -o /dev/null -w '%{http_code}\n' "$APP_URL/api/cargo/CRG-101"
done

# Always reset the error rate after the test.
curl -X POST "$APP_URL/api/cargo/simulate-errors" \
  -H 'Content-Type: application/json' \
  -d '{"rate":0}'
```

Watch **Cargo 5xx Responses** and **Istio HTTP Responses by Status**. The 5xx card evaluates the last five minutes, so it clears shortly after the test window expires.

### 5. Demonstrate HPA and worker-node pressure

```bash
curl -X POST "$APP_URL/api/telemetry/simulate-load" \
  -H 'Content-Type: application/json' \
  -d '{"duration_seconds":90,"cores":2}'
```

Watch **Telemetry Load and Autoscaling**, **Telemetry HPA Replicas**, and **Worker Node CPU Usage**. HPA scale-down is deliberately slower than scale-up, so allow a few minutes for replicas to return to baseline.

## Observability

The Grafana dashboard, **Space Cargo | EKS Operations Center**, provides a single view of:

- Prometheus scrape health for backend services
- Pod readiness, pending pods, and backend availability
- Per-service request rate and p95 latency
- Application error simulation and Istio HTTP status codes
- Istio mutual-TLS request traffic
- Telemetry load and HPA decisions
- Worker-node CPU and memory utilisation

Prometheus records the raw metrics. Grafana refreshes every 15 seconds; allow roughly one scrape interval before expecting a newly generated test signal to appear.

## Security and reliability controls

- Private EKS worker nodes with an EC2 administration host for controlled cluster access
- IAM-based EKS authentication and least-privilege service accounts
- Istio strict mTLS for in-mesh service communication
- Istio `AuthorizationPolicy` controls workload-to-workload access
- Kubernetes NetworkPolicies, non-root containers, read-only root filesystems where applicable, and resource requests/limits
- Liveness and readiness probes, PodDisruptionBudgets, and telemetry-service HPA
- A single ALB entry point; no public backend Service exposure

## Documentation

| Document | Use it for |
| --- | --- |
| [Project documentation](docs/PROJECT_DOCUMENTATION.md) | Architecture, tools, security design, operations, and delivery lifecycle |
| [Presentation guide](docs/DEVOPS_PRESENTATION_GUIDE.md) | Explaining every DevOps file during the supervisor presentation |
| [Infrastructure README](infrastructure/README.md) | Infrastructure component overview and core installation commands |
| [Ansible README](infrastructure/ansible/README.md) | Repeatable EKS administration-host deployment |
| [Monitoring README](infrastructure/monitoring/README.md) | Prometheus/Grafana data flow and access model |

## Team notes

This repository is maintained as a collaborative graduation project. Keep infrastructure changes reviewable, avoid committing secrets, use immutable image tags, and let Helm/Argo CD own the desired application state.
