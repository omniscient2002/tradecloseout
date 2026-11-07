terraform {
  required_version = ">= 1.6.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.70"
    }
  }
}

provider "aws" {
  region = var.aws_region # Default: ap-south-1 (Mumbai) per 15-DEPLOYMENT-AND-OPERATIONS.md §2
}

variable "aws_region" {
  type    = string
  default = "ap-south-1"
}

variable "environment" {
  type    = string
  default = "production"
}

variable "db_master_password" {
  type      = string
  sensitive = true
}

variable "web_origin" {
  description = "Exact HTTPS origin allowed to upload browser files directly to the private upload bucket."
  type        = string
}

# 1. KMS Key for Encryption at Rest (DB, S3, Backups per NFR-SEC-003)
resource "aws_kms_key" "tc_kms" {
  description             = "TradeCloseout-${var.environment} Master KMS Key"
  deletion_window_in_days = 30
  enable_key_rotation     = true
}

# 2. Private Versioned S3 Buckets (uploads, packages, backups, logs per 15 §3)
locals {
  buckets = ["uploads", "packages", "backups", "logs"]
}

resource "aws_s3_bucket" "tc_private" {
  for_each = toset(local.buckets)
  bucket   = "tradecloseout-${var.environment}-${each.key}-ap-south-1"
}

resource "aws_s3_bucket_public_access_block" "tc_block_public" {
  for_each                = aws_s3_bucket.tc_private
  bucket                  = each.value.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "tc_versioning" {
  for_each = aws_s3_bucket.tc_private
  bucket   = each.value.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "tc_sse" {
  for_each = aws_s3_bucket.tc_private
  bucket   = each.value.id
  rule {
    apply_server_side_encryption_by_default {
      kms_master_key_id = aws_kms_key.tc_kms.arn
      sse_algorithm     = "aws:kms"
    }
  }
}

resource "aws_s3_bucket_cors_configuration" "tc_uploads_cors" {
  bucket = aws_s3_bucket.tc_private["uploads"].id

  cors_rule {
    allowed_methods = ["PUT", "HEAD"]
    allowed_origins = [var.web_origin]
    allowed_headers = ["content-type", "x-amz-*"]
    expose_headers  = ["ETag", "x-amz-version-id"]
    max_age_seconds = 3000
  }
}

resource "aws_iam_role" "tc_app_host" {
  name = "tradecloseout-${var.environment}-app-host"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
      Action = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "tc_app_storage" {
  name = "tradecloseout-${var.environment}-private-storage"
  role = aws_iam_role.tc_app_host.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = ["s3:ListBucket", "s3:ListBucketMultipartUploads"]
        Resource = [
          aws_s3_bucket.tc_private["uploads"].arn,
          aws_s3_bucket.tc_private["packages"].arn,
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "s3:AbortMultipartUpload", "s3:DeleteObject", "s3:DeleteObjectVersion",
          "s3:GetObject", "s3:GetObjectVersion", "s3:ListMultipartUploadParts",
          "s3:PutObject", "s3:PutObjectTagging",
        ]
        Resource = [
          "${aws_s3_bucket.tc_private["uploads"].arn}/*",
          "${aws_s3_bucket.tc_private["packages"].arn}/*",
        ]
      },
      {
        Effect = "Allow"
        Action = ["kms:Decrypt", "kms:DescribeKey", "kms:Encrypt", "kms:GenerateDataKey"]
        Resource = aws_kms_key.tc_kms.arn
      },
    ]
  })
}

resource "aws_iam_instance_profile" "tc_app_host" {
  name = "tradecloseout-${var.environment}-app-host"
  role = aws_iam_role.tc_app_host.name
}

# 3. Managed PostgreSQL 16 with 35-Day PITR (15 §2 & §7)
resource "aws_db_instance" "tc_postgres" {
  identifier                  = "tradecloseout-${var.environment}-pg16"
  engine                      = "postgres"
  engine_version              = "16.4"
  instance_class              = "db.t4g.medium"
  allocated_storage           = 100
  max_allocated_storage       = 500
  storage_encrypted           = true
  kms_key_id                  = aws_kms_key.tc_kms.arn
  db_name                     = "tradecloseout"
  username                    = "tc_admin"
  password                    = var.db_master_password
  backup_retention_period     = 35 # 35-day PITR per 15 §7
  deletion_protection         = true
  skip_final_snapshot         = false
  final_snapshot_identifier   = "tradecloseout-${var.environment}-final-snapshot"
  publicly_accessible         = false
}

# 4. 8 GB RAM Application + Worker + ClamAV Host VM (t4g.xlarge per RT-026)
#    Explicitly synchronizes NTP with NPL/NIC Indian clocks per CERT-In 2022 (RT-013)
resource "aws_instance" "tc_app_host" {
  ami           = "ami-0f58b397bc5c1f2e8" # Ubuntu 24.04 LTS ARM64 ap-south-1
  instance_type = "t4g.xlarge"            # 4 vCPU, 16 GB RAM (>= 8 GB RAM mandate per RT-026)
  iam_instance_profile = aws_iam_instance_profile.tc_app_host.name

  root_block_device {
    volume_size = 80
    volume_type = "gp3"
    encrypted   = true
    kms_key_id  = aws_kms_key.tc_kms.arn
  }

  user_data = <<-EOT
    #!/usr/bin/env bash
    set -euo pipefail
    apt-get update && apt-get install -y chrony docker.io docker-compose-plugin qpdf
    # CERT-In Directions 2022 (No. 20(3)/2022-CERT-In, RT-013): Sync to NPL & NIC clocks
    cat << 'NTPCONF' > /etc/chrony/chrony.conf
    server time.nplindia.org iburst prefer
    server samay1.nic.in iburst
    server samay2.nic.in iburst
    makestep 1.0 3
    rtcsync
    logdir /var/log/chrony
    NTPCONF
    systemctl restart chrony
  EOT

  tags = {
    Name        = "tradecloseout-${var.environment}-host"
    Environment = var.environment
    Compliance  = "CERT-IN-2022-DPDP-2023"
  }
}
