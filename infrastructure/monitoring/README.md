# Monitoring Architecture

The Monitoring Server uses native systemd services for central Prometheus,
Grafana, and node-exporter. Their listener overrides are versioned under
`monitoring-server/systemd`. A full Prometheus server in the dedicated,
Istio-enabled `monitoring-agent` namespace scrapes the Space Cargo services,
kube-state-metrics, node-exporter, and kubelet cAdvisor metrics. It displays
those EKS targets in its own Targets page and remote-writes their metrics over
the private VPC to central Prometheus on the Monitoring Server.

The Monitoring Server security group must permit TCP 9091 only from the EKS
worker-node security group because this is the private remote-write endpoint.
Grafana is intentionally bound to all interfaces for direct project-demo
access on port 3000. Restrict that port to trusted source IPs outside the demo.

Central Prometheus is bound to the monitoring server's private VPC IP on port
`9091`; node-exporter is bound to loopback. Do not commit Grafana credentials.

After changing `prometheus-server.yaml`, apply it and restart the server so it
loads the updated ConfigMap:

```bash
kubectl apply -f infrastructure/monitoring/prometheus-server/prometheus-server.yaml
kubectl rollout restart deployment/prometheus-server -n monitoring-agent
```

## Team access to Prometheus

The public EKS Prometheus UI exposes its Targets page without a password:

```text
http://<monitoring-server-public-ip>:9090
```

Nginx on the Monitoring Server proxies that port to the EKS Prometheus NodePort
internally. The node addresses in `monitoring-server/nginx/prometheus-targets.conf`
must be updated if worker nodes are replaced. The protected HTTPS endpoint on
port 443 continues to provide the central Prometheus UI. Replace the public
demo endpoint with an authenticated HTTPS route before production use.
