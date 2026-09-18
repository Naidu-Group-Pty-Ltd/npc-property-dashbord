#!/usr/bin/env bash
# Apply-and-probe for supabase/migrations/20261204000000_property_condition_records.sql
# in an ISOLATED PostgreSQL cluster — no network listener, its own data
# directory, its own socket, torn down afterwards. Nothing here touches any
# remote database.
#
# Why this exists: the migration's original findings-shape constraint put a
# subquery inside a CHECK, which PostgreSQL refuses AT APPLY TIME (0A000) —
# an error the repository's static migration guards cannot see, because they
# read the file and never apply it. probe-0 proves that refusal on the old
# form; then the corrected migration is applied VERBATIM and probes.sql
# exercises valid and invalid records, document/report linkage, role
# permissions, RLS boundaries and the correction/history behaviour.
#
# Environment note: this container ships PostgreSQL 16.13 server binaries;
# production runs PostgreSQL 17.4. Nothing probed here (CHECK subquery
# refusal, jsonb operators, RLS, trigger semantics, FK actions) differs
# between the two majors, and the constraint set is additionally guarded by
# CI's static checks — but the version difference is a fact of the run and
# is recorded in the transcript.
#
# Usage: scripts/verify/migration-isolated/run.sh
#   KEEP_CLUSTER=1 keeps the data directory for inspection.

set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
MIGRATION="$REPO/supabase/migrations/20261204000000_property_condition_records.sql"

BASE="$REPO/.verify/pg-iso"           # .verify/ is gitignored
DATA="$BASE/data"                     # initdb needs this empty; logs live beside it
SOCK="$(mktemp -d)"                   # a unix socket path must stay short

# Postgres refuses to run as root. In the hosted container this script runs
# as root, so the SERVER runs as the packaged `postgres` OS user; psql stays
# with the caller and connects over the private socket with trust auth.
AS_PG=()
if [ "$(id -u)" = "0" ]; then
  AS_PG=(runuser -u postgres --)
fi

cleanup() {
  "${AS_PG[@]}" "$PGBIN/pg_ctl" -D "$DATA" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$SOCK"
  if [ "${KEEP_CLUSTER:-0}" != "1" ]; then rm -rf "$BASE"; fi
}
trap cleanup EXIT

rm -rf "$BASE"
mkdir -p "$BASE"
if [ "${#AS_PG[@]}" -gt 0 ]; then chown postgres "$BASE" "$SOCK"; fi

echo "== Isolated migration test: 20261204000000_property_condition_records.sql =="
echo "date (UTC):     $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "server:         $("$PGBIN/postgres" --version)"
echo "client:         $(psql --version)"
echo "production is:  PostgreSQL 17.4 (this run is 16.x — see header of run.sh)"
echo "cluster:        $DATA (isolated; listen_addresses=''; socket $SOCK)"
echo "migration:      applied VERBATIM from the repository file"
echo "stand-ins:      scripts/verify/migration-isolated/setup.sql (auth.uid() is a stub;"
echo "                app_role / user_roles / has_role are verbatim from 20251224033443)"
echo

"${AS_PG[@]}" "$PGBIN/initdb" -D "$DATA" -U postgres -A trust --no-sync >"$BASE/initdb.log" 2>&1
"${AS_PG[@]}" "$PGBIN/pg_ctl" -D "$DATA" -w -l "$BASE/server.log" \
  -o "-k $SOCK -c listen_addresses='' -c fsync=off" start >/dev/null

PSQL=("$PGBIN/psql" -h "$SOCK" -U postgres -X -v ON_ERROR_STOP=1)

"${PSQL[@]}" -d postgres -q -c 'CREATE DATABASE migration_probe' >/dev/null
"${PSQL[@]}" -d migration_probe -q -c 'SELECT version()' -t | sed 's/^ */server:  /'

echo
echo "-- setup: production stand-ins --"
"${PSQL[@]}" -d migration_probe -q -f "$HERE/setup.sql"
echo "stand-ins applied"

echo
"${PSQL[@]}" -d migration_probe -f "$HERE/probe-0-subquery-refused.sql"

echo
echo "-- applying the migration verbatim --"
"${PSQL[@]}" -d migration_probe -q -f "$MIGRATION"
echo "applied without error"

"${PSQL[@]}" -d migration_probe -f "$HERE/probes.sql"

echo
echo "== RESULT: migration applied verbatim and every probe passed =="
