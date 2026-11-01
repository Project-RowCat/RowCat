#!/usr/bin/env bash
# The production compose stack, booted and set up the way a deployer would — then thrown away.
#
#   scripts/compose-smoke.sh            uses images already present, builds the missing ones
#   scripts/compose-smoke.sh --build    builds api, web and admin from this checkout first (CI)
#
# This is docs/ops/CLEAN-INSTALL.md as a script. Unit tests pin each piece (config resolution, the
# setup code, roles); what only a booted image can answer is how the pieces meet: what the image
# carries, whether the command the setup screen tells an admin to run exists there, whether
# production refuses the development secrets. The first manual run found one such gap (the operator
# script missing from the image), which is why this runs in CI before images are published.
#
# It touches nothing of a developer's stack: its own compose project name, its own generated
# secrets in a temporary env file, `-f docker-compose.yml` alone so a local override (which may
# publish Postgres) is not read, and `down -v` on every exit. It does need ports 3000-3002 free —
# compose fixes them.
set -euo pipefail

cd "$(dirname "$0")/.."

PROJECT="${COMPOSE_SMOKE_PROJECT:-rowcat-smoke}"
API=http://localhost:3001
CONSOLE_ORIGIN="Origin: http://localhost:3002"
work="$(mktemp -d)"
env_file="$work/env"
failures=0
# The api, web and admin images this run made, by the names docker-compose.yml gives them.
made=()
image_of() { echo "${ROWCAT_IMAGE_REGISTRY:-ghcr.io/project-rowcat/rowcat}/$1:${ROWCAT_IMAGE_TAG:-latest}"; }

dc() { docker compose -p "$PROJECT" -f docker-compose.yml --env-file "$env_file" "$@"; }

cleanup() {
	status=$?
	if [ "$status" -ne 0 ] || [ "$failures" -ne 0 ]; then
		echo "--- api log (setup codes masked)"
		dc logs api 2>&1 | sed -E 's/(enter: )[A-Z0-9-]+/\1<masked>/' | tail -60 || true
	fi
	dc down -v --remove-orphans >/dev/null 2>&1 || true
	# Images made here carry the published names (`…/api:latest`); left behind, the next
	# `docker compose up` on this machine — a developer's own stack included — runs them instead of
	# pulling or building, and nothing says so. That includes the run without --build: when the pull
	# is refused (packages not public), compose builds them itself under the same names.
	for image in "${made[@]+"${made[@]}"}"; do
		docker image rm "$image" >/dev/null 2>&1 || true
	done
	rm -rf "$work"
}
trap cleanup EXIT

ok() { echo "ok    $1"; }
fail() {
	echo "FAIL  $1" >&2
	failures=$((failures + 1))
}
expect() { # expect <description> <expected> <actual>
	if [ "$2" = "$3" ]; then ok "$1"; else fail "$1 — expected [$2], got [$3]"; fi
}

# What a deployer writes into .env: two generated secrets and nothing else. Hex for the database
# password because compose puts it into DATABASE_URL unescaped.
{
	echo "BETTER_AUTH_SECRET=$(openssl rand -base64 32)"
	echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)"
} >"$env_file"

echo "--- up (project $PROJECT)"
for service in api web admin; do
	if [ "${1:-}" = "--build" ] || ! docker image inspect "$(image_of "$service")" >/dev/null 2>&1; then
		made+=("$(image_of "$service")")
	fi
done
if [ "${1:-}" = "--build" ]; then
	dc build api web admin
fi
dc up -d --wait

json() { python3 -c "import json,sys; print(json.load(sys.stdin)$1)"; }
status_of() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
setup_open() { curl -fsS "$API/v2/setup" | json '["open"]'; }
setup_lines() { dc logs api 2>&1 | grep -c '\[setup\]' || true; }

echo "--- surfaces"
expect "api health" 200 "$(status_of "$API/v2/health")"
expect "web serves" 200 "$(status_of http://localhost:3000/)"
expect "console serves /setup" 200 "$(status_of http://localhost:3002/setup)"
expect "web carries the runtime API origin" 1 \
	"$(curl -s http://localhost:3000/ | grep -c 'name="rowcat-api-origin"' || true)"

echo "--- first-run setup"
expect "setup is open on a fresh database" True "$(setup_open)"
code="$(dc logs api 2>&1 | sed -nE 's/.*enter: ([A-Z0-9-]+).*/\1/p' | tail -1)"
if [ -n "$code" ]; then ok "the API log carries a setup code"; else fail "no setup code in the API log"; fi

sign_up() { # sign_up <jar> <email>
	curl -s -c "$1" -H "$CONSOLE_ORIGIN" -H 'content-type: application/json' \
		-d "{\"name\":\"Smoke\",\"email\":\"$2\",\"password\":\"$(openssl rand -hex 12)\"}" \
		-o /dev/null -w '%{http_code}' "$API/v2/auth/sign-up/email"
}
as() { local jar="$1"; shift; curl -s -b "$jar" -H "$CONSOLE_ORIGIN" "$@"; }
claim() { # claim <jar> <code>
	as "$1" -H 'content-type: application/json' -d "{\"code\":\"$2\"}" \
		-o /dev/null -w '%{http_code}' "$API/v2/setup/claim"
}

role_of() { as "$1" "$API/v2/me" | json '["role"]'; }

# The setup-without-accounts door exists only where the installer turns it on; compose has no way to
# pass that switch, so even the right code from this machine (a bridge address to the API) is refused.
expect "compose offers no local owner" False "$(curl -fsS "$API/v2/setup" | json '["localOwner"]')"
expect "the local-owner door stays shut, right code or not" 403 \
	"$(curl -s -H "$CONSOLE_ORIGIN" -H 'content-type: application/json' \
		-d "{\"code\":\"$code\",\"nickname\":\"Smoke\"}" -o /dev/null -w '%{http_code}' \
		"$API/v2/setup/claim-local")"

first="$work/first.jar"
second="$work/second.jar"
member="$work/member.jar"
expect "the operator signs up" 200 "$(sign_up "$first" operator@smoke.test)"
expect "a second person signs up" 200 "$(sign_up "$second" rival@smoke.test)"
as "$first" -o /dev/null "$API/v2/me" # members are created on the first request
as "$second" -o /dev/null "$API/v2/me"
expect "a wrong code is refused" 403 "$(claim "$first" AAAA-BBBB-CCCC)"

# Both hold the logged code and send it at once: the claim locks the setup row, so one wins and the
# other finds setup closed — never two admins.
claim "$first" "$code" >"$work/first.status" &
claim "$second" "$code" >"$work/second.status" &
wait
statuses="$(cat "$work/first.status" "$work/second.status" | fold -w3 | sort | tr -d '\n')"
expect "racing claims: one wins, one finds setup closed" 200409 "$statuses"
if [ "$(cat "$work/first.status")" = 200 ]; then
	admin="$first" loser="$second"
else
	admin="$second" loser="$first"
fi
expect "the winner is admin" admin "$(role_of "$admin")"
expect "the other stays a member" user "$(role_of "$loser")"
expect "setup closed" False "$(setup_open)"
expect "a second claim is refused" 409 "$(claim "$admin" "$code")"

echo "--- readiness authorization"
expect "member signs up" 200 "$(sign_up "$member" member@smoke.test)"
as "$member" -o /dev/null "$API/v2/me"
expect "admin reads readiness" 200 "$(as "$admin" -o /dev/null -w '%{http_code}' "$API/v2/admin/deployment/readiness")"
expect "a member is refused readiness" 403 "$(as "$member" -o /dev/null -w '%{http_code}' "$API/v2/admin/deployment/readiness")"
expect "a guest is refused readiness" 401 "$(status_of "$API/v2/admin/deployment/readiness")"

echo "--- appointing an operator inside the image"
if dc exec -T api node dist/db/seed-moderator.mjs member@smoke.test staff >/dev/null 2>&1; then
	ok "seed-moderator runs in the container"
else
	fail "seed-moderator did not run in the container"
fi
expect "the member is staff" staff "$(role_of "$member")"

echo "--- published content and media"
# A real image for both media stores: a cover lives in story_cover, an avatar in media + media_blob.
python3 - "$work/picture.png" <<'PY'
import struct, sys, zlib
size = 96
rows = b"".join(
    b"\x00" + b"".join(bytes((x * 2, y * 2, 160)) for x in range(size)) for y in range(size))
def chunk(kind, data):
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))
png = (b"\x89PNG\r\n\x1a\n"
       + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
       + chunk(b"IDAT", zlib.compress(rows)) + chunk(b"IEND", b""))
open(sys.argv[1], "wb").write(png)
PY
publish_status="$(as "$member" -H 'content-type: application/json' -o "$work/story.json" -w '%{http_code}' \
	-d '{"originDraftId":"smoke-draft","metadata":{"title":"Smoke Story","visibility":"public"},"play":{"scenario":"Every midnight the same day comes back."}}' \
	"$API/v2/stories")"
expect "a member publishes a public story" 201 "$publish_status"
story="$(json '["story"]["id"]' <"$work/story.json" 2>/dev/null || true)"
upload() { # upload <jar> <path>
	as "$1" -X PUT --data-binary "@$work/picture.png" -o "$work/upload.json" -w '%{http_code}' "$API$2"
}
expect "the cover uploads" 200 "$(upload "$member" "/v2/stories/$story/cover")"
expect "the avatar uploads" 200 "$(upload "$member" /v2/me/avatar)"
avatar_url="$(json '["avatar"]["url"]' <"$work/upload.json" 2>/dev/null || true)"
in_gallery() { # in_gallery [jar] — a guest without one
	curl -fsS ${1:+-b "$1"} "$API/v2/stories" |
		python3 -c "import json,sys; print(any(s['id'] == '$story' for s in json.load(sys.stdin)['items']))"
}
cover_url() { curl -fsS "$API/v2/stories/$story" | json '["coverUrl"]'; }
digest() { # empty when the URL does not answer, so a lost image is a FAIL line, not an abort
	local sum
	sum="$(curl -fsS "$1" | shasum -a 256)" || return 0
	echo "${sum%% *}"
}
absolute() { case "$1" in http*) echo "$1" ;; *) echo "$API$1" ;; esac; }
# Asked as the creator: guests read the first gallery page through a 30-second cache, and the web
# check above already filled it with the empty catalogue. A guest asks again after the restart below,
# which empties Redis.
expect "the story is in the gallery" True "$(in_gallery "$member")"
cover_before="$(digest "$(absolute "$(cover_url)")")"
avatar_before="$(digest "$(absolute "$avatar_url")")"
if [ -n "$cover_before" ] && [ -n "$avatar_before" ]; then
	ok "the cover and the avatar are served"
else
	fail "the cover or the avatar is not served"
fi

echo "--- restart"
before="$(setup_lines)"
dc restart api >/dev/null
dc up -d --wait api >/dev/null
expect "setup stays closed after an API restart" False "$(setup_open)"
expect "no new setup code is printed" "$before" "$(setup_lines)"
expect "the admin session survives" admin "$(role_of "$admin")"

# The whole stack down and up on the same volume: what a host reboot or an upgrade does. Redis has
# no volume, so this also shows sessions do not live there.
dc down >/dev/null 2>&1
dc up -d --wait >/dev/null
expect "setup stays closed after the stack comes back" False "$(setup_open)"
expect "the new API prints no setup code" 0 "$(setup_lines)"
expect "the admin session survives the stack" admin "$(role_of "$admin")"
expect "the staff session survives the stack" staff "$(role_of "$member")"
expect "a guest finds the story in the gallery" True "$(in_gallery)"
expect "the cover is the same bytes" "$cover_before" "$(digest "$(absolute "$(cover_url)")")"
expect "the avatar is the same bytes" "$avatar_before" "$(digest "$(absolute "$avatar_url")")"

echo "--- production refuses the development secrets"
refuses() { # refuses <description> <log pattern> <env assignment>
	if dc run --rm --no-deps -T -e "$3" api node dist/index.mjs >"$work/refuse.log" 2>&1; then
		fail "the API booted on $1"
	elif grep -q "$2" "$work/refuse.log"; then
		ok "the API refuses $1"
	else
		fail "the API stopped, but not for $1: $(tail -3 "$work/refuse.log")"
	fi
}
refuses "the development database password" "development password" \
	DATABASE_URL=postgres://rowcat:rowcat@db:5432/rowcat
refuses "the session key the tests publish" "published in this repository" \
	BETTER_AUTH_SECRET=rowcat-test-secret-not-for-deploy
refuses "a short session key" "production needs at least" BETTER_AUTH_SECRET=short

echo
if [ "$failures" -ne 0 ]; then
	echo "$failures check(s) failed" >&2
	exit 1
fi
echo "compose smoke passed"
