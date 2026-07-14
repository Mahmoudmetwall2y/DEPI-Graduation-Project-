# Space Cargo Platform

## Overview

Space Cargo is a cloud-native microservices platform created for the DEPI DevOps track. It models cargo operations and includes controlled error, latency, and CPU-load scenarios so Kubernetes, Istio, autoscaling, and monitoring behaviour can be demonstrated safely.

The platform combines Docker, Terraform, Ansible, Amazon EKS, Helm, Istio, GitHub Actions, Argo CD, Prometheus, and Grafana into one delivery workflow.

## Architecture

```text
Internet
   |
   v
AWS Application Load Balancer
   |
   v
Istio ingress gateway on Amazon EKS
   |
   v
Istio Gateway and VirtualService
   |-------------------------------|
   v              v                v
frontend      cargo-service   telemetry-service
                  |
                  v
             routing-service

EKS Prometheus -> private remote write -> Monitoring Server Prometheus -> Grafana
```

The Application Load Balancer is the only public application entry point. The application Services are `ClusterIP`, so they are available only inside the cluster. Istio routes requests from the ingress gateway to the correct service.

## Microservices

| Service | Technology | Responsibility | Public path |
|---|---|---|---|
| `frontend` | Nginx, HTML, CSS, JavaScript | Serves the dashboard. | `/` |
| `cargo-service` | Python and FastAPI | Stores cargo records and calls telemetry and routing. | `/api/cargo` |
| `telemetry-service` | Python and FastAPI | Produces telemetry data and controlled CPU load. | `/api/telemetry/{cargo_id}` |
| `routing-service` | Go | Calculates routes and supports latency injection. | `/api/routing/{cargo_id}` |

Cargo data and simulation settings are currently stored in memory. Therefore, `cargo-service` intentionally uses one replica until a persistent database is introduced.

### Demonstration controls

- `POST /api/cargo/simulate-errors` sets a cargo-service error rate.
- `POST /api/cargo/simulate-latency` injects latency into routing requests.
- `POST /api/telemetry/simulate-load` starts bounded telemetry CPU load.

These endpoints are for a controlled educational environment and must be protected or removed before a production deployment.

## Repository layout

```text
services/                         Application source and Dockerfiles
infrastructure/
  terraform/                      AWS VPC, EKS, IAM, and administration host
  ansible/                        Repeatable platform bootstrap and deployment
  docker/                         Local Docker Compose environment
  helm/space-cargo/               Authoritative application Helm chart
  istio/                          AWS ALB and Istio gateway configuration
  monitoring/                     Prometheus, Grafana, Nginx, and systemd config
.github/workflows/ci.yaml         CI image build and GitOps image-tag updates
docs/                             Project and presentation documentation
```

## Infrastructure and deployment

### Terraform

`infrastructure/terraform` defines the AWS foundation: VPC, public and private subnets, NAT gateway, IAM roles, private EKS endpoint, worker nodes, and the EKS administration host. Terraform creates cloud infrastructure; it does not deploy the application.

```bash
cd infrastructure/terraform
terraform init
terraform plan
terraform apply
```

Review every plan before applying it. Never commit Terraform state, plans, or secret variable files.

### Ansible

Ansible runs on the EKS administration EC2 host, which has private access to the EKS API. It installs AWS CLI, `kubectl`, Helm, and `eksctl`; then deploys Metrics Server, AWS Load Balancer Controller, Istio, and the application.

```bash
cd infrastructure/ansible
cp group_vars/all.yml.example group_vars/all.yml
# Set the actual EKS cluster and region values.
ansible-playbook playbooks/site.yml
```

The playbooks use idempotent operations and can be rerun safely.

### Helm and Istio

The `space-cargo` chart is the single application source of truth. It renders Deployments, Services, ServiceAccounts, probes, resource controls, PodDisruptionBudgets, HPA, NetworkPolicies, and Istio resources.

| Path | Destination |
|---|---|
| `/api/cargo` | `cargo-service:8000` |
| `/api/telemetry` | `telemetry-service:8000` |
| `/api/routing` | `routing-service:8000` |
| `/` | `frontend:8080` |

Istio enforces strict mTLS between workloads. DestinationRules use `ISTIO_MUTUAL`, connection-pool limits, and outlier detection. Kubernetes NetworkPolicies and Istio AuthorizationPolicies reduce permitted east-west traffic paths.

Validate the chart before deployment:

```bash
helm lint infrastructure/helm/space-cargo
helm template space-cargo infrastructure/helm/space-cargo --namespace space-cargo
```

## Monitoring and observability

```text
EKS Prometheus Server
  - Kubernetes service discovery
  - kube-state-metrics
  - worker node-exporter metrics
  - kubelet cAdvisor metrics
  - cargo, telemetry, and routing /metrics endpoints
                 |
                 | private remote write
                 v
Monitoring Server
  - central Prometheus storage
  - Grafana dashboards
  - node-exporter for server health
```

The in-cluster Prometheus server runs in `monitoring-agent`, discovers and scrapes Kubernetes and application targets, and exposes their current status. It remote-writes metrics over the private VPC to central Prometheus on the monitoring server. Grafana queries central Prometheus for dashboards.

This covers worker-node resources, Kubernetes workload state, pod/container resource use, and application metrics. The EKS control-plane operating-system internals are AWS-managed and are not exposed as worker-node metrics.

See [`../infrastructure/monitoring/README.md`](../infrastructure/monitoring/README.md) for monitoring deployment and access details.

## CI/CD and GitOps

GitHub Actions provides continuous integration:

1. Test Python and Go services.
2. Build the four Docker images.
3. Push images to Docker Hub for `main` branch changes.
4. Update immutable image tags in Helm values.

Argo CD provides continuous delivery. It watches the repository and reconciles the Helm chart into EKS:

```text
Developer push -> GitHub Actions -> Docker Hub and Helm image-tag commit
                                             |
                                             v
                                         Argo CD sync
                                             |
                                             v
                                           Amazon EKS
```

After Argo CD owns the application, CI must change desired state in Git rather than deploy directly to the cluster.

## Security controls

- Private EKS API endpoint accessed through an authorized administration host.
- IAM roles and EKS access entries instead of static cloud credentials.
- Docker Hub token stored as a GitHub secret, never in Git.
- Non-root workload settings, health probes, resource limits, and dedicated ServiceAccounts.
- Kubernetes NetworkPolicies and Istio AuthorizationPolicies.
- Istio strict mTLS for service-to-service traffic.
- Private VPC path for Prometheus remote write.

For production, restrict Grafana and Prometheus by source IP or VPN, use TLS with trusted certificates, protect public monitoring interfaces, add alerting and backups, and replace in-memory cargo state with managed persistent storage.

## Verification

Run these commands from the EKS administration host:

```bash
kubectl get nodes
kubectl get pods -n space-cargo
kubectl get pods -n istio-system
kubectl get pods -n monitoring-agent
kubectl get hpa -n space-cargo
kubectl get ingress istio-ingressgateway -n istio-system
```

```bash
kubectl wait --for=condition=Available deployment --all \
  --namespace space-cargo --timeout=10m
```

To inspect live EKS Prometheus targets without relying on a public address:

```bash
kubectl port-forward -n monitoring-agent service/prometheus-server 9090:9090
# Open http://localhost:9090/targets
```
