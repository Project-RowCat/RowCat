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
built=0

dc() { docker compose -p "$PROJECT" -f docker-compose.yml --env-file "$env_file" "$@"; }

cleanup() {
	status=$?
	if [ "$status" -ne 0 ] || [ "$failures" -ne 0 ]; then
		echo "--- api log (setup codes masked)"
		dc logs api 2>&1 | sed -E 's/(enter: )[A-Z0-9-]+/\1<masked>/' | tail -60 || true
	fi
	dc down -v --remove-orphans >/dev/null 2>&1 || true
	# Images built here carry the published names (`…/api:latest`); left behind, the next
	# `docker compose up` on this machine — a developer's own stack included — runs them instead of
	# pulling or building, and nothing says so.
	if [ "$built" -eq 1 ]; then
		# The same names docker-compose.yml gives them (its `image:` defaults).
		for service in api web admin; do
			docker image rm \
				"${ROWCAT_IMAGE_REGISTRY:-ghcr.io/project-rowcat/rowcat}/${service}:${ROWCAT_IMAGE_TAG:-latest}" \
				>/dev/null 2>&1 || true
		done
	fi
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
if [ "${1:-}" = "--build" ]; then
	built=1
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

admin="$work/admin.jar"
member="$work/member.jar"
expect "the operator signs up" 200 "$(sign_up "$admin" operator@smoke.test)"
as "$admin" -o /dev/null "$API/v2/me" # members are created on the first request
expect "a wrong code is refused" 403 "$(claim "$admin" AAAA-BBBB-CCCC)"
expect "the logged code makes the caller admin" 200 "$(claim "$admin" "$code")"
expect "the caller is admin" admin "$(as "$admin" "$API/v2/me" | json '["role"]')"
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
expect "the member is staff" staff "$(as "$member" "$API/v2/me" | json '["role"]')"

echo "--- restart"
before="$(setup_lines)"
dc restart api >/dev/null
dc up -d --wait api >/dev/null
expect "setup stays closed after a restart" False "$(setup_open)"
expect "no new setup code is printed" "$before" "$(setup_lines)"
expect "the admin session survives" admin "$(as "$admin" "$API/v2/me" | json '["role"]')"

echo "--- production refuses the development secrets"
if dc run --rm --no-deps -T -e DATABASE_URL=postgres://rowcat:rowcat@db:5432/rowcat api \
	node dist/index.mjs >"$work/refuse.log" 2>&1; then
	fail "the API booted on the development database password"
elif grep -q "development password" "$work/refuse.log"; then
	ok "the API refuses the development database password"
else
	fail "the API stopped, but not for the development password: $(tail -3 "$work/refuse.log")"
fi

echo
if [ "$failures" -ne 0 ]; then
	echo "$failures check(s) failed" >&2
	exit 1
fi
echo "compose smoke passed"
