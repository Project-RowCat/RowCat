#!/usr/bin/env bash
# scripts/backup.sh's file handling, with no Docker and no database:
#
#   bash scripts/backup.test.sh
#
# A fake compose command stands in for `docker compose exec` (pg_dump writes a marker, pg_restore
# --list answers from it) and a fake `date` pins the clock, so "two runs in the same second" is a fact
# the test sets up rather than a race it hopes to hit. What the real dump and restore do is
# scripts/compose-smoke.sh's job (CI's compose job runs it against Postgres).

set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
backup="$root/scripts/backup.sh"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

failures=0
ok() { echo "  ok    $1"; }
fail() {
	echo "  FAIL  $1" >&2
	failures=$((failures + 1))
}
expect() { if [ "$2" = "$3" ]; then ok "$1"; else fail "$1 (expected '$2', got '$3')"; fi; }
mode_of() { stat -c '%a' "$1" 2>/dev/null || stat -f '%Lp' "$1"; }

STAMP=20261103T041500Z
mkdir -p "$tmp/bin"
cat >"$tmp/bin/date" <<EOF
#!/usr/bin/env bash
echo "$STAMP"
EOF

# FAKE_RUN marks the bytes, FAKE_BARRIER holds the dump until that many runs are inside it,
# FAKE_FAIL makes pg_dump die after writing half a file, FAKE_EMPTY makes it write nothing.
cat >"$tmp/compose" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
case "$4" in
sh)
	if [ -n "${FAKE_EMPTY:-}" ]; then exit 0; fi
	printf 'PGDMP partial %s\n' "$FAKE_RUN"
	if [ -n "${FAKE_FAIL:-}" ]; then exit 1; fi
	if [ -n "${FAKE_BARRIER:-}" ]; then
		touch "$FAKE_SYNC/$FAKE_RUN"
		for _ in $(seq 1 200); do
			[ "$(find "$FAKE_SYNC" -type f | wc -l | tr -d ' ')" -ge "$FAKE_BARRIER" ] && break
			sleep 0.05
		done
	fi
	printf 'PGDMP done %s\n' "$FAKE_RUN"
	;;
pg_restore)
	if grep -q 'PGDMP done' >/dev/null; then echo '3; 0 16390 TABLE DATA public member rowcat'; fi
	;;
*)
	echo "fake compose: unexpected $*" >&2
	exit 2
	;;
esac
EOF
chmod +x "$tmp/bin/date" "$tmp/compose"

run() { # run <dir> <run id> [env…]
	local dir="$1" id="$2"
	shift 2
	env PATH="$tmp/bin:$PATH" ROWCAT_COMPOSE="bash $tmp/compose" FAKE_RUN="$id" FAKE_SYNC="$tmp/sync" "$@" \
		bash "$backup" "$dir"
}
dumps() { find "$1" -maxdepth 1 -name 'rowcat-*.dump' | sort; }
leftovers() { find "$1" -maxdepth 1 -name '.rowcat-backup.*' | wc -l | tr -d ' '; }

echo "--- one run"
d="$tmp/one"
run "$d" a >/dev/null
expect "it writes the timestamped name" "$d/rowcat-$STAMP.dump" "$(dumps "$d")"
expect "the dump is the whole file" "PGDMP partial a
PGDMP done a" "$(cat "$d/rowcat-$STAMP.dump")"
expect "the dump is owner-only" 600 "$(mode_of "$d/rowcat-$STAMP.dump")"
expect "no working file is left" 0 "$(leftovers "$d")"

echo "--- two runs in the same second, overlapping inside pg_dump"
d="$tmp/two"
mkdir -p "$tmp/sync"
run "$d" a FAKE_BARRIER=2 >"$tmp/a.log" 2>&1 &
pa=$!
run "$d" b FAKE_BARRIER=2 >"$tmp/b.log" 2>&1 &
pb=$!
sa=0 sb=0
wait "$pa" || sa=$?
wait "$pb" || sb=$?
expect "both runs succeed" "0 0" "$sa $sb"
expect "they keep two files" "$d/rowcat-$STAMP-2.dump
$d/rowcat-$STAMP.dump" "$(dumps "$d")"
expect "each file is one run's whole dump" "a b" \
	"$(for f in $(dumps "$d"); do sed -n 's/^PGDMP done //p' "$f"; done | sort | tr '\n' ' ' | sed 's/ $//')"
for f in $(dumps "$d"); do expect "$(basename "$f") has no other run's bytes" 2 "$(wc -l <"$f" | tr -d ' ')"; done
expect "no working file is left" 0 "$(leftovers "$d")"

echo "--- the name is already taken"
d="$tmp/taken"
mkdir -p "$d"
echo "an older backup" >"$d/rowcat-$STAMP.dump"
run "$d" c >/dev/null
expect "the existing dump is untouched" "an older backup" "$(cat "$d/rowcat-$STAMP.dump")"
expect "the new dump takes the next name" "PGDMP done c" "$(sed -n 2p "$d/rowcat-$STAMP-2.dump")"

echo "--- every name is taken"
d="$tmp/full"
mkdir -p "$d"
touch "$d/rowcat-$STAMP.dump"
for n in $(seq 2 99); do touch "$d/rowcat-$STAMP-$n.dump"; done
if run "$d" e >/dev/null 2>"$tmp/full.log"; then fail "it succeeded with nowhere to write"; else ok "it fails instead of overwriting"; fi
expect "every existing file is still empty" 0 "$(cat "$d"/rowcat-*.dump | wc -c | tr -d ' ')"
expect "no working file is left" 0 "$(leftovers "$d")"

echo "--- pg_dump fails while another run is in progress"
d="$tmp/failed"
mkdir -p "$d"
echo "another run's dump in progress" >"$d/.rowcat-backup.other1"
if run "$d" f FAKE_FAIL=1 >/dev/null 2>&1; then fail "a failed pg_dump reported success"; else ok "a failed pg_dump fails the run"; fi
expect "it leaves no dump" "" "$(dumps "$d")"
expect "the other run's working file survives" "another run's dump in progress" "$(cat "$d/.rowcat-backup.other1")"
expect "only that file remains" 1 "$(leftovers "$d")"

echo "--- a dump with no table data"
d="$tmp/empty"
if run "$d" g FAKE_EMPTY=1 >/dev/null 2>&1; then fail "an empty dump was kept"; else ok "an empty dump fails the run"; fi
expect "it leaves no dump" "" "$(dumps "$d")"
expect "no working file is left" 0 "$(leftovers "$d")"

if [ "$failures" -gt 0 ]; then
	echo "backup.test: $failures failed" >&2
	exit 1
fi
echo "backup.test: all passed"
