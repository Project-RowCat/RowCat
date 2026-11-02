#!/usr/bin/env bash
# An upgrade on a persistent volume, the way an operator does one — then thrown away.
#
#   scripts/upgrade-smoke.sh <from ref> [to ref]     e.g. desktop-2026-10-31 (to defaults to HEAD)
#
# Builds the API image of each ref (from its own Dockerfile, in a temporary worktree), runs <from> on
# a fresh database, fills it the way members do (an account, a story with a cover, an avatar, a sync
# keyring with encrypted records), takes a backup with scripts/backup.sh, then swaps the API image to
# <to> on the same volume — boot applies the newer migrations — and asks the upgraded API for all of it.
#
# Only db, redis and api run: the data lives behind the API, and web and the console hold none. Like
# compose-smoke.sh it has its own project name, generated secrets in a temporary 0700 directory, and
# `down -v` on every exit; it needs port 3001 free. docs/ops/BACKUP.md §업그레이드 records runs.

set -euo pipefail

cd "$(dirname "$0")/.."

from="${1:?usage: scripts/upgrade-smoke.sh <from ref> [to ref]}"
to="${2:-HEAD}"
PROJECT="${UPGRADE_SMOKE_PROJECT:-rowcat-upgrade}"
REGISTRY=rowcat-upgrade-smoke
API=http://localhost:3001
ORIGIN="Origin: http://localhost:3000"
umask 077
work="$(mktemp -d)"
env_file="$work/env"
failures=0
trees=()

dc() { docker compose -p "$PROJECT" -f docker-compose.yml --env-file "$env_file" "$@"; }

cleanup() {
	status=$?
	if [ "$status" -ne 0 ] || [ "$failures" -ne 0 ]; then
		echo "--- api log (setup codes masked)"
		dc logs api 2>&1 | sed -E 's/(enter: )[A-Z0-9-]+/\1<masked>/' | tail -40 || true
	fi
	dc down -v --remove-orphans >/dev/null 2>&1 || true
	docker image rm "$REGISTRY/api:from" "$REGISTRY/api:to" >/dev/null 2>&1 || true
	for tree in "${trees[@]+"${trees[@]}"}"; do git worktree remove --force "$tree" >/dev/null 2>&1 || true; done
	rm -rf "$work"
}
trap cleanup EXIT

ok() { echo "ok    $1"; }
fail() {
	echo "FAIL  $1" >&2
	failures=$((failures + 1))
}
expect() { if [ "$2" = "$3" ]; then ok "$1"; else fail "$1 — expected [$2], got [$3]"; fi; }
json() { python3 -c "import json,sys; print(json.load(sys.stdin)$1)"; }

build() { # build <ref> <tag>
	local tree="$work/tree-$2"
	git worktree add --detach "$tree" "$1" >/dev/null 2>&1
	trees+=("$tree")
	echo "--- building the API of $1 ($(git -C "$tree" rev-parse --short HEAD))"
	docker build -q -f "$tree/apps/api/Dockerfile" -t "$REGISTRY/api:$2" "$tree" >/dev/null
}
build "$from" from
build "$to" to

{
	echo "BETTER_AUTH_SECRET=$(openssl rand -base64 32)"
	echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)"
	echo "ROWCAT_IMAGE_REGISTRY=$REGISTRY"
} >"$env_file"

run_api() { # run_api <tag>
	ROWCAT_IMAGE_TAG="$1" dc up -d --wait --no-build db redis api >/dev/null
}

echo "--- $from on a fresh volume"
run_api from
migrations() {
	dc exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "select count(*) from drizzle.__drizzle_migrations"'
}
from_migrations="$(migrations)"
ok "$from booted with $from_migrations migrations applied"

member="$work/member.jar"
curl -s -c "$member" -H "$ORIGIN" -H 'content-type: application/json' \
	-d "{\"name\":\"Upgrade\",\"email\":\"upgrade@smoke.test\",\"password\":\"$(openssl rand -hex 12)\"}" \
	-o /dev/null "$API/v2/auth/sign-up/email"
as() { curl -s -b "$member" -H "$ORIGIN" "$@"; }
member_id="$(as "$API/v2/me" | json '["id"]')"
[ -n "$member_id" ] && ok "a member signs up" || fail "no member after sign-up"

python3 - "$work/picture.png" <<'PY'
import struct, sys, zlib
size = 64
rows = b"".join(b"\x00" + b"".join(bytes((x * 3, y * 3, 90)) for x in range(size)) for y in range(size))
def chunk(kind, data):
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))
open(sys.argv[1], "wb").write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
    + chunk(b"IDAT", zlib.compress(rows)) + chunk(b"IEND", b""))
PY
story="$(as -H 'content-type: application/json' \
	-d '{"originDraftId":"upgrade-draft","metadata":{"title":"Upgrade Story","visibility":"public"},"play":{"scenario":"The same morning, again."}}' \
	"$API/v2/stories" | json '["story"]["id"]')"
as -X PUT --data-binary "@$work/picture.png" -o /dev/null "$API/v2/stories/$story/cover"
avatar_url="$(as -X PUT --data-binary "@$work/picture.png" "$API/v2/me/avatar" | json '["avatar"]["url"]')"
absolute() { case "$1" in http*) echo "$1" ;; *) echo "$API$1" ;; esac; }
digest() { local sum; sum="$(curl -fsS "$1" | shasum -a 256)" || return 0; echo "${sum%% *}"; }
cover_url() { curl -fsS "$API/v2/stories/$story" | json '["coverUrl"]'; }
cover_before="$(digest "$(absolute "$(cover_url)")")"
avatar_before="$(digest "$(absolute "$avatar_url")")"
[ -n "$cover_before" ] && [ -n "$avatar_before" ] && ok "a story with a cover and an avatar exist" ||
	fail "the cover or the avatar is not served on $from"

awk '$6 ~ /session_token/ {print $6"="$7}' "$member" | head -1 >"$work/member.cookie"
sync_fixture() {
	pnpm --silent --filter @rowcat/mcp exec tsx scripts/sync-fixture.ts "$1" \
		"$API/v2" "$work/member.cookie" "$work/sync.json" 2>"$work/sync-$1.log"
}
sync_fixture seed && ok "a keyring and encrypted records are uploaded" ||
	fail "the sync fixture could not seed: $(tail -2 "$work/sync-seed.log")"

echo "--- backup, then $to on the same volume"
if ROWCAT_COMPOSE="docker compose -p $PROJECT -f docker-compose.yml --env-file $env_file" \
	scripts/backup.sh "$work/backups" >"$work/backup.log" 2>&1; then
	ok "the pre-upgrade backup is taken"
else
	fail "the pre-upgrade backup failed: $(tail -2 "$work/backup.log")"
fi
run_api to
expect "$to's API is healthy on the old volume" 200 "$(curl -s -o /dev/null -w '%{http_code}' "$API/v2/health/ready")"
to_migrations="$(migrations)"
ok "migrations: $from_migrations before, $to_migrations after"
expect "the member's session survives the upgrade" "$member_id" "$(as "$API/v2/me" | json '["id"]')"
expect "the story is still in the gallery" True \
	"$(curl -fsS "$API/v2/stories" | python3 -c "import json,sys; print(any(s['id'] == '$story' for s in json.load(sys.stdin)['items']))")"
expect "the cover is the same bytes" "$cover_before" "$(digest "$(absolute "$(cover_url)")")"
expect "the avatar is the same bytes" "$avatar_before" "$(digest "$(absolute "$avatar_url")")"
if sync_fixture verify; then
	ok "the keyring, the records and pairing work after the upgrade"
else
	fail "sync after the upgrade: $(grep '✗' "$work/sync-verify.log" | head -3 | tr '\n' ' ')"
fi

echo
if [ "$failures" -ne 0 ]; then
	echo "$failures check(s) failed" >&2
	exit 1
fi
echo "upgrade smoke passed ($from → $to)"
