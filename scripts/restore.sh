#!/usr/bin/env bash
# Restores a dump from scripts/backup.sh into a deployment's database. docs/ops/BACKUP.md is the guide.
#
#   scripts/restore.sh <file.dump>
#
# Only into an empty database. It starts the db service alone and refuses when the database already
# has tables: a restore over live data is a merge nobody chose, and pg_restore --clean would drop
# whatever the dump does not know about. A fresh volume is the operator's explicit step:
#   docker compose down            (keep the old volume until the restore is checked — see the guide)
#   docker compose -p <new name> … or a new volume name, then this script
#
# The API is not started here. Start it once the restore reports success; it applies any migration
# newer than the dump on boot, so restoring an older backup onto a newer image is the supported way
# forward. The reverse (a newer dump onto an older image) is not: see the guide's rollback section.
#
# ROWCAT_COMPOSE overrides the compose command, as in scripts/backup.sh.

set -euo pipefail

compose="${ROWCAT_COMPOSE:-docker compose}"
file="${1:?usage: scripts/restore.sh <file.dump>}"
[ -r "$file" ] || {
	echo "restore: cannot read $file" >&2
	exit 1
}

$compose up -d --wait db >/dev/null

# shellcheck disable=SC2016  # expanded inside the container, on purpose
in_db() { $compose exec -T db sh -c "exec psql -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -tAc \"$1\""; }

tables="$(in_db "select count(*) from information_schema.tables where table_schema not in ('pg_catalog','information_schema')")"
if [ "$tables" != "0" ]; then
	echo "restore: the database already has $tables tables — refusing to restore over it" >&2
	echo "restore: bring it up on an empty volume first (docs/ops/BACKUP.md §복원)" >&2
	exit 1
fi

# --no-owner/--no-privileges: the restoring role owns everything, so a deployment whose POSTGRES_USER
# differs from the one that took the dump still restores. --exit-on-error: a half-restored database
# that boots is worse than none — the API would run migrations on it and serve it.
# shellcheck disable=SC2016
$compose exec -T db sh -c 'exec pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-privileges --exit-on-error' <"$file"

echo "restore: done — $(in_db "select count(*) from member") members, $(in_db "select count(*) from story") stories, $(in_db "select count(*) from media") media"
echo "restore: start the rest with 'docker compose up -d --wait' (BACKGROUND_JOBS_ENABLED=off first if you want to look before jobs run)"
