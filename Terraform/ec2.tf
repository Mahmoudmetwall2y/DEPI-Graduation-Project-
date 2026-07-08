
resource "aws_eks_access_entry" "manager_access" {
  cluster_name      = aws_eks_cluster.EKS_Cluster.name
  principal_arn     = aws_iam_role.ec2_manager_role.arn
  type              = "STANDARD"
}

resource "aws_eks_access_policy_association" "manager_admin" {
  cluster_name  = aws_eks_cluster.EKS_Cluster.name
  policy_arn    = "arn:aws:eks::aws:cluster-access-policy/AmazonEKSClusterAdminPolicy"
  principal_arn = aws_iam_role.ec2_manager_role.arn
  access_scope { type = "cluster" }
}



resource "aws_instance" "management_server" {
  ami           = "ami-02167eae61967e403"
  instance_type = "t3.micro"
  
  iam_instance_profile = aws_iam_instance_profile.ec2_manager_profile.name
  subnet_id            = aws_subnet.public_subnet.id
  vpc_security_group_ids      = [aws_security_group.allow_tls.id]

  user_data = <<-EOF
              #!/bin/bash
              apt-get update -y
              apt-get install -y unzip curl
              
              curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
              unzip awscliv2.zip
              ./aws/install

              curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl"
              chmod +x kubectl
              mv kubectl /usr/local/bin/

              curl --silent --location "https://github.com/weaveworks/eksctl/releases/latest/download/eksctl_$(uname -s)_amd64.tar.gz" | tar xz -C /tmp
              mv /tmp/eksctl /usr/local/bin/
              apt-get install -y software-properties-common
              apt update
              apt install ansible -y
              apt-get install -y ansible
              apt-get install -y git jq
              EOF

  tags = {
    Name = "EKS-Management-Server"
  }
}