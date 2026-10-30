# buildx bake: the single entry point for image builds.
#
#   docker buildx bake                        build for the host architecture and load into the local daemon
#   docker buildx bake api                    just one
#   docker buildx bake release --push \
#     --builder rowcat                        push as linux/amd64+arm64 multi-arch
#
# Desktop's default `docker` driver does not support multi-arch or cache export. Once:
#   docker buildx create --name rowcat --driver docker-container --bootstrap
# Do not add `--use`: it changes the global default builder and drags other projects' builds along.
# Instead pass `--builder rowcat` when needed, or use BUILDX_BUILDER.

variable "REGISTRY" {
  # Must match compose's image: field (its ROWCAT_IMAGE_REGISTRY default) so `compose up` picks up
  # what `bake` built as is, with no pull. The images carry no deployment value — web and the
  # console take the API origin at runtime — so the same names serve local builds and releases.
  default = "ghcr.io/project-rowcat/rowcat"
}

variable "TAG" {
  default = "latest"
}

variable "EXTRA_TAG" {
  # A second tag for the same build, e.g. `sha-<commit>` beside `latest`, so a deployment can pin
  # the exact build it runs. Empty adds nothing.
  default = ""
}

variable "SOURCE" {
  # The repository URL. GHCR links a package to its repository through this label (and inherits its
  # visibility from it). Empty adds no label — a local build has no repository to point at.
  default = ""
}

variable "CACHE" {
  # Registry repository for the layer cache. Empty turns cache import/export off:
  # locally the buildx built-in cache is enough, and turning it on puts every build on the network.
  # e.g. CACHE=ghcr.io/org/rowcat-cache docker buildx bake
  default = ""
}

# One cache tag per app. Sharing one ref lets whichever pushes later overwrite the other.
function "cache_from" {
  params = [name]
  result = CACHE == "" ? [] : ["type=registry,ref=${CACHE}:${name}"]
}

function "cache_to" {
  # mode=max: intermediate stages (install/build) must be pushed too for CI rebuilds to actually get shorter.
  params = [name]
  result = CACHE == "" ? [] : ["type=registry,ref=${CACHE}:${name},mode=max"]
}

function "tags" {
  params = [name]
  result = EXTRA_TAG == "" ? ["${REGISTRY}/${name}:${TAG}"] : ["${REGISTRY}/${name}:${TAG}", "${REGISTRY}/${name}:${EXTRA_TAG}"]
}

target "_common" {
  # The context is always the repository root; it needs the workspace lockfile and every manifest.
  labels = SOURCE == "" ? {} : { "org.opencontainers.image.source" = SOURCE }
}

target "api" {
  inherits   = ["_common"]
  dockerfile = "apps/api/Dockerfile"
  target     = "runner"
  tags       = tags("api")
  cache-from = cache_from("api")
  cache-to   = cache_to("api")
  # Loads into the local daemon. Without this, the docker-container driver only builds and leaves
  # the image in its cache, so `compose up` fails with "no such image".
  output = ["type=docker"]
}

target "web" {
  inherits   = ["_common"]
  dockerfile = "apps/web/Dockerfile"
  target     = "runner"
  tags       = tags("web")
  cache-from = cache_from("web")
  cache-to   = cache_to("web")
  # Loads into the local daemon. Without this, the docker-container driver only builds and leaves
  # the image in its cache, so `compose up` fails with "no such image".
  output = ["type=docker"]
}

target "admin" {
  inherits   = ["_common"]
  dockerfile = "apps/admin/Dockerfile"
  target     = "runner"
  tags       = tags("admin")
  cache-from = cache_from("admin")
  cache-to   = cache_to("admin")
  output     = ["type=docker"]
}

# The default group **includes** admin. compose brings it up with the default `up`, so leaving it
# out makes `compose up` after `bake` die with "no such image" or, worse, pick up an old admin image
# **built from another commit**. To build one app, name its target:
#   docker buildx bake admin
group "default" {
  targets = ["api", "web", "admin"]
}

# --- Release -----------------------------------------------------------------
# A multi-arch image cannot be loaded into the local daemon (it is a manifest list). Always --push.
target "api-release" {
  inherits  = ["api"]
  platforms = ["linux/amd64", "linux/arm64"]
  # A multi-arch image cannot load as type=docker. --push overrides this with type=registry.
  output = ["type=image"]
}

target "web-release" {
  inherits  = ["web"]
  platforms = ["linux/amd64", "linux/arm64"]
  # A multi-arch image cannot load as type=docker. --push overrides this with type=registry.
  output = ["type=image"]
}

target "admin-release" {
  inherits  = ["admin"]
  platforms = ["linux/amd64", "linux/arm64"]
  # A multi-arch image cannot load as type=docker. --push overrides this with type=registry.
  output = ["type=image"]
}

# The release builds all three too. If the release lacks the console image, deploying the console
# means one more manual build every time, and that image comes from another commit.
group "release" {
  targets = ["api-release", "web-release", "admin-release"]
}
