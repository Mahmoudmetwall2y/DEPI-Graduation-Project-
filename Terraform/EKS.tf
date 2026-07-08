#----------------------------------- EKS CLUSTER ----------------------------------------------

resource "aws_eks_cluster" "EKS_Cluster" {
  name = "EKS-Cluster"

  access_config {
    authentication_mode = "API_AND_CONFIG_MAP"
  }

  role_arn = aws_iam_role.eks_cluster_role.arn
  version  = "1.31"

vpc_config {
  subnet_ids = [
    aws_subnet.private_subnet.id,
    aws_subnet.private_subnet_2.id,
  ]

  endpoint_private_access = true
  endpoint_public_access  = false
}

  # Ensure that IAM Role permissions are created before and deleted
  # after EKS Cluster handling. Otherwise, EKS will not be able to
  # properly delete EKS managed EC2 infrastructure such as Security Groups.
  depends_on = [
    aws_iam_role_policy_attachment.eks_cluster_policy,
  ]
}


#----------------------------------- EKS NODE GROUP ----------------------------------------------

resource "aws_eks_node_group" "node_group" {
  cluster_name    = aws_eks_cluster.EKS_Cluster.name
  node_group_name = "EKS-Node-Group"
  node_role_arn   = aws_iam_role.eks_nodes_role.arn
  instance_types = ["t3.small"]
  subnet_ids      = [
    aws_subnet.private_subnet.id,
    aws_subnet.private_subnet_2.id
  ]

  scaling_config {
    desired_size = 1
    max_size     = 2
    min_size     = 1
  }

  update_config {
    max_unavailable = 1
  }

  # Ensure that IAM Role permissions are created before and deleted after EKS Node Group handling.
  # Otherwise, EKS will not be able to properly delete EC2 Instances and Elastic Network Interfaces.
  depends_on = [
    aws_iam_role_policy_attachment.nodes_AmazonEC2ContainerRegistryReadOnly,
    aws_iam_role_policy_attachment.nodes_AmazonEKS_CNI_Policy,
    aws_iam_role_policy_attachment.nodes_AmazonEKSWorkerNodePolicy,
  ]
}