#!/usr/bin/env bash
# Installs or upgrades a RowCat deployment from the published images, on a machine with Docker and no
# copy of this repository. docs/ops/INSTALL.md is the guide.
#
#   bash install.sh --ref 2026-11-03 --domain rowcat.example.com [--email ops@example.com]
#   bash install.sh --ref 2026-11-03 --local          # this machine only, plain HTTP on 3000-3002
#   bash install.sh --ref 2026-11-17                  # run again in the same directory: an upgrade
#
# What it does, in order. Install: download the compose files and the backup scripts of that one
# commit · write .env with generated secrets (0600; never overwritten) · pull each image and pin it by
# digest · start and wait for health · print the first-run setup code. Upgrade (an .env is already
# here): back up the database first, then the same steps for the new commit, keeping .env's secrets.
#
# What it refuses to do:
# - Build. The pinned file resets compose's `build:`, so a missing or unpullable image is an error
#   that names the image, never a silent build of a source tree that is not here.
# - Overwrite .env. It holds the session key that also encrypts two-factor secrets; a new one signs
#   everyone out and turns every authenticator off for good.
# - Run `latest`. A deployment runs one commit's images, by digest: a later push or a re-run of the
#   image workflow cannot change what a restart starts. Moving is this script, run again.
# - Put a public server on plain HTTP. --domain puts Caddy and certificates in front
#   (deploy/caddy/); --local is for trying RowCat on the machine you are sitting at.
#
# A fork passes --repo (and its images follow: ghcr.io/<owner>/rowcat). --source <checkout> takes the
# files from a local checkout instead of downloading them, with --tag naming images already in
# --registry; scripts/install-smoke.sh tests the script that way.

set -euo pipefail

repo="Project-RowCat/RowCat"
ref=""
domain=""
email=""
local_only=""
registry=""
tag=""
source_dir=""
dir="."
skip_backup=""

usage() {
	sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'
	cat <<'EOF'

Options:
  --ref REF         the commit or release tag to install (a dated source release, e.g. 2026-11-03)
  --domain HOST     serve https://HOST, https://api.HOST and https://admin.HOST through Caddy
  --email ADDRESS   the ACME account address for certificates (optional, with --domain)
  --local           serve http://localhost:3000-3002 instead (this machine only)
  --dir PATH        the deployment directory (default: the current one)
  --repo OWNER/NAME where the files and images come from (default: Project-RowCat/RowCat)
  --registry REF    image registry (default: ghcr.io/<lowercased owner>/rowcat)
  --tag TAG         image tag (default: sha-<first 12 characters of the commit>)
  --source PATH     copy the files from a local checkout instead of downloading them (needs --tag)
  --skip-backup     upgrade without the database backup that normally comes first
EOF
}

die() {
	echo "install: $*" >&2
	exit 1
}
say() { echo "install: $*"; }

while [ $# -gt 0 ]; do
	case "$1" in
	--ref) ref="${2:?--ref needs a value}" && shift ;;
	--domain) domain="${2:?--domain needs a value}" && shift ;;
	--email) email="${2:?--email needs a value}" && shift ;;
	--local) local_only=1 ;;
	--dir) dir="${2:?--dir needs a value}" && shift ;;
	--repo) repo="${2:?--repo needs a value}" && shift ;;
	--registry) registry="${2:?--registry needs a value}" && shift ;;
	--tag) tag="${2:?--tag needs a value}" && shift ;;
	--source) source_dir="${2:?--source needs a value}" && shift ;;
	--skip-backup) skip_backup=1 ;;
	# `;`, not `&&`: help piped into `head` makes usage fail on the closed pipe, and must still exit.
	-h | --help)
		usage || true
		exit 0
		;;
	*)
		usage >&2 || true
		die "unknown option: $1"
		;;
	esac
	shift
done

# Everything this script writes holds or sits beside the deployment's secrets: owner-only.
umask 077

# --- Prerequisites ------------------------------------------------------------------------------

command -v docker >/dev/null || die "docker is not installed (https://docs.docker.com/engine/install/)"
docker info >/dev/null 2>&1 || die "docker is installed but the daemon does not answer (is it running, and may this user use it?)"
compose_version="$(docker compose version --short 2>/dev/null || true)"
[ -n "$compose_version" ] || die "the docker compose plugin is missing (docker compose, not docker-compose)"
# `!reset` (the pinned file and the HTTPS overlay both use it) arrived in Compose 2.24.
major="${compose_version%%.*}" && rest="${compose_version#*.}" && minor="${rest%%.*}"
major="${major#v}"
if [ "$major" -lt 2 ] || { [ "$major" -eq 2 ] && [ "$minor" -lt 24 ]; }; then
	die "docker compose $compose_version is too old — 2.24 or newer is needed"
fi
[ -n "$source_dir" ] || command -v curl >/dev/null || die "curl is needed to download the deployment files"

case "$repo" in */*) ;; *) die "--repo is OWNER/NAME, e.g. Project-RowCat/RowCat" ;; esac
owner="$(printf '%s' "${repo%%/*}" | tr '[:upper:]' '[:lower:]')"
registry="${registry:-ghcr.io/$owner/rowcat}"

if [ -n "$source_dir" ]; then
	# Made absolute before the cd below, which would otherwise move a relative path with it.
	source_dir="$(cd "$source_dir" 2>/dev/null && pwd)" || die "--source is not a directory"
fi
mkdir -p "$dir"
cd "$dir"
if [ -f .env ]; then mode=upgrade; else mode=install; fi

if [ "$mode" = install ]; then
	if [ -n "$domain" ] && [ -n "$local_only" ]; then die "--domain and --local are two different deployments — pick one"; fi
	if [ -z "$domain" ] && [ -z "$local_only" ]; then
		die "say where this deployment answers: --domain rowcat.example.com (a server), or --local (this machine)"
	fi
	if [ -n "$domain" ]; then
		# A host name, not a URL: the overlay builds https://, api. and admin. around it.
		printf '%s' "$domain" | grep -Eq '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$' ||
			die "--domain is a lowercase host name like rowcat.example.com (no scheme, port or path)"
	fi
	if [ -n "$email" ]; then
		printf '%s' "$email" | grep -Eq '^[^[:space:]"@]+@[^[:space:]"@]+$' || die "--email is not an address"
		[ -n "$domain" ] || die "--email is the certificate account's address; it goes with --domain"
	fi
	# docker-compose.yml names its project `rowcat`, so its database volume is machine-wide. One left by
	# another or an earlier deployment would start with that database and refuse the password generated
	# below — Postgres reads POSTGRES_PASSWORD only when the volume is first created.
	project="${COMPOSE_PROJECT_NAME:-rowcat}"
	if docker volume inspect "${project}_db-data" >/dev/null 2>&1; then
		die "a database volume ${project}_db-data already exists on this machine. If it belongs to a deployment, run install.sh in the directory that holds its .env; if it holds nothing you need, remove it first (docker volume rm ${project}_db-data)"
	fi
else
	# The deployment's shape is in its .env. Changing it is an edit there, not an upgrade flag.
	[ -z "$domain$local_only$email" ] || die "this directory already has a deployment; --domain, --local and --email apply to a first install only"
	grep -q '^COMPOSE_FILE=.*compose\.images\.yml' .env ||
		die "this .env was not written by install.sh (no compose.images.yml in COMPOSE_FILE) — upgrade it as docs/ops/BACKUP.md describes"
fi

# --- Which commit ---------------------------------------------------------------------------------

if [ -n "$source_dir" ]; then
	[ -f "$source_dir/docker-compose.yml" ] || die "--source $source_dir is not a RowCat checkout"
	[ -n "$tag" ] || die "--source needs --tag: a checkout names no published image"
	commit="${ref:-local}"
else
	[ -n "$ref" ] || die "name what to install with --ref: a dated source release (https://github.com/$repo/releases) or a commit"
	# One request turns a tag, branch or short sha into the full commit, and the images are named by it.
	commit="$(curl -fsS --proto '=https' -H 'Accept: application/vnd.github.sha' \
		"https://api.github.com/repos/$repo/commits/$ref")" || die "github does not know $ref in $repo"
	printf '%s' "$commit" | grep -Eq '^[0-9a-f]{40}$' || die "github answered something that is not a commit for $ref"
	tag="${tag:-sha-${commit:0:12}}"
fi
say "$mode: $repo at ${commit:0:12}, images $registry/{api,web,admin}:$tag"

# --- Images, by digest ----------------------------------------------------------------------------

# Pulled before anything here is written: a refused pull leaves a first install with no .env (so the
# next attempt is still an install) and an upgrade with the deployment exactly as it was.
pins=""
for app in api web admin; do
	image="$registry/$app:$tag"
	docker pull -q "$image" >/dev/null 2>&1 ||
		die "cannot pull $image — the image is not published for that commit, or the registry refuses anonymous pulls (GHCR packages are private until their owner makes them public). Nothing was changed"
	digest="$(docker image inspect --format '{{range .RepoDigests}}{{println .}}{{end}}' "$image" | grep -m1 "^$registry/$app@sha256:" || true)"
	[ -n "$digest" ] || die "pulled $image but docker reports no registry digest for it"
	pins="$pins  $app:
    image: $digest
    build: !reset null
"
done

# --- Backup before anything changes (upgrade) ----------------------------------------------------

if [ "$mode" = upgrade ] && [ -z "$skip_backup" ]; then
	# The only way back from a migration the new images apply (docs/ops/BACKUP.md §롤백).
	say "backing up the database first"
	bash scripts/backup.sh backups || die "the backup failed — nothing was changed (start the stack, or pass --skip-backup knowingly)"
fi

# --- Files ----------------------------------------------------------------------------------------

# Staged first and moved into place only when every file arrived, so a dropped download leaves the
# previous files whole instead of half of two versions.
files="docker-compose.yml deploy/caddy/compose.yml deploy/caddy/Caddyfile scripts/backup.sh scripts/restore.sh scripts/install.sh"
stage="$(mktemp -d .rowcat-install.XXXXXX)"
trap 'rm -rf "$stage"' EXIT
for f in $files; do
	mkdir -p "$stage/$(dirname "$f")"
	if [ -n "$source_dir" ]; then
		cp "$source_dir/$f" "$stage/$f"
	else
		curl -fsSL --proto '=https' --retry 3 "https://raw.githubusercontent.com/$repo/$commit/$f" -o "$stage/$f" ||
			die "could not download $f at ${commit:0:12}"
	fi
done
for f in $files; do
	mkdir -p "$(dirname "$f")"
	mv -f "$stage/$f" "$f"
done
chmod u+x scripts/*.sh

# --- .env -----------------------------------------------------------------------------------------

random_hex() { od -An -N"$1" -tx1 /dev/urandom | tr -d ' \n'; }
random_b64() { head -c "$1" /dev/urandom | base64 | tr -d '\n'; }

set_env() { # set_env KEY VALUE — replaces the line, keeps every other line and the file's mode
	local tmp
	tmp="$(mktemp .env.XXXXXX)"
	grep -v "^$1=" .env >"$tmp" || true
	printf '%s=%s\n' "$1" "$2" >>"$tmp"
	mv -f "$tmp" .env
}

if [ "$mode" = install ]; then
	if [ -n "$domain" ]; then
		compose_file="docker-compose.yml:deploy/caddy/compose.yml:compose.images.yml"
	else
		compose_file="docker-compose.yml:compose.images.yml"
	fi
	# noclobber: if an .env appeared since the check above, this fails instead of replacing it.
	(
		set -o noclobber
		{
			echo "# Written by scripts/install.sh on $(date -u +%Y-%m-%dT%H:%MZ). Keep a copy with the backups,"
			echo "# separately and encrypted: without BETTER_AUTH_SECRET no backup restores sessions or 2FA."
			echo "COMPOSE_FILE=$compose_file"
			echo "BETTER_AUTH_SECRET=$(random_b64 32)"
			echo "POSTGRES_PASSWORD=$(random_hex 24)"
			[ -z "$domain" ] || echo "ROWCAT_DOMAIN=$domain"
			[ -z "$email" ] || echo "ROWCAT_CADDY_OPTIONS=\"email $email\""
			echo "ROWCAT_IMAGE_REGISTRY=$registry"
			echo "ROWCAT_IMAGE_TAG=$tag"
		} >.env
	) || die ".env appeared while installing — not overwriting it"
	say "wrote .env with generated secrets (owner-only)"
else
	set_env ROWCAT_IMAGE_REGISTRY "$registry"
	set_env ROWCAT_IMAGE_TAG "$tag"
fi

# --- Pin ------------------------------------------------------------------------------------------

cat >compose.images.yml.tmp <<EOF
# Written by scripts/install.sh: the exact images this deployment runs, by digest ($tag of $repo).
# A digest names bytes, so no later push can change what a restart starts. To move, run install.sh
# again with another --ref; editing this file by hand skips the backup that comes first.
# \`build\` is reset because there is no source tree here to build from: a missing image is an error.
services:
$pins
EOF
mv -f compose.images.yml.tmp compose.images.yml

# --- Start ----------------------------------------------------------------------------------------

say "starting (the first start applies the database migrations)"
docker compose up -d --wait --pull never --remove-orphans || {
	docker compose ps >&2 || true
	die "the stack did not become healthy — docker compose logs api shows why"
}

if [ -n "$domain" ]; then
	web="https://$domain" console="https://admin.$domain"
elif grep -q '^ROWCAT_DOMAIN=' .env; then
	d="$(sed -n 's/^ROWCAT_DOMAIN=//p' .env)"
	web="https://$d" console="https://admin.$d"
else
	web="http://localhost:3000" console="http://localhost:3002"
fi
say "running: $web (operations console $console)"

code="$(docker compose logs --no-log-prefix api 2>/dev/null | sed -n 's/.*\[setup\] open \/setup.*enter: //p' | tail -1)"
if [ -n "$code" ]; then
	say "first-run setup: open $console/setup, create your account, and enter $code"
fi
if [ "$mode" = install ] && [ -n "$domain" ]; then
	say "certificates come once $domain, api.$domain and admin.$domain resolve to this machine and ports 80 and 443 are reachable"
fi
say "backups: scripts/backup.sh (docs/ops/BACKUP.md) — keep .env with them"
