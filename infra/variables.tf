variable "image_repo_api" {
  default = "ghcr.io/mariaruival/gestion-turnos-backend"
}

variable "image_repo_front" {
  default = "ghcr.io/mariaruival/gestion-turnos-frontend"
}

variable "image_tag" {
  default = "sha-59d34cc00fbffce53f0e1d2317b7b9b5e1c7a993"
}

variable "region" {
  default = "virginia" # tu base de preprod quedó en us-east-1 (N. Virginia)
}

variable "jwt_secret" {
  type      = string
  sensitive = true
}

variable "cors_origin" {
  default = "*"
}