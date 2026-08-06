variable "REGISTRY" {
  default = "ghcr.io/victoria824"
}

variable "VERSION" {
  default = "dev"
}

variable "VCS_REF" {
  default = "local"
}

variable "BUILD_DATE" {
  default = "unknown"
}

group "default" {
  targets = ["service", "console"]
}

target "common" {
  platforms = ["linux/amd64", "linux/arm64"]
  labels = {
    "org.opencontainers.image.source" = "https://github.com/Victoria824/SpanReplay"
    "org.opencontainers.image.revision" = VCS_REF
    "org.opencontainers.image.version" = VERSION
  }
  attest = ["type=provenance,mode=max", "type=sbom"]
}

target "service" {
  inherits   = ["common"]
  context    = "."
  dockerfile = "Dockerfile"
  tags       = ["${REGISTRY}/spanreplay:${VERSION}"]
  args = {
    BUILD_DATE = BUILD_DATE
    VCS_REF    = VCS_REF
    VERSION    = VERSION
  }
}

target "console" {
  inherits   = ["common"]
  context    = "."
  dockerfile = "Dockerfile.console"
  tags       = ["${REGISTRY}/spanreplay-console:${VERSION}"]
  args = {
    BUILD_DATE = BUILD_DATE
    VCS_REF    = VCS_REF
    VERSION    = VERSION
  }
}
