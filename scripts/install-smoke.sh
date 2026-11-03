#!/usr/bin/env bash
# scripts/install.sh as an operator runs it: from published images, in a directory with no source tree,
# then restarted and upgraded in place. docs/ops/INSTALL.md is what it checks.
#
#   bash scripts/install-smoke.sh            uses ghcr.io/project-rowcat/rowcat/{api,web,admin}:latest from
#                                            the local daemon (what `compose-smoke.sh --build` leaves)
#   INSTALL_SMOKE_IMAGES=localhost:5055/rowcat INSTALL_SMOKE_TAG=dev bash scripts/install-smoke.sh
#
# A throwaway registry on 127.0.0.1 stands in for GHCR, so the install really pulls and pins by digest
# without publishing anything. The upgrade's images are the same ones with one label added: a new
# digest, which is what an upgrade has to move to. Its own compose project and volume; both, the
# registry and the pushed tags are removed at the end. Ports 3000-3002 must be free.

set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
source_images="${INSTALL_SMOKE_IMAGES:-ghcr.io/project-rowcat/rowcat}"
source_tag="${INSTALL_SMOKE_TAG:-latest}"
port="${INSTALL_SMOKE_REGISTRY_PORT:-5055}"
registry="127.0.0.1:$port/rowcat-smoke"
export COMPOSE_PROJECT_NAME="${INSTALL_SMOKE_PROJECT:-rowcat-install-smoke}"
work="$(mktemp -d)"
deploy="$work/deploy"
reg_container="rowcat-install-smoke-registry"

failures=0
ok() { echo "ok    $1"; }
fail() {
	echo "FAIL  $1" >&2
	failures=$((failures + 1))
}
expect() { if [ "$2" = "$3" ]; then ok "$1"; else fail "$1 (expected '$2', got '$3')"; fi; }
mode_of() { stat -c '%a' "$1" 2>/dev/null || stat -f '%Lp' "$1"; }
dc() { (cd "$deploy" && docker compose "$@"); }
pinned() { sed -n "/^  $1:/,/build:/s/^    image: //p" "$deploy/compose.images.yml"; }
env_value() { sed -n "s/^$1=//p" "$deploy/.env"; }

cleanup() {
	[ -f "$deploy/.env" ] && dc down -v --remove-orphans >/dev/null 2>&1 || true
	docker rm -f "$reg_container" >/dev/null 2>&1 || true
	for app in api web admin; do
		docker image rm "$registry/$app:v1" "$registry/$app:v2" >/dev/null 2>&1 || true
	done
	rm -rf "$work"
}
trap cleanup EXIT

for app in api web admin; do
	docker image inspect "$source_images/$app:$source_tag" >/dev/null 2>&1 ||
		{ echo "install-smoke: no local image $source_images/$app:$source_tag — build it first" >&2 && exit 1; }
done
if docker volume inspect "${COMPOSE_PROJECT_NAME}_db-data" >/dev/null 2>&1; then
	echo "install-smoke: volume ${COMPOSE_PROJECT_NAME}_db-data exists from an earlier run — remove it first" >&2
	exit 1
fi

echo "--- a registry with two releases"
docker pull -q registry:2 >/dev/null
docker run -d --rm --name "$reg_container" -p "127.0.0.1:$port:5000" registry:2 >/dev/null
for _ in $(seq 1 50); do curl -fsS "http://127.0.0.1:$port/v2/" >/dev/null 2>&1 && break || sleep 0.2; done
for app in api web admin; do
	docker tag "$source_images/$app:$source_tag" "$registry/$app:v1"
	printf 'FROM %s\nLABEL org.rowcat.smoke=v2\n' "$registry/$app:v1" |
		docker build -q -t "$registry/$app:v2" - >/dev/null
	docker push -q "$registry/$app:v1" >/dev/null
	docker push -q "$registry/$app:v2" >/dev/null
	# Pulled back from the registry, never a leftover local tag, so the install proves the pull.
	docker image rm "$registry/$app:v1" "$registry/$app:v2" >/dev/null
done
ok "v1 and v2 pushed"

install() { bash "$root/scripts/install.sh" --source "$root" --registry "$registry" --dir "$deploy" "$@"; }

echo "--- refusals before anything is written"
if install --local --tag missing >"$work/missing.log" 2>&1; then
	fail "an unpublished tag installed"
else
	ok "an unpublished tag is refused"
fi
expect "the refusal names the image" 1 "$(grep -c "cannot pull $registry/api:missing" "$work/missing.log")"
expect "it builds nothing" 0 "$(grep -ci 'build' "$work/missing.log" || true)"
expect "it leaves no .env behind" no "$([ -f "$deploy/.env" ] && echo yes || echo no)"
if install --tag v1 >"$work/noshape.log" 2>&1; then fail "it installed with neither --domain nor --local"; else ok "--domain or --local is required"; fi

echo "--- install"
if install --local --tag v1 >"$work/install.log" 2>&1; then
	ok "it installs and comes up healthy"
else
	fail "the install failed: $(tail -3 "$work/install.log")"
	exit 1
fi
expect "the directory holds no source tree" "no" "$([ -d "$deploy/apps" ] || [ -d "$deploy/packages" ] && echo yes || echo no)"
expect ".env is owner-only" 600 "$(mode_of "$deploy/.env")"
expect "the session key is generated" 44 "$(env_value BETTER_AUTH_SECRET | tr -d '\n' | wc -c | tr -d ' ')"
expect "the database password is generated" 48 "$(env_value POSTGRES_PASSWORD | tr -d '\n' | wc -c | tr -d ' ')"
for app in api web admin; do
	expect "$app is pinned by digest" 1 "$(pinned "$app" | grep -c "^$registry/$app@sha256:[0-9a-f]\{64\}$")"
done
expect "five services run" 5 "$(dc ps --status running -q | wc -l | tr -d ' ')"
expect "the API answers" 200 "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3001/v2/health/ready)"
expect "the web answers" 200 "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/)"
expect "the console answers" 200 "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3002/setup)"
expect "the setup code is printed" 1 "$(grep -c 'first-run setup: open http://localhost:3002/setup, create your account, and enter [A-Z0-9-]\{8,\}' "$work/install.log")"
expect "setup is open" True "$(curl -fsS http://localhost:3001/v2/setup | python3 -c 'import json,sys; print(json.load(sys.stdin)["open"])')"
migrations() { dc exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "select count(*) from drizzle.__drizzle_migrations"' | tr -d '[:space:]'; }
before_migrations="$(migrations)"
expect "migrations ran" "$(find "$root/apps/api/drizzle" -maxdepth 1 -name '*.sql' | wc -l | tr -d ' ')" "$before_migrations"
secret_before="$(env_value BETTER_AUTH_SECRET)"
v1_api="$(pinned api)"

# The operator's next step: an account, then the printed code. An upgrade must keep this session.
origin='Origin: http://localhost:3002'
jar="$work/admin.cookies"
code="$(sed -nE 's/.*and enter ([A-Z0-9-]+)$/\1/p' "$work/install.log" | tail -1)"
# Functions, not JSON written inline in "$(…)": bash 3.2 (macOS) mangles escaped quotes nested there.
sign_up() {
	curl -s -c "$jar" -H "$origin" -H 'content-type: application/json' \
		-d "{\"name\":\"Operator\",\"email\":\"operator@install-smoke.test\",\"password\":\"$(openssl rand -hex 12)\"}" \
		-o /dev/null -w '%{http_code}' http://localhost:3001/v2/auth/sign-up/email
}
claim() {
	curl -s -b "$jar" -H "$origin" -H 'content-type: application/json' \
		-d "{\"code\":\"$code\"}" -o /dev/null -w '%{http_code}' http://localhost:3001/v2/setup/claim
}
expect "an account can be created" 200 "$(sign_up)"
expect "the printed code claims setup" 200 "$(claim)"
role() { curl -s -b "$jar" -H "$origin" http://localhost:3001/v2/me | python3 -c 'import json,sys; print(json.load(sys.stdin)["role"])'; }
expect "the operator is admin" admin "$(role)"

echo "--- restart"
dc restart api >/dev/null 2>&1
dc up -d --wait --pull never >/dev/null 2>&1 && ok "the API comes back after a restart" || fail "the API did not come back"
dc down >/dev/null 2>&1
dc up -d --wait --pull never >/dev/null 2>&1 && ok "the whole stack comes back after down/up" || fail "the stack did not come back"
expect "the database survived" "$before_migrations" "$(migrations)"
expect "it still answers" 200 "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3001/v2/health/ready)"

echo "--- install again in the same directory"
if install --local --tag v2 >"$work/again.log" 2>&1; then fail "--local was accepted on an existing deployment"; else ok "a second install is refused"; fi
expect "the refusal changed nothing" "$v1_api" "$(pinned api)"

echo "--- upgrade"
if install --tag v2 >"$work/upgrade.log" 2>&1; then
	ok "it upgrades and comes up healthy"
else
	fail "the upgrade failed: $(tail -3 "$work/upgrade.log")"
fi
expect "a backup came first" 1 "$(find "$deploy/backups" -name 'rowcat-*.dump' | wc -l | tr -d ' ')"
expect "the secrets are kept" "$secret_before" "$(env_value BETTER_AUTH_SECRET)"
expect "the tag moved" v2 "$(env_value ROWCAT_IMAGE_TAG)"
if [ "$(pinned api)" != "$v1_api" ] && pinned api | grep -q "@sha256:"; then ok "the pin moved to v2's digest"; else fail "the pin did not move ($(pinned api))"; fi
expect "the running API is the pinned image" "$(pinned api)" \
	"$(docker inspect --format '{{.Config.Image}}' "$(dc ps -q api)")"
expect "the database survived the upgrade" "$before_migrations" "$(migrations)"
expect "it answers after the upgrade" 200 "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3001/v2/health/ready)"
expect "the admin session survives the upgrade" admin "$(role)"
expect "no setup code once setup is claimed" 0 "$(grep -c 'first-run setup' "$work/upgrade.log" || true)"

if [ "$failures" -gt 0 ]; then
	echo "install-smoke: $failures failed (logs in $work were removed; rerun to inspect)" >&2
	exit 1
fi
echo "install-smoke: all passed"
