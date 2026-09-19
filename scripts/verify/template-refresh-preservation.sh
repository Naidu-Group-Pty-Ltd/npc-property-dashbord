#!/usr/bin/env bash
#
# What the v15 library refresh does to an adopted template, proven by applying
# it to a throwaway PostgreSQL rather than by reading the SQL.
#
#   bash scripts/verify/template-refresh-preservation.sh
#
# The question it answers is not "did the read path change" — that is
# `read-path-preservation.mts`, which compares what a READER of a stored report
# gets at two revisions and touches no template. This is the other half: a
# library refresh REWRITES rows in `report_templates`, and what it preserves on
# an adopted copy is a different question with a different answer.
#
# The answer, stated plainly: the refresh replaces the row's whole `schema`
# with the library entry's and carries forward only `tokens.colors`. A tenant
# palette survives. A tenant typeface, page, block, section or binding does
# not. That is deliberate — a master fix has to reach the copies people
# generate from — and it is why the snapshot exists.
set -uo pipefail

PGPORT="${TEMPLATE_REFRESH_PGPORT:-54401}"
PGDIR="${TEMPLATE_REFRESH_PGDIR:-/tmp/pgtplrefresh}"
SOCK=/tmp
MIGRATION=supabase/migrations/20261204030000_refresh_active_masters_from_library_v15.sql

PGBIN=""
for d in /usr/lib/postgresql/*/bin /usr/pgsql-*/bin /usr/local/pgsql/bin /usr/bin; do
  [ -x "$d/initdb" ] && [ -x "$d/pg_ctl" ] && PGBIN="$d"
done
if [ -z "$PGBIN" ]; then
  echo "No PostgreSQL server binaries (initdb/pg_ctl) found — skipping these checks."
  exit 0
fi
PSQL_BIN="$(command -v psql || echo "$PGBIN/psql")"
psql_() { "$PSQL_BIN" -h "$SOCK" -p "$PGPORT" -U postgres "$@"; }
q() { psql_ -tAc "$1"; }

fails=0
ok() {
  if [ "$2" == "$3" ]; then printf '  ✓ %s\n' "$1"
  else printf '  ✗ %s — expected %s, got %s\n' "$1" "$3" "$2"; fails=$((fails+1)); fi
}

if [ -d "$PGDIR" ]; then
  su postgres -c "$PGBIN/pg_ctl -D $PGDIR -m immediate stop" >/dev/null 2>&1 || true
  sleep 1; rm -rf "$PGDIR"
fi
rm -f "$SOCK/.s.PGSQL.$PGPORT" 2>/dev/null || true
mkdir -p "$PGDIR" && chown postgres:postgres "$PGDIR"
su postgres -c "$PGBIN/initdb -U postgres -A trust -D $PGDIR" >/dev/null 2>&1
su postgres -c "$PGBIN/pg_ctl -D $PGDIR -o '-p $PGPORT -k $SOCK' -l /tmp/pg-tplrefresh.log start" >/dev/null 2>&1
for _ in $(seq 1 30); do q 'select 1' >/dev/null 2>&1 && break; sleep 1; done
q 'select 1' >/dev/null 2>&1 || { echo "postgres did not start on :$PGPORT"; cat /tmp/pg-tplrefresh.log; exit 1; }

# ── Four rows, each a case the refresh has to get right ────────────────────
psql_ -q -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
create extension if not exists pgcrypto;
create table public.template_library_entries (
  id uuid primary key, status text not null, version int not null, schema jsonb);
create table public.report_templates (
  id uuid primary key, is_active boolean not null default true,
  schema jsonb not null, config jsonb not null, updated_at timestamptz default now());

insert into public.template_library_entries values
 ('11111111-1111-1111-1111-111111111111','published',15,
  '{"tokens":{"colors":{"primary":"#111"},"fonts":{"body":"Inter"}},
    "pages":[{"name":"Contents","blocks":[{"type":"text-block","props":{"body":"{{report.companionNote}}"}}]}]}'::jsonb);

-- A  a plain adoption carrying a tenant palette and nothing else of its own
insert into public.report_templates values
 ('aaaaaaaa-0000-0000-0000-000000000001', true,
  '{"tokens":{"colors":{"primary":"#C8A24A"},"fonts":{"body":"Inter"}},
    "pages":[{"name":"Contents","blocks":[]}]}'::jsonb,
  '{"libraryLineage":{"entryId":"11111111-1111-1111-1111-111111111111","entryVersion":14}}'::jsonb, now());

-- B  adopted AND customised beyond colours: a tenant typeface and an extra page
insert into public.report_templates values
 ('bbbbbbbb-0000-0000-0000-000000000002', true,
  '{"tokens":{"colors":{"primary":"#0B5"},"fonts":{"body":"Tenant Grotesk"}},
    "pages":[{"name":"Contents","blocks":[]},
             {"name":"Tenant addendum","blocks":[{"type":"text-block","props":{"body":"our own page"}}]}]}'::jsonb,
  '{"libraryLineage":{"entryId":"11111111-1111-1111-1111-111111111111","entryVersion":14}}'::jsonb, now());

-- C  no library lineage: the author's own document
insert into public.report_templates values
 ('cccccccc-0000-0000-0000-000000000003', true,
  '{"tokens":{"colors":{"primary":"#999"}},"pages":[{"name":"Bespoke","blocks":[]}]}'::jsonb,
  '{}'::jsonb, now());

-- D  an inactive draft
insert into public.report_templates values
 ('dddddddd-0000-0000-0000-000000000004', false,
  '{"tokens":{"colors":{"primary":"#777"}},"pages":[]}'::jsonb,
  '{"libraryLineage":{"entryId":"11111111-1111-1111-1111-111111111111","entryVersion":14}}'::jsonb, now());
SQL

echo "── applying $MIGRATION ──"
psql_ -q -v ON_ERROR_STOP=1 -f "$MIGRATION" || { echo "migration failed"; exit 1; }

echo
echo "── what it refreshed, and what it recorded first ──"
psql_ -v ON_ERROR_STOP=1 <<'SQL'
\pset border 2
select left(template_id::text,8) as "row", differing_keys as "keys it changed",
       jsonb_array_length(schema->'pages') as "pages before"
  from public.report_template_refresh_snapshots order by 1;
select left(id::text,8) as "row",
       schema->'tokens'->'colors'->>'primary' as "palette after",
       schema->'tokens'->'fonts'->>'body'     as "typeface after",
       jsonb_array_length(schema->'pages')    as "pages after",
       config->'libraryLineage'->>'entryVersion' as "lineage",
       coalesce(schema->'pages'->0->'blocks'->0->'props'->>'body','(none)') as "first block after"
  from public.report_templates order by 1;
SQL

echo
echo "── assertions ──"
ok "A: the adopted row keeps its own palette"           "$(q "select schema->'tokens'->'colors'->>'primary' from public.report_templates where id='aaaaaaaa-0000-0000-0000-000000000001'")" "#C8A24A"
ok "A: the adopted row takes the master's new content"  "$(q "select schema->'pages'->0->'blocks'->0->'props'->>'body' from public.report_templates where id='aaaaaaaa-0000-0000-0000-000000000001'")" "{{report.companionNote}}"
ok "A: lineage advances to the entry version"           "$(q "select config->'libraryLineage'->>'entryVersion' from public.report_templates where id='aaaaaaaa-0000-0000-0000-000000000001'")" "15"
ok "B: a customised palette also survives"              "$(q "select schema->'tokens'->'colors'->>'primary' from public.report_templates where id='bbbbbbbb-0000-0000-0000-000000000002'")" "#0B5"
ok "B: a customised TYPEFACE does not survive"          "$(q "select schema->'tokens'->'fonts'->>'body' from public.report_templates where id='bbbbbbbb-0000-0000-0000-000000000002'")" "Inter"
ok "B: a customised extra PAGE does not survive"        "$(q "select jsonb_array_length(schema->'pages') from public.report_templates where id='bbbbbbbb-0000-0000-0000-000000000002'")" "1"
ok "C: a row with no library lineage is untouched"      "$(q "select schema->'pages'->0->>'name' from public.report_templates where id='cccccccc-0000-0000-0000-000000000003'")" "Bespoke"
ok "C: and is not snapshotted"                          "$(q "select count(*) from public.report_template_refresh_snapshots where template_id='cccccccc-0000-0000-0000-000000000003'")" "0"
ok "D: an inactive draft is untouched"                  "$(q "select config->'libraryLineage'->>'entryVersion' from public.report_templates where id='dddddddd-0000-0000-0000-000000000004'")" "14"
ok "D: and is not snapshotted"                          "$(q "select count(*) from public.report_template_refresh_snapshots where template_id='dddddddd-0000-0000-0000-000000000004'")" "0"
ok "two rows were refreshed, and two snapshotted"       "$(q "select count(*) from public.report_template_refresh_snapshots")" "2"
ok "the snapshot holds the PRE-refresh typeface"        "$(q "select schema->'tokens'->'fonts'->>'body' from public.report_template_refresh_snapshots where template_id='bbbbbbbb-0000-0000-0000-000000000002'")" "Tenant Grotesk"
ok "the snapshot table is RLS-enabled"                  "$(q "select relrowsecurity from pg_class where relname='report_template_refresh_snapshots'")" "t"
ok "and carries no policy, so only the service role reads it" "$(q "select count(*) from pg_policies where tablename='report_template_refresh_snapshots'")" "0"

echo
echo "── the documented restoration, run verbatim ──"
psql_ -q -v ON_ERROR_STOP=1 <<'SQL'
update public.report_templates t
set schema = s.schema, config = s.config, updated_at = now()
from public.report_template_refresh_snapshots s
where s.template_id = t.id
  and s.migration = '20261204030000_refresh_active_masters_from_library_v15'
  and t.id = 'bbbbbbbb-0000-0000-0000-000000000002';
SQL
ok "B: the typeface is back"      "$(q "select schema->'tokens'->'fonts'->>'body' from public.report_templates where id='bbbbbbbb-0000-0000-0000-000000000002'")" "Tenant Grotesk"
ok "B: the extra page is back"    "$(q "select jsonb_array_length(schema->'pages') from public.report_templates where id='bbbbbbbb-0000-0000-0000-000000000002'")" "2"
ok "B: the palette is back"       "$(q "select schema->'tokens'->'colors'->>'primary' from public.report_templates where id='bbbbbbbb-0000-0000-0000-000000000002'")" "#0B5"
ok "B: the lineage is back"       "$(q "select config->'libraryLineage'->>'entryVersion' from public.report_templates where id='bbbbbbbb-0000-0000-0000-000000000002'")" "14"

echo
echo "── idempotence: a second application ──"
psql_ -q -v ON_ERROR_STOP=1 -f "$MIGRATION" >/dev/null || { echo "second application failed"; fails=$((fails+1)); }
ok "A is unchanged by the second run"  "$(q "select config->'libraryLineage'->>'entryVersion' from public.report_templates where id='aaaaaaaa-0000-0000-0000-000000000001'")" "15"
ok "a second snapshot is taken, never overwritten" "$(q "select count(*) from public.report_template_refresh_snapshots")" "4"

su postgres -c "$PGBIN/pg_ctl -D $PGDIR -m immediate stop" >/dev/null 2>&1 || true
echo
if [ "$fails" -eq 0 ]; then echo "template refresh preservation: all assertions passed"; exit 0; fi
echo "template refresh preservation: $fails assertion(s) failed"; exit 1
