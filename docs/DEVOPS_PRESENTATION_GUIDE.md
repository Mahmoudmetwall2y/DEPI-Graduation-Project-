# DEPI DevOps Layer — Supervisor Presentation Guide

This document explains the DevOps layer of the Space Cargo microservices project. It is written as a presentation reference: it describes what every infrastructure and containerization file does, why each decision was made, how the files work together, and what should happen later in CI/CD.

## 1. Executive summary

The application contains four independently containerized services:

| Service | Technology | Responsibility | Internal port |
|---|---|---|---:|
| `frontend` | Nginx, HTML, CSS, JavaScript | Serves the dashboard | 8080 |
| `cargo-service` | Python and FastAPI | Stores cargo records and coordinates telemetry and routing calls | 8000 |
| `telemetry-service` | Python and FastAPI | Produces telemetry and controlled CPU load | 8000 |
| `routing-service` | Go | Calculates routes and supports controlled latency injection | 8000 |

The DevOps layer provides:

- Docker images for each service.
- Docker Compose for local integration.
- A Helm chart as the authoritative Kubernetes application definition.
- Secure Kubernetes workloads, Services, identities, health checks, resources, autoscaling, disruption protection, and network policies.
- Istio ingress routing, strict mutual TLS, resilience rules, and workload authorization.
- One AWS Application Load Balancer in front of the Istio ingress gateway on Amazon EKS.
- Terraform definitions for the private AWS VPC, EKS cluster, IAM roles, and administration host.
- Prometheus and Grafana monitoring for worker nodes, Kubernetes workloads, and application metrics.
- A structure that can later be consumed by GitHub Actions and Argo CD.

## 2. Deployment architecture

```text
Internet user
     |
     v
AWS Application Load Balancer
  - internet-facing
  - Layer 7 entry point
  - IP targets
     |
     v
Istio ingress gateway pods (istio-system)
     |
     v
Istio Gateway + VirtualService (space-cargo)
     |
     +-- /api/cargo*     --> cargo-service:8000
     +-- /api/telemetry* --> telemetry-service:8000
     +-- /api/routing*   --> routing-service:8000
     +-- everything else --> frontend:8080
                                  |
                                  v
                         Browser dashboard

cargo-service --> telemetry-service
cargo-service --> routing-service
```

Only the ALB Ingress is public. The Istio ingress gateway and the four application Services use `ClusterIP`, so they are reachable only from inside the cluster.

The ALB forwards all traffic for `/` to the Istio ingress gateway without defining application-specific routes. Istio remains responsible for application routing, timeouts, mTLS, and authorization.

## 3. Repository structure

```text
services/
  frontend/
  cargo-service/
  telemetry-service/
  routing-service/

infrastructure/
  terraform/
    EKS.tf
    IAM.tf
    ec2.tf
    vpc.tf
  ansible/
  docker/
    compose.yaml
  helm/
    space-cargo/
      Chart.yaml
      values.yaml
      .helmignore
      templates/
  istio/
    aws-alb-gateway-values.yaml
    aws-alb-ingress.yaml
  monitoring/
    prometheus-server/
    monitoring-server/
  README.md
```

There are two separate Helm responsibilities:

1. The official `istio/base`, `istio/cni`, `istio/istiod`, and `istio/gateway` charts install the service-mesh platform.
2. Our `space-cargo` chart installs the application and its application-specific Istio policies.

This separation is intentional. The Istio platform has its own lifecycle and can be upgraded independently from the application.

---

## 4. Local Docker layer

### `infrastructure/docker/compose.yaml`

This file starts the complete application locally without Kubernetes.

#### `services`

The top-level `services` mapping declares the four containers.

#### Frontend

```yaml
frontend:
  build:
    context: ../../services/frontend
  ports:
    - "8080:8080"
```

- `build.context` points Compose to the frontend Docker build directory.
- The host's port `8080` is forwarded to port `8080` in the container.
- The dashboard is therefore available at `http://localhost:8080`.

`depends_on` starts the backend containers before the frontend container. It controls startup order, but it does not prove that the applications are healthy.

`read_only: true` prevents writes to the frontend container's root filesystem. Nginx still needs temporary writable locations, so `/var/cache/nginx` and `/var/run` are mounted as in-memory `tmpfs` filesystems.

#### Cargo service

The cargo container exposes host port `8000` and receives two environment variables:

```yaml
TELEMETRY_SERVICE_URL: http://telemetry-service:8000
ROUTING_SERVICE_URL: http://routing-service:8000
```

Compose provides internal DNS using service names. The cargo service therefore calls `telemetry-service` and `routing-service` without hard-coded container IP addresses.

#### Telemetry and routing

- Telemetry maps host port `8002` to container port `8000`.
- Routing maps host port `8003` to container port `8000`.
- The different host ports avoid conflicts, while all backend containers use a consistent internal port.

#### Network and restart policy

All containers join `space-network`, a bridge network used for local service discovery and isolation. `restart: unless-stopped` restarts containers after failures or Docker daemon restarts unless an operator explicitly stops them.

---

## 5. Containerization files

### `services/frontend/Dockerfile`

This image uses `nginx:1.27.5-alpine`, a small Nginx distribution.

It performs three main actions:

1. Copies the custom Nginx configuration into `/etc/nginx/conf.d/default.conf`.
2. Copies the static frontend assets into `/usr/share/nginx/html/`.
3. Runs as Nginx's unprivileged UID `101` rather than root.

The container listens on port `8080`, because non-root processes cannot normally bind to privileged ports below 1024.

The Docker `HEALTHCHECK` requests `/healthz`. This allows Docker to detect whether Nginx is serving HTTP successfully.

### `services/frontend/nginx.conf`

This is both the static web server configuration and the local reverse proxy.

- `listen 8080` supports non-root execution.
- `server_name _` accepts any host name.
- `server_tokens off` reduces unnecessary version disclosure.
- `try_files $uri $uri/ /index.html` supports a single-page application fallback.
- `/healthz` returns a lightweight JSON health response without application dependencies.
- `/api/cargo`, `/api/telemetry`, and `/api/routing` proxy API calls to Compose service names.
- Connection and read timeouts prevent requests from hanging forever.
- Security response headers reduce MIME sniffing, framing, and unsafe referrer behavior.

In EKS, Istio routes API paths directly to backend Services, so the Nginx proxy is primarily useful for Docker Compose and as a fallback.

### `services/frontend/.dockerignore`

This file prevents Git metadata, Dockerfiles, and unrelated documentation from being sent into the Docker build context. A smaller context improves build speed and reduces accidental data inclusion.

### `services/cargo-service/Dockerfile`

The cargo image uses Python `3.12.11-slim-bookworm`.

Security and runtime decisions:

- Creates UID and GID `10001` for a dedicated application identity.
- Uses `/usr/sbin/nologin`, preventing interactive shell login for that identity.
- Installs dependencies with the pip cache disabled.
- Copies only the application code after dependencies, allowing Docker to reuse the dependency layer when source code changes.
- Changes file ownership and runs as `appuser`.
- Sets `PYTHONDONTWRITEBYTECODE=1` so Python does not create `.pyc` files.
- Sets `PYTHONUNBUFFERED=1` so logs are emitted immediately to the container log stream.
- Starts Uvicorn with `exec`, allowing the server process to receive Kubernetes termination signals correctly.

Default service URLs use Kubernetes and Compose DNS names and may be overridden through environment variables.

### `services/cargo-service/requirements.txt`

This file pins the application dependencies:

- `fastapi`: API framework.
- `uvicorn`: ASGI application server.
- `requests`: synchronous HTTP calls from cargo to telemetry and routing.
- `prometheus-client`: Prometheus metrics endpoint.

Exact versions improve repeatability: the same dependency versions are installed locally, in CI, and in production.

### `services/cargo-service/.dockerignore`

Excludes Python caches, virtual environments, compiled Python files, and Git metadata from the image build context.

### `services/telemetry-service/Dockerfile`

This follows the same secure Python pattern as the cargo image:

- Pinned slim Python base.
- Dedicated non-root UID/GID `10001`.
- Cached dependency layer.
- Immediate logging and no generated bytecode.
- Uvicorn bound to all container interfaces on the configured port.

Using the same runtime identity across Python services simplifies Kubernetes security configuration.

### `services/telemetry-service/requirements.txt`

Pins FastAPI, Uvicorn, and the Prometheus client. Telemetry does not need `requests`, because it does not call another service.

### `services/telemetry-service/.dockerignore`

Excludes local and generated Python content from the Docker context.

### `services/routing-service/Dockerfile`

The Go image uses a multi-stage build.

#### Builder stage

- Uses `golang:1.24.5-alpine` to compile the service.
- Copies `go.mod` before the source to improve dependency caching.
- Runs `go mod download` to download dependencies.
- Uses `CGO_ENABLED=0` to produce a static Linux binary.
- Uses `-trimpath` and `-ldflags="-s -w"` to remove build paths, symbol tables, and debug information from the final binary.

#### Runtime stage

- Uses a small Alpine runtime rather than shipping the Go compiler.
- Installs CA certificates for possible outbound TLS calls.
- Creates non-root UID/GID `10001`.
- Copies only the compiled binary from the builder stage.

This produces a smaller image with a much smaller attack surface.

`go.sum` should still be generated with `go mod tidy` and committed before CI is finalized. The current Docker build works without copying it, but committing it gives stronger dependency integrity and reproducibility.

### `services/routing-service/go.mod`

Defines:

- The Go module name.
- The expected Go language version.
- The Prometheus client dependency.

### `services/routing-service/.dockerignore`

Excludes Git metadata and any locally compiled `routing-service` binary.

---

## 6. Helm chart metadata and values

### `infrastructure/helm/space-cargo/Chart.yaml`

This identifies the directory as a Helm 3 application chart.

- `apiVersion: v2`: Helm chart API version.
- `name: space-cargo`: chart name.
- `type: application`: the chart deploys an application, rather than acting as a reusable library.
- `version: 0.1.0`: chart package version. Increase this when the chart itself changes.
- `appVersion: "1.0.0"`: informational application version.
- `kubeVersion: ">=1.28.0-0"`: refuses installation on unsupported older Kubernetes clusters.

Chart version and application version are different concepts. A chart can change without changing application code, and application images can change without redesigning the chart.

### `infrastructure/helm/space-cargo/values.yaml`

This file contains the chart's default configuration. It is ordinary YAML, not a template. Files under `templates/` read these values.

#### Global image configuration

```yaml
global:
  imageRegistry: docker.io/mahmoudmetwall2y
  imagePullPolicy: IfNotPresent
```

- All images come from the stated Docker Hub namespace.
- `IfNotPresent` avoids downloading an unchanged versioned image repeatedly.
- Each service has its own image and tag, allowing independent releases.

CI will eventually replace tags such as `0.1.0` with immutable commit tags, for example `sha-3a309df`.

#### Per-service configuration

Each service entry defines:

- Image repository and tag.
- Desired replica count.
- service/container port.
- health endpoint.
- ServiceAccount name.
- runtime UID.
- CPU and memory requests/limits.
- optional writable volumes.
- optional environment variables.
- PDB and autoscaling settings.

Cargo intentionally uses one replica because its cargo database and chaos configuration are stored in process memory. Multiple replicas would have inconsistent state.

Telemetry enables autoscaling because it includes a controlled CPU load endpoint designed to demonstrate HPA behavior.

#### Network policy switch

`networkPolicy.enabled` allows the policies to be disabled for troubleshooting or for a cluster that does not enforce Kubernetes NetworkPolicy.

#### Istio settings

The Istio section controls:

- Whether application-specific mesh resources are rendered.
- The mesh trust domain used in workload identities.
- Gateway name.
- Ingress gateway namespace and ServiceAccount.
- Accepted hosts.
- mTLS mode.
- AuthorizationPolicy generation.

Using `"*"` as the host is useful before a domain exists. Production should replace it with the actual DNS name.

### `infrastructure/helm/space-cargo/.helmignore`

Prevents Git metadata, README files, and already packaged `.tgz` charts from being included when Helm packages the chart.

---

## 7. Helm templates: Kubernetes resources

### `templates/_helpers.tpl`

This file defines reusable Helm helper functions rather than Kubernetes resources.

- `space-cargo.name` computes a safe chart/application name.
- `space-cargo.fullname` supports optional naming overrides.
- `space-cargo.labels` generates shared Kubernetes recommended labels.

Helpers reduce duplication and keep labels consistent across resources.

### `templates/namespace.yaml`

Optionally creates the application namespace when `namespace.create` is enabled.

It labels the namespace for:

- Automatic Istio sidecar injection.
- Restricted Pod Security enforcement.
- Restricted-policy audit and warnings.

The default is `create: false` because Helm and Argo CD commonly deploy into a namespace created or managed by the platform/bootstrap layer. For manual deployment, the namespace is created and labeled before installing the chart.

### `templates/serviceaccounts.yaml`

Creates one ServiceAccount for each service.

`automountServiceAccountToken: false` prevents Kubernetes API credentials from being mounted into application pods. These applications do not call the Kubernetes API, so giving them tokens would create unnecessary risk.

Separate identities are important for Istio authorization: policies can distinguish the cargo workload from frontend, telemetry, or routing.

### `templates/services.yaml`

Creates one internal `ClusterIP` Service per application component.

Each Service:

- Selects pods using `app.kubernetes.io/name`.
- Exposes a named port called `http`.
- Forwards to the container's named `http` port.
- Uses TCP.

Named ports help Kubernetes probes and Istio understand the application protocol consistently.

No application Service uses `LoadBalancer` or `NodePort`. This guarantees that the Istio ingress gateway is the single public entry point.

### `templates/deployments.yaml`

This template loops over every entry under `services` and generates a Deployment.

#### Replicas and HPA ownership

When autoscaling is enabled, the template omits `spec.replicas`. This prevents Helm from continuously resetting a replica count managed by the HPA.

#### Rolling updates

```yaml
maxUnavailable: 0
maxSurge: 1
```

Kubernetes starts one replacement pod before removing an old pod. For replicated services this avoids planned downtime during upgrades.

#### Pod security

The pod-level security context:

- Requires non-root execution.
- Uses the UID/GID configured for that service.
- Configures a filesystem group.
- Uses the runtime-default seccomp profile.

The container security context:

- Blocks privilege escalation.
- Makes the root filesystem read-only.
- Drops every Linux capability.

Frontend receives only two writable `emptyDir` volumes required by Nginx.

#### Health probes

- `startupProbe` gives a container up to 60 seconds to start before liveness checks can restart it.
- `readinessProbe` controls whether the pod receives Service traffic.
- `livenessProbe` detects a stuck application and triggers a restart.

Probes use named ports and service-specific health paths.

#### Resources

Requests inform the Kubernetes scheduler and form the baseline used by CPU HPA calculations. Limits prevent a single container from consuming excessive node resources.

#### Graceful shutdown

`terminationGracePeriodSeconds: 30` gives the service and Istio sidecar time to finish existing requests during termination.

### `templates/hpa.yaml`

Generates an `autoscaling/v2` HorizontalPodAutoscaler only for services with autoscaling enabled.

Telemetry is configured with:

- Minimum 2 replicas.
- Maximum 6 replicas.
- CPU target of 65% of its requested CPU.
- A 300-second scale-down stabilization window.
- Scale-down limited to 50% per minute.

Fast scale-up handles load; slower scale-down avoids replica count oscillation after short load spikes.

Metrics Server is required because the HPA reads pod CPU utilization from the Kubernetes resource metrics API.

### `templates/pdb.yaml`

Creates PodDisruptionBudgets for replicated services.

`minAvailable: 1` requires at least one pod to remain available during voluntary disruptions such as node draining or managed-node upgrades.

Cargo does not receive a PDB because it has only one replica. A one-replica PDB with `minAvailable: 1` could block legitimate node maintenance indefinitely.

### `templates/networkpolicy.yaml`

The first policy selects every application pod and denies all ingress and egress by default.

The allow policy then permits only required paths:

- Traffic between application pods in `space-cargo`.
- Ingress from the `istio-system` namespace.
- Egress to `istiod` on TCP `15012` for Envoy xDS configuration.
- TCP and UDP DNS queries to `kube-system` on port 53.

Kubernetes NetworkPolicy is additive. The default-deny policy establishes the boundary, and later policies add explicit allowed flows.

The EKS CNI must have network-policy enforcement enabled, or another compatible policy engine such as Cilium must be installed. Creating the objects alone does not guarantee enforcement by every CNI.

---

## 8. Helm templates: Istio resources

### `templates/istio.yaml`

This file renders the application's Istio traffic-management and transport-security resources.

#### Gateway

The Istio Gateway selects ingress gateway pods using:

```yaml
istio: ingressgateway
```

It currently accepts HTTP on port 80 for all hosts. HTTPS should be added after selecting a domain and certificate strategy.

#### VirtualService

The VirtualService owns Layer 7 routing:

| Match | Destination | Timeout |
|---|---|---:|
| `/api/cargo` prefix | `cargo-service:8000` | 10s |
| `/api/telemetry` prefix | `telemetry-service:8000` | 10s |
| `/api/routing` prefix | `routing-service:8000` | 15s |
| Default route | `frontend:8080` | 10s |

Routing rules are ordered from specific API paths to the catch-all frontend route. If the frontend route came first, it would capture every request.

#### PeerAuthentication

`STRICT` mTLS means workloads in the namespace accept only authenticated encrypted mesh traffic through Istio.

#### DestinationRules

One DestinationRule is generated for each application Service.

It configures:

- `ISTIO_MUTUAL` TLS using certificates managed by Istio.
- Maximum TCP connection counts.
- HTTP pending-request and connection-reuse limits.
- Outlier detection that temporarily ejects endpoints after repeated HTTP 5xx failures.

This provides transport encryption and basic resilience without changing application code.

### `templates/authorization-policy.yaml`

This file implements workload-level zero-trust authorization.

Istio workload identities use SPIFFE-style principals:

```text
<trust-domain>/ns/<namespace>/sa/<service-account>
```

The chart computes principals from values and the Helm release namespace rather than hard-coding the application namespace.

The first empty AuthorizationPolicy establishes default deny. Additional ALLOW policies permit:

- Istio ingress gateway to reach the frontend.
- Istio ingress gateway and frontend identity to reach cargo.
- Ingress, frontend, and cargo identities to reach telemetry.
- Ingress, frontend, and cargo identities to reach routing.

Ports are restricted to each workload's actual application port.

NetworkPolicy and AuthorizationPolicy solve different problems:

- NetworkPolicy filters network reachability using pod and namespace selection.
- Istio AuthorizationPolicy authenticates workload identity and applies mesh-aware access rules.

---

## 9. AWS and Istio ingress configuration

### `infrastructure/istio/aws-alb-gateway-values.yaml`

This is not part of the application chart. It is an override file passed to the official `istio/gateway` chart.

#### Internal gateway Service

```yaml
type: ClusterIP
```

The Istio gateway is intentionally internal. It listens on port 80 inside the cluster and exposes its readiness endpoint on port 15021 for health checks.

### `infrastructure/istio/aws-alb-ingress.yaml`

This Kubernetes `Ingress` is the single public entry point. The AWS Load Balancer Controller provisions an internet-facing ALB from its annotations.

Annotations configure:

- `internet-facing` scheme, making the ALB publicly reachable.
- `ip` target mode, forwarding directly to Istio gateway pod IP addresses using Amazon VPC CNI networking.
- HTTP health checks against `/healthz/ready` on the gateway status port `15021`.

The ALB has one HTTP listener on port 80. Its only rule forwards all paths to `istio-ingressgateway:80`; application-specific paths stay in Istio's `VirtualService`.

#### Explicit ServiceAccount

The gateway ServiceAccount is explicitly named `istio-ingressgateway`. This guarantees that its identity matches the principal used by our AuthorizationPolicies.

#### Gateway autoscaling and resources

The gateway runs between 2 and 5 replicas, scaling at 70% CPU or 80% memory utilization. Resource requests assist scheduling and autoscaling; limits protect nodes from uncontrolled consumption.

#### Why ALB in this deployment

The AWS account can create ALBs but cannot currently provision NLBs through the AWS Load Balancer Controller. An ALB is therefore used for the AWS entry point.

There is no duplicated path routing: the ALB forwards every request to the gateway, while Istio remains the single application-routing authority. This keeps the architecture compatible with Istio traffic management while using the load balancer available to the account.

---

## 10. Documentation and repository hygiene

### `infrastructure/README.md`

Provides operator commands for:

- Running Docker Compose.
- Installing Istio base CRDs.
- Installing Istio CNI.
- Installing `istiod` with CNI integration.
- Installing the AWS-facing Istio ingress gateway.
- Creating and securely labeling the application namespace.
- Installing the application Helm chart.

The install order is important. Istio CNI and `istiod` must be ready before restricted application pods are created.

### Root `README.md`

Provides the project description, repository map, architecture summary, and the reason cargo stays at one replica.

### Root `.gitignore`

Prevents generated Python files, local virtual environments, editor state, logs, secrets in `.env`, and future Terraform state from entering Git.

Terraform state can contain sensitive infrastructure data and must be stored in a protected remote backend rather than committed.

---

## 11. Security model summary

The project uses defense in depth:

| Layer | Control |
|---|---|
| Container build | Minimal images and multi-stage Go build |
| Container identity | Non-root UID/GID |
| Container permissions | No privilege escalation, all capabilities dropped |
| Filesystem | Read-only root filesystem |
| Syscall filtering | Runtime-default seccomp |
| Kubernetes identity | Dedicated ServiceAccount per workload, no mounted API token |
| Namespace admission | Restricted Pod Security policy |
| Pod networking | Default-deny NetworkPolicy with explicit allowances |
| Mesh transport | Strict mTLS |
| Mesh authorization | Default-deny AuthorizationPolicy and identity-based allow rules |
| Public exposure | One ALB Ingress, one Istio ingress gateway |

Istio CNI is installed because the standard Istio init container needs `NET_ADMIN` and `NET_RAW`. Moving traffic setup to the privileged node-level CNI allows application pods to remain compliant with restricted Pod Security.

## 12. Availability and scaling summary

- Frontend, telemetry, and routing start with two replicas.
- Rolling updates use zero unavailable pods and one surge pod.
- PDBs protect replicated services during voluntary disruptions.
- Telemetry HPA scales from 2 to 6 replicas.
- Istio ingress gateway scales from 2 to 5 replicas.
- Health probes prevent unready pods from receiving traffic.
- DestinationRule outlier detection removes repeatedly failing endpoints temporarily.
- Cargo remains a single replica until state is moved to an external database.

## 13. Deployment sequence

The correct manual order on standard EKS is:

1. Build and push the four versioned images to Docker Hub.
2. Create EKS with managed worker nodes and Amazon VPC CNI.
3. Install Metrics Server for HPA.
4. Install AWS Load Balancer Controller with an IAM role.
5. Create the `istio-system` namespace with privileged Pod Security for Istio CNI.
6. Install `istio/base`.
7. Install `istio/cni`.
8. Install `istio/istiod` with `pilot.cni.enabled=true`.
9. Install `istio/gateway` using `aws-alb-gateway-values.yaml` and apply `aws-alb-ingress.yaml`.
10. Create and label `space-cargo` for injection and restricted Pod Security.
11. Install the `space-cargo` chart.
12. Wait for the ALB hostname and test the application.

## 14. CI/CD handoff

The Helm chart is the authoritative application deployment source. Plain duplicated Kubernetes manifests were removed to avoid configuration drift.

The intended flow is:

```text
Pull request
  --> GitHub Actions lint and tests
  --> Docker build validation
  --> Helm lint and template validation

Merge to main
  --> build four images
  --> push immutable SHA tags to Docker Hub
  --> update Helm environment values in Git
  --> Argo CD detects Git change
  --> Argo CD syncs the Helm chart to EKS
```

GitHub Actions should not directly run `helm upgrade` when using Argo CD. CI should publish artifacts and update desired state in Git; Argo CD should reconcile that desired state into EKS.

Recommended future files:

```text
.github/workflows/ci.yaml
.github/workflows/publish-images.yaml
infrastructure/helm/space-cargo/values-dev.yaml
infrastructure/helm/space-cargo/values-prod.yaml
infrastructure/argocd/project.yaml
infrastructure/argocd/application.yaml
```

## 15. Current limitations to present honestly

1. Cargo data is in memory and is lost after a restart.
2. Cargo cannot safely scale horizontally until state moves to a shared database.
3. Chaos controls are also stored in process memory.
4. HTTP is currently exposed without a custom domain or production TLS certificate.
5. Docker runtime validation still needs to be performed on a machine with Docker.
6. `go.sum` should be generated and committed before final CI.
7. NetworkPolicy enforcement depends on enabling a compatible EKS CNI policy engine.
8. Observability currently exposes Prometheus endpoints, but Prometheus, Grafana, tracing, and log aggregation are not installed yet.

These limitations do not invalidate the architecture; they define the next engineering phases.

## 16. Likely supervisor questions

### Why use Helm rather than raw Kubernetes YAML?

Helm eliminates repeated manifests, centralizes configuration, supports environment overrides, produces versioned packages, and gives Argo CD a single application source.

### Why are values not written as templates?

`values.yaml` is configuration input. Helm expressions belong in `templates/`. CI changes or overrides values, and Helm renders them into Kubernetes resources.

### Why is there only one AWS Load Balancer?

All application Services and the Istio ingress gateway are `ClusterIP`. One Kubernetes Ingress sends traffic to the gateway, so AWS creates one ALB for the application entry point.

### Why use strict mTLS when traffic is already inside the VPC?

VPC location does not prove workload identity. Istio mTLS encrypts traffic and authenticates both workloads, supporting a zero-trust model inside the cluster.

### Why use both NetworkPolicy and Istio AuthorizationPolicy?

NetworkPolicy controls network reachability. Istio AuthorizationPolicy controls authenticated workload identities and service-level access. Together they provide stronger defense in depth.

### Why does telemetry have an HPA but cargo does not?

Telemetry is stateless enough for multiple replicas and deliberately provides CPU load generation. Cargo stores state in memory, so scaling it would create inconsistent cargo lists and chaos settings.

### Why install Istio CNI?

Without it, each injected application pod needs a privileged init container to configure traffic redirection. Istio CNI performs that task at node level, allowing application namespaces to enforce restricted Pod Security.

### Why use ALB with Istio?

This AWS account can currently create ALBs but cannot provision NLBs through the controller. The ALB is configured only to forward all traffic to the Istio gateway, so Istio remains the single owner of application routes and traffic policies.

### How will a new image reach production?

GitHub Actions will build and push an immutable image tag, update the appropriate Helm values in Git, and Argo CD will synchronize that committed desired state to EKS.

## 17. Short presentation script

> We reorganized the project into a clear separation between application services and infrastructure. Each service has a secure, non-root Docker image, and Docker Compose provides local integration. For EKS, Helm is our single source of truth and generates Deployments, internal Services, identities, probes, resource controls, HPA, PDBs, and network policies. One AWS ALB forwards traffic to a scalable Istio ingress gateway. Istio then performs all application routing, strict mutual TLS, endpoint resilience, and identity-based authorization. We use Istio CNI so application pods can comply with Kubernetes restricted Pod Security. The structure is ready for a GitOps workflow where GitHub Actions publishes immutable images and Argo CD deploys the Helm chart.
