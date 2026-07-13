# Infrastructure

- `docker/`: local multi-container development.
- `helm/space-cargo/`: the authoritative Kubernetes application deployment, including Istio routing and security resources.
- `istio/`: AWS ALB configuration for the official Istio ingress-gateway chart.
- `argocd/`: the Argo CD Application that continuously deploys the Helm chart from `main`.
- `ansible/`: repeatable EKS administration-host bootstrap and deployment playbooks.

The Helm chart is the single application deployment source for CI/CD and Argo CD.

Container images are configured under the `docker.io/mahmoudmetwall2y` Docker Hub namespace.

```bash
# Local application
docker compose -f infrastructure/docker/compose.yaml up --build

# Install Istio and its single AWS-facing ALB ingress gateway
helm repo add istio https://istio-release.storage.googleapis.com/charts
helm repo update
kubectl create namespace istio-system
kubectl label namespace istio-system \
  pod-security.kubernetes.io/enforce=privileged \
  pod-security.kubernetes.io/enforce-version=latest --overwrite
helm upgrade --install istio-base istio/base \
  --namespace istio-system \
  --wait
helm upgrade --install istio-cni istio/cni \
  --namespace istio-system \
  --wait
helm upgrade --install istiod istio/istiod \
  --namespace istio-system \
  --set pilot.cni.enabled=true \
  --wait
helm upgrade --install istio-ingressgateway istio/gateway \
  --namespace istio-system \
  --values infrastructure/istio/aws-alb-gateway-values.yaml \
  --wait
kubectl apply -f infrastructure/istio/aws-alb-ingress.yaml

# Install the application (includes Kubernetes and Istio application resources)
kubectl create namespace space-cargo
kubectl label namespace space-cargo istio-injection=enabled \
  pod-security.kubernetes.io/enforce=restricted \
  pod-security.kubernetes.io/enforce-version=latest \
  pod-security.kubernetes.io/audit=restricted \
  pod-security.kubernetes.io/warn=restricted --overwrite
helm upgrade --install space-cargo infrastructure/helm/space-cargo \
  --namespace space-cargo
```

The standard EKS cluster must have the AWS Load Balancer Controller and Amazon VPC CNI configured. The ALB Ingress uses IP targets, so the ALB sends HTTP traffic directly to Istio gateway pod IPs. The cluster also needs Metrics Server for HPA. Use a CNI configuration that enforces Kubernetes `NetworkPolicy`, such as VPC CNI network-policy mode or Cilium.

The Istio gateway and all application Services are `ClusterIP`. The single `istio-ingressgateway` Ingress creates one public application ALB.

For a repeatable deployment from the EC2 administration host, see [`ansible/README.md`](ansible/README.md).

## GitOps delivery

GitHub Actions tests the services, builds and pushes Docker Hub images tagged with the immutable commit SHA, then commits that SHA to this chart's `values.yaml`. The push that updates `values.yaml` does not retrigger the image build workflow.

Argo CD watches the `main` branch and automatically synchronizes the chart whenever that committed image tag changes. Install Argo CD once, then register the Application:

```bash
kubectl create namespace argocd
kubectl apply -n argocd --server-side --force-conflicts \
  -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml
kubectl apply -f infrastructure/argocd/space-cargo-application.yaml
```

After Argo CD takes ownership of `space-cargo`, use GitHub Actions and Argo CD for application changes. Keep Ansible for the EKS platform components: AWS Load Balancer Controller, Metrics Server, and Istio.
