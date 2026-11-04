# A two-tier web app built from local modules. Import this folder with
# "Choose Terraform folder…": the modules and terraform.tfvars are read too.
provider "aws" {
  region = var.region
}

variable "region" {
  default = "us-east-1"
}
variable "vpc_cidr" {}
variable "services" {
  description = "Web services and the port each one listens on"
  type        = map(object({ port = number }))
}

module "network" {
  source = "./modules/network"
  cidr   = var.vpc_cidr
  zones  = ["${var.region}a", "${var.region}b"]
}

module "service" {
  source    = "./modules/service"
  for_each  = var.services
  name      = each.key
  port      = each.value.port
  vpc_id    = module.network.vpc_id
  subnet_id = module.network.public_subnet_ids[0]
}
