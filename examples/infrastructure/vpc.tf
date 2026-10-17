provider "aws" { region = "us-east-1" }
resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
}
resource "aws_subnet" "public" {
  vpc_id = aws_vpc.main.id
  cidr_block = "10.0.1.0/24"
  availability_zone = "us-east-1a"
  map_public_ip_on_launch = true
}
resource "aws_subnet" "private" {
  vpc_id = aws_vpc.main.id
  cidr_block = "10.0.2.0/24"
  availability_zone = "us-east-1b"
  map_public_ip_on_launch = false
}
resource "aws_internet_gateway" "internet" { vpc_id = aws_vpc.main.id }
resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.internet.id
  }
}
resource "aws_route_table_association" "public" {
  subnet_id = aws_subnet.public.id
  route_table_id = aws_route_table.public.id
}
resource "aws_security_group" "web" {
  vpc_id = aws_vpc.main.id
  ingress { protocol = "tcp" from_port = 443 to_port = 443 cidr_blocks = ["0.0.0.0/0"] }
  egress { protocol = "-1" cidr_blocks = ["0.0.0.0/0"] }
}
resource "aws_security_group" "data" {
  vpc_id = aws_vpc.main.id
  ingress { protocol = "tcp" from_port = 5432 to_port = 5432 security_groups = [aws_security_group.web.id] }
  egress { protocol = "-1" cidr_blocks = ["0.0.0.0/0"] }
}
resource "aws_instance" "web" {
  subnet_id = aws_subnet.public.id
  private_ip = "10.0.1.10"
  associate_public_ip_address = true
  vpc_security_group_ids = [aws_security_group.web.id]
  tags = { Name = "HTTPS web" }
}
resource "aws_instance" "database" {
  subnet_id = aws_subnet.private.id
  private_ip = "10.0.2.10"
  associate_public_ip_address = false
  vpc_security_group_ids = [aws_security_group.data.id]
  tags = { Name = "Private PostgreSQL" }
}
