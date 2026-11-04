variable "cidr" {}
variable "zones" {
  type = list(string)
}

resource "aws_vpc" "this" {
  cidr_block = var.cidr
  tags       = { Name = "web-vpc" }
}

resource "aws_internet_gateway" "this" {
  vpc_id = aws_vpc.this.id
}

# One public subnet per zone, carved out of the VPC range.
resource "aws_subnet" "public" {
  count                   = length(var.zones)
  vpc_id                  = aws_vpc.this.id
  availability_zone       = var.zones[count.index]
  cidr_block              = cidrsubnet(var.cidr, 8, count.index)
  map_public_ip_on_launch = true
  tags                    = { Name = "public-${var.zones[count.index]}" }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.this.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.this.id
  }
}

resource "aws_route_table_association" "public" {
  count          = length(var.zones)
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

output "vpc_id" {
  value = aws_vpc.this.id
}
output "public_subnet_ids" {
  value = aws_subnet.public[*].id
}
