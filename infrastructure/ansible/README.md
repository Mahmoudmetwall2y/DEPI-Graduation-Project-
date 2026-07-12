# Ansible deployment from the EKS administration EC2 host

These playbooks turn the manual platform setup into one repeatable deployment command. Run them either **on the Linux EC2 administration host** or from a WSL Ansible control node on your PC. The EC2 host must have an IAM role with EKS access.

The playbooks install command-line tools, configure kubeconfig, install Metrics Server, AWS Load Balancer Controller, Istio CNI/control plane/gateway, create the secured application namespace, and deploy the `space-cargo` Helm chart.

## Before running

1. Clone this repository on the EC2 administration host.
2. Ensure the EC2 IAM role can call `eks:DescribeCluster` and has an EKS access entry with the necessary Kubernetes permissions.
3. Ensure the role running Ansible can create IAM policies and roles, or have an AWS administrator create `AWSLoadBalancerControllerIAMPolicy` first.
4. Ensure the four Docker Hub images exist with the tag selected in `group_vars/all.yml`.
5. Install Ansible on the EC2 host:

   ```bash
   python3 -m pip install --user ansible-core
   export PATH="$HOME/.local/bin:$PATH"
   ```

## Configure variables

```bash
cd infrastructure/ansible
cp group_vars/all.yml.example group_vars/all.yml
```

Edit `group_vars/all.yml` and set the actual EKS cluster name and AWS region. Keep `build_and_push_images: false` when images are already in Docker Hub.

Set `remote_project_root` to the absolute repository path on EC2.

## Run

```bash
ansible-playbook playbooks/site.yml
```

The inventory targets `localhost`, so Ansible configures the EC2 host on which it runs.

## Run from WSL on your PC

1. Install Ansible in WSL and confirm that your private SSH key can connect to EC2.
2. Clone this repository on **both** WSL and EC2. The remote EC2 checkout is required because Helm commands run there.
3. In WSL, create a remote inventory:

   ```bash
   cp inventory/hosts.remote.ini.example inventory/hosts.remote.ini
   ```

4. Replace the EC2 host, WSL username, and private-key path in `inventory/hosts.remote.ini`.
5. Verify SSH and Ansible connectivity:

   ```bash
   ansible -i inventory/hosts.remote.ini eks_admin -m ping
   ```

6. Run the deployment from WSL:

   ```bash
   ansible-playbook -i inventory/hosts.remote.ini playbooks/site.yml
   ```

Use the default `inventory/hosts.ini` only when Ansible runs directly on EC2.

## First deployment with image publishing

Create public Docker Hub repositories for all four image names. Export a Docker Hub access token, never a password:

```bash
export DOCKERHUB_TOKEN='your-token'
ansible-playbook playbooks/site.yml --extra-vars build_and_push_images=true
```

The token is passed only as a process environment variable and is never stored in Git.

## Verification

```bash
kubectl get nodes
kubectl get pods -n istio-system
kubectl get pods -n space-cargo
kubectl get service istio-ingressgateway -n istio-system
```

When the ingress gateway service receives an external hostname, open `http://<NLB_HOSTNAME>` in a browser.

## Notes

- Standard EKS requires the AWS Load Balancer Controller. Set `install_aws_load_balancer_controller: false` only for EKS Auto Mode or when the controller already exists and is managed elsewhere.
- The playbook is designed to be rerun. Helm uses `upgrade --install`; Kubernetes resources are applied or checked repeatedly.
- For the final project, GitHub Actions should build and push images. In that case, keep `build_and_push_images: false` and let Ansible handle only platform/application deployment.
