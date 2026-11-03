#!/usr/bin/env bash
# One consistent backup of a running compose deployment's database. docs/ops/BACKUP.md is the guide.
#
#   scripts/backup.sh [directory]      writes <directory>/rowcat-<UTC timestamp>.dump (default: ./backups)
#
# A run that finds that name taken (two runs in the same second, a clock set back) takes
# rowcat-<UTC timestamp>-2.dump, -3, … instead: a backup never replaces another one.
#
# The database is the whole deployment: accounts, sessions, stories, comments, the encrypted sync
# records, first-run state, and the media bytes themselves (avatars, covers, scene images, runtime
# assets and audio live in Postgres — the only storage adapter is lib/media/postgres-store.ts). Redis
# holds rate-limit counters and caches only, and Caddy's certificates are re-issued by themselves.
#
# pg_dump reads one MVCC snapshot, so the API and the background jobs keep running while it does:
# what lands in the file is the database as of one instant, never half of a transaction.
#
# What this file is not: the .env. BETTER_AUTH_SECRET signs every session and also encrypts the
# stored two-factor secrets; a dump restored under a different key keeps its accounts but signs
# everyone out and turns every authenticator off for good. Keep a copy of .env with the backups —
# separately and encrypted, since it holds the database password as well.
#
# Run from the repository root of the deployment, where `docker compose` already finds its files
# (COMPOSE_FILE in .env is honoured). ROWCAT_COMPOSE overrides the command, e.g. for another project:
#   ROWCAT_COMPOSE="docker compose -p staging" scripts/backup.sh

set -euo pipefail

compose="${ROWCAT_COMPOSE:-docker compose}"
dir="${1:-backups}"

# A dump is the deployment's private data in one file: owner-only from its first byte.
umask 077
mkdir -p "$dir"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
# The working file belongs to this run alone. Named from the timestamp, two runs in the same second
# wrote into one file and each one's cleanup deleted the other's dump. mktemp creates it 0600 and
# never reuses a name; the leading dot keeps it out of `rowcat-*.dump` (the cron cleanup's pattern).
partial="$(mktemp "$dir/.rowcat-backup.XXXXXX")"
trap 'rm -f "$partial"' EXIT

# The role and database names come from the db container's own environment, so this needs no copy of
# POSTGRES_USER/POSTGRES_DB and cannot disagree with them. Custom format (-Fc): compressed, and
# pg_restore can list and check it without restoring.
# shellcheck disable=SC2016  # expanded inside the container, on purpose
$compose exec -T db sh -c 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' >"$partial"

# A dump that pg_restore cannot list is not a backup. Checked before the file takes its final name, so
# a name in the directory always means a readable dump.
entries="$($compose exec -T db pg_restore --list <"$partial" | grep -c ' TABLE DATA ' || true)"
if [ "$entries" -eq 0 ]; then
	echo "backup: the dump lists no table data — not keeping it" >&2
	exit 1
fi

# The final name is claimed with a hard link, which fails when the name exists: taking it and filling
# it are one step, so no run replaces another's dump and no reader ever sees a half-written one under
# a final name. (`mv` would overwrite, and `mv -n` checks then renames — two steps on most systems.)
file=""
for n in "" $(seq 2 99); do
	candidate="$dir/rowcat-$stamp${n:+-$n}.dump"
	if ln "$partial" "$candidate" 2>/dev/null; then
		file="$candidate"
		break
	fi
	if [ ! -e "$candidate" ] && [ ! -L "$candidate" ]; then
		# Not taken, yet the link failed: a filesystem without hard links, or no permission. Guessing
		# another way to finalize would bring back the overwrite this loop exists to prevent.
		echo "backup: cannot create $candidate (does $dir support hard links?)" >&2
		exit 1
	fi
done
if [ -z "$file" ]; then
	echo "backup: rowcat-$stamp.dump and its 98 alternatives are all taken — not overwriting any" >&2
	exit 1
fi
rm -f "$partial"
trap - EXIT

echo "backup: $file ($(wc -c <"$file" | tr -d ' ') bytes, $entries tables)"
echo "backup: keep .env (BETTER_AUTH_SECRET) with it — the dump alone cannot restore sessions or 2FA"
