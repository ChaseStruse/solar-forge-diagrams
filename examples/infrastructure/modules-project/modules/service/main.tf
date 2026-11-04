variable "name" {}
variable "port" {
  type = number
}
variable "vpc_id" {}
variable "subnet_id" {}
variable "admin_cidrs" {
  default = ["198.51.100.0/24"]
}

locals {
  # The service port is public; SSH is only open to the admin ranges.
  rules = concat(
    [{ port = var.port, cidrs = ["0.0.0.0/0"] }],
    [for cidr in var.admin_cidrs : { port = 22, cidrs = [cidr] }],
  )
}

resource "aws_security_group" "this" {
  name   = "${var.name}-sg"
  vpc_id = var.vpc_id

  dynamic "ingress" {
    for_each = local.rules
    content {
      protocol    = "tcp"
      from_port   = ingress.value.port
      to_port     = ingress.value.port
      cidr_blocks = ingress.value.cidrs
    }
  }
  egress {
    protocol    = "-1"
    from_port   = 0
    to_port     = 0
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_instance" "this" {
  ami                         = "ami-0123456789abcdef0"
  instance_type               = "t3.micro"
  subnet_id                   = var.subnet_id
  vpc_security_group_ids      = [aws_security_group.this.id]
  associate_public_ip_address = true
  tags                        = { Name = "${var.name} (${var.port})" }
}
