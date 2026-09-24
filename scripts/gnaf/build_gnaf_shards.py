#!/usr/bin/env python3
"""
G-NAF, built into the static register the address service serves.

WHAT THIS IS
    Geoscape's G-NAF release (the Commonwealth's national address register,
    published quarterly on data.gov.au under the Open G-NAF EULA) is ~1.85 GB
    of pipe-separated tables across nine jurisdictions. The geocoding chain
    needs one question answered of it — where is this number on this street,
    in this postal area? — so this reduces the release to one small gzipped
    file per (state, postal area), in the format
    `supabase/functions/_shared/geocode/gnafShard.pure.ts` reads, plus a
    locality index (which postal areas hold addresses in each locality) and a
    manifest that says which release it is.

    It is NOT loaded into the production database: that is ~3.7 GB (sixty per
    cent on top of the database), a disk resize, a credential this repository
    does not hold, and rows that would never reach a clone. See
    `docs/integrations/ADDRESS_SERVICE.md`.

THREE SUBCOMMANDS
    resolve   Ask data.gov.au which file is the current GDA2020 release and
              print its description as JSON. Never a hard-coded URL: the
              resource id changes every quarter, and CKAN lists GDA94 first,
              so "the first zip" is the wrong datum.
    build     Verify a downloaded zip against that description, extract only
              the tables needed, join them in DuckDB, collapse units that stand
              at their building's point, write the shards, and REFUSE — exit
              non-zero, write nothing — if the result does not add up.
    (download is `curl` in the workflow: a 1.85 GB file wants curl's retry
    and resume, not a hand-written loop.)

WHAT IT REFUSES
    A zip whose size is not the catalogue's, whose first bytes are not a zip,
    or which lacks a table for a served state; a header missing a column this
    reads; a national total below the floor (a truncated or partial release
    is a smaller register, and a smaller register reads as "no such address"
    for every address it lost); a state with no rows. Every figure it counted
    goes into the manifest, so a load is asserted by its effect.

LICENCE
    Open G-NAF EULA: CC BY 4.0 with one restriction (no mailing lists compiled
    from it without verifying each address elsewhere). The attribution line
    travels on every geocode answer (`GNAF_ATTRIBUTION` in gnafShard.pure.ts).
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import io
import json
import os
import re
import shutil
import sys
import time
import urllib.request
import zipfile

PACKAGE_ID = '19432f89-dc3a-4ef3-b943-5326ef1dbecc'
CKAN_PACKAGE_SHOW = f'https://data.gov.au/data/api/3/action/package_show?id={PACKAGE_ID}'
# data.gov.au's CloudFront refused requests with no User-Agent (addressr, Apr 2026).
USER_AGENT = 'npc-property-dashboard/1.0 (+https://github.com/Naidu-Group-Pty-Ltd)'

SHARD_FORMAT = 1
SHARD_COLUMNS = ['n1p', 'n1', 'n1s', 'n2p', 'n2', 'n2s', 'lot', 'flat',
                 'street', 'type', 'suffix', 'locality', 'lat', 'lng', 'gt', 'pid']

# The chain serves the eight states and territories `AuState` names. Other
# Territories (Christmas Island, Cocos, Jervis Bay; ~4,300 addresses) are read
# but not served, and counted so the omission is visible.
SERVED_STATES = ('ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA')
ALL_STATES = SERVED_STATES + ('OT',)

MEMBER = re.compile(r'(?:^|/)Standard/(ACT|NSW|NT|OT|QLD|SA|TAS|VIC|WA)_([A-Z_]+?)_psv\.psv$')

REQUIRED_COLUMNS = {
    'ADDRESS_DETAIL': [
        'ADDRESS_DETAIL_PID', 'DATE_RETIRED', 'LOT_NUMBER_PREFIX', 'LOT_NUMBER', 'LOT_NUMBER_SUFFIX',
        'FLAT_TYPE_CODE', 'FLAT_NUMBER_PREFIX', 'FLAT_NUMBER', 'FLAT_NUMBER_SUFFIX',
        'LEVEL_TYPE_CODE', 'LEVEL_NUMBER', 'NUMBER_FIRST_PREFIX', 'NUMBER_FIRST', 'NUMBER_FIRST_SUFFIX',
        'NUMBER_LAST_PREFIX', 'NUMBER_LAST', 'NUMBER_LAST_SUFFIX', 'STREET_LOCALITY_PID', 'LOCALITY_PID',
        'ALIAS_PRINCIPAL', 'POSTCODE', 'CONFIDENCE',
    ],
    'ADDRESS_DEFAULT_GEOCODE': ['ADDRESS_DETAIL_PID', 'DATE_RETIRED', 'GEOCODE_TYPE_CODE', 'LONGITUDE', 'LATITUDE'],
    'STREET_LOCALITY': ['STREET_LOCALITY_PID', 'STREET_NAME', 'STREET_TYPE_CODE', 'STREET_SUFFIX_CODE'],
    'LOCALITY': ['LOCALITY_PID', 'LOCALITY_NAME', 'STATE_PID'],
    'STATE': ['STATE_PID', 'STATE_ABBREVIATION'],
    'LOCALITY_ALIAS': ['LOCALITY_PID', 'NAME', 'DATE_RETIRED'],
}
TABLES = tuple(REQUIRED_COLUMNS)

# A register a tenth smaller than the published one has lost ~1.6M addresses,
# every one of which would then read as "no such address". Aug 2026 publishes
# 15,949,543 current addresses; the floor is set well below that and far above
# any truncation that leaves a state standing.
DEFAULT_MIN_ADDRESSES = 14_000_000


class Refusal(Exception):
    """A reason to write nothing."""


def log(msg: str) -> None:
    print(msg, flush=True)


# ── resolve ──────────────────────────────────────────────────────────────────

def http_json(url: str) -> dict:
    req = urllib.request.Request(url, headers={'User-Agent': USER_AGENT, 'Accept': 'application/json'})
    with urllib.request.urlopen(req, timeout=60) as res:
        body = res.read()
    try:
        return json.loads(body)
    except json.JSONDecodeError as exc:
        raise Refusal(f'the catalogue answered with something that is not JSON: {body[:200]!r}') from exc


def release_label(name: str) -> str:
    """`AUG 2026 - Geoscape G-NAF - GDA2020` → `AUG 2026`."""
    head = name.split(' - ')[0].strip()
    return head or name.strip()


def choose_release(package: dict) -> dict:
    """The current GDA2020 zip in a CKAN `package_show` answer — named, never guessed."""
    if not package.get('success'):
        raise Refusal(f'package_show did not succeed: {json.dumps(package)[:300]}')
    resources = package.get('result', {}).get('resources', []) or []
    candidates = []
    for r in resources:
        name = str(r.get('name') or '')
        url = str(r.get('url') or '')
        fmt = str(r.get('format') or '').upper()
        if 'GDA2020' not in name.upper() or 'GDA94' in name.upper():
            continue
        if fmt != 'ZIP' and not url.lower().endswith('.zip'):
            continue
        if str(r.get('state') or 'active') != 'active':
            continue
        candidates.append(r)
    if not candidates:
        names = '; '.join(str(r.get('name')) for r in resources)
        raise Refusal(f'no active GDA2020 zip among {len(resources)} resources: {names}')
    candidates.sort(key=lambda r: str(r.get('last_modified') or r.get('created') or ''), reverse=True)
    r = candidates[0]
    size = r.get('size')
    return {
        'name': str(r.get('name')),
        'label': release_label(str(r.get('name'))),
        'resource_id': str(r.get('id')),
        'url': str(r.get('url')),
        'bytes': int(size) if isinstance(size, (int, float)) or (isinstance(size, str) and size.isdigit()) else None,
        'last_modified': r.get('last_modified') or r.get('created'),
        'datum': 'GDA2020',
    }


def cmd_resolve(args: argparse.Namespace) -> int:
    release = choose_release(http_json(CKAN_PACKAGE_SHOW))
    text = json.dumps(release, indent=2)
    if args.out:
        with open(args.out, 'w', encoding='utf-8') as fh:
            fh.write(text + '\n')
    print(text)
    return 0


# ── build ────────────────────────────────────────────────────────────────────

def sha256_of(path: str) -> str:
    h = hashlib.sha256()
    with open(path, 'rb') as fh:
        for chunk in iter(lambda: fh.read(8 * 1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def verify_zip(path: str, release: dict) -> dict:
    size = os.path.getsize(path)
    expected = release.get('bytes')
    if expected is not None and size != expected:
        raise Refusal(f'the zip is {size:,} bytes and the catalogue says {expected:,} — a truncated or different file')
    with open(path, 'rb') as fh:
        magic = fh.read(4)
    if magic != b'PK\x03\x04':
        raise Refusal(f'the file does not begin like a zip (first bytes {magic!r}) — probably an error page')
    return {'bytes': size, 'sha256': sha256_of(path)}


def select_members(zf: zipfile.ZipFile) -> dict[tuple[str, str], zipfile.ZipInfo]:
    chosen: dict[tuple[str, str], zipfile.ZipInfo] = {}
    for info in zf.infolist():
        m = MEMBER.search(info.filename)
        if not m:
            continue
        state, table = m.group(1), m.group(2)
        if table in TABLES:
            chosen[(state, table)] = info
    missing = [f'{s}_{t}' for s in SERVED_STATES for t in TABLES if (s, t) not in chosen]
    if missing:
        raise Refusal(f'the release lacks {len(missing)} table(s) a served state needs: {", ".join(missing[:12])}')
    return chosen


def extract(zf: zipfile.ZipFile, members: dict, work: str) -> dict[str, list[str]]:
    """Each chosen member to `work/<STATE>_<TABLE>.psv`, header checked against the columns this reads."""
    by_table: dict[str, list[str]] = {t: [] for t in TABLES}
    for (state, table), info in sorted(members.items()):
        dest = os.path.join(work, f'{state}_{table}.psv')
        with zf.open(info) as src, open(dest, 'wb') as out:
            shutil.copyfileobj(src, out, 8 * 1024 * 1024)
        with open(dest, 'r', encoding='utf-8-sig') as fh:
            header = fh.readline().strip().split('|')
        absent = [c for c in REQUIRED_COLUMNS[table] if c not in header]
        if absent:
            raise Refusal(f'{state}_{table} has no column {", ".join(absent)} (header: {"|".join(header)[:300]})')
        by_table[table].append(dest)
    return by_table


def build_tables(con, by_table: dict[str, list[str]]) -> None:
    for table, files in by_table.items():
        listing = '[' + ', '.join("'" + f.replace("'", "''") + "'" for f in files) + ']'
        con.execute(
            f"CREATE VIEW {table.lower()} AS SELECT * FROM read_csv({listing}, delim='|', header=true, "
            f"all_varchar=true, quote='', escape='', union_by_name=true)"
        )

    # Every current address with its street, locality, state and default
    # point. Retirement is CONFIDENCE = -1 (G-NAF's own rule since 2018), and
    # a retired default geocode is not the default any more.
    con.execute("""
        CREATE TABLE addr AS
        SELECT
          st.state_abbreviation                                   AS state,
          nullif(trim(ad.postcode), '')                           AS postcode,
          ad.address_detail_pid                                   AS pid,
          ad.street_locality_pid                                  AS slp,
          ad.locality_pid                                         AS lpid,
          coalesce(ad.alias_principal = 'P', false)               AS principal,
          coalesce(ad.number_first_prefix, '')                    AS n1p,
          coalesce(ad.number_first, '')                           AS n1,
          coalesce(ad.number_first_suffix, '')                    AS n1s,
          coalesce(ad.number_last_prefix, '')                     AS n2p,
          coalesce(ad.number_last, '')                            AS n2,
          coalesce(ad.number_last_suffix, '')                     AS n2s,
          CASE WHEN coalesce(ad.number_first, '') = ''
               THEN coalesce(ad.lot_number_prefix, '') || coalesce(ad.lot_number, '') || coalesce(ad.lot_number_suffix, '')
               ELSE '' END                                        AS lot,
          coalesce(ad.flat_number_prefix, '') || coalesce(ad.flat_number, '') || coalesce(ad.flat_number_suffix, '') AS flat,
          (ad.flat_type_code IS NOT NULL OR ad.flat_number IS NOT NULL
             OR ad.level_type_code IS NOT NULL OR ad.level_number IS NOT NULL) AS is_sub,
          sl.street_name                                          AS street,
          coalesce(sl.street_type_code, '')                       AS type,
          coalesce(sl.street_suffix_code, '')                     AS suffix,
          l.locality_name                                         AS locality,
          round(TRY_CAST(adg.latitude AS DOUBLE), 6)              AS lat,
          round(TRY_CAST(adg.longitude AS DOUBLE), 6)             AS lng,
          coalesce(adg.geocode_type_code, '')                     AS gt
        FROM address_detail ad
        JOIN street_locality sl ON ad.street_locality_pid = sl.street_locality_pid
        JOIN locality l ON ad.locality_pid = l.locality_pid
        JOIN state st ON l.state_pid = st.state_pid
        LEFT JOIN (SELECT * FROM address_default_geocode WHERE date_retired IS NULL) adg
               ON ad.address_detail_pid = adg.address_detail_pid
        WHERE TRY_CAST(ad.confidence AS INTEGER) > -1
    """)

    # What can be asked by number: a point, a postal area, a street, and a
    # street number or a lot.
    con.execute("""
        CREATE TABLE usable AS
        SELECT *, count(*) OVER (
            PARTITION BY state, postcode, slp, n1p, n1, n1s, n2p, n2, n2s, lot, lat, lng
        ) AS same_point
        FROM addr
        WHERE lat IS NOT NULL AND lng IS NOT NULL
          AND postcode IS NOT NULL AND street IS NOT NULL
          AND (n1 <> '' OR lot <> '')
    """)

    # One SITE row per street number (or lot) on a street: the base address's
    # own point where one exists, else the point most of its units share.
    con.execute("""
        CREATE TABLE site AS
        SELECT DISTINCT ON (state, postcode, slp, n1p, n1, n1s, n2p, n2, n2s, lot)
          state, postcode, slp, lpid, n1p, n1, n1s, n2p, n2, n2s, lot, '' AS flat,
          street, type, suffix, locality, lat, lng, gt, pid
        FROM usable
        ORDER BY state, postcode, slp, n1p, n1, n1s, n2p, n2, n2s, lot,
                 is_sub ASC, principal DESC, same_point DESC, pid ASC
    """)

    # A unit keeps a row of its own only where the register places it
    # somewhere other than its building — a townhouse on its own lot, a villa.
    con.execute("""
        CREATE TABLE unit AS
        SELECT u.state, u.postcode, u.slp, u.lpid, u.n1p, u.n1, u.n1s, u.n2p, u.n2, u.n2s, u.lot, u.flat,
               u.street, u.type, u.suffix, u.locality, u.lat, u.lng, u.gt, u.pid
        FROM usable u
        JOIN site s USING (state, postcode, slp, n1p, n1, n1s, n2p, n2, n2s, lot)
        WHERE u.is_sub AND u.flat <> '' AND (u.lat <> s.lat OR u.lng <> s.lng)
    """)
    con.execute("CREATE TABLE shard_rows AS SELECT * FROM site UNION ALL SELECT * FROM unit")


def count_by(con, sql: str) -> dict[str, int]:
    return {str(k): int(v) for k, v in con.execute(sql).fetchall()}


def write_gz(path: str, data: bytes) -> None:
    """Gzip with a zero mtime, so an unchanged release builds byte-identical files."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'wb') as raw:
        with gzip.GzipFile(fileobj=raw, mode='wb', compresslevel=9, mtime=0) as gz:
            gz.write(data)


def write_shards(con, out: str) -> tuple[int, int]:
    base = os.path.join(out, f'v{SHARD_FORMAT}')
    header = '|'.join(SHARD_COLUMNS) + '\n'
    cur = con.execute(f"""
        SELECT state, postcode, n1p, n1, n1s, n2p, n2, n2s, lot, flat, street, type, suffix, locality,
               lat, lng, gt, pid
        FROM shard_rows
        WHERE state IN ({', '.join("'" + s + "'" for s in SERVED_STATES)})
        ORDER BY state, postcode, street, type, suffix, TRY_CAST(n1 AS INTEGER), n1, lot, flat
    """)
    shards = 0
    rows = 0
    key = None
    buf: io.StringIO | None = None

    def flush() -> None:
        nonlocal shards
        if key is not None and buf is not None:
            write_gz(os.path.join(base, key[0], f'{key[1]}.psv.gz'), buf.getvalue().encode('utf-8'))
            shards += 1

    while True:
        batch = cur.fetchmany(200_000)
        if not batch:
            break
        for (state, postcode, *fields) in batch:
            if (state, postcode) != key:
                flush()
                key = (state, postcode)
                buf = io.StringIO()
                buf.write(header)
            *text, lat, lng, gt, pid = fields
            clean = [str(v or '').replace('|', ' ').replace('\n', ' ') for v in text]
            buf.write('|'.join(clean + [f'{lat:.6f}', f'{lng:.6f}', gt or '', pid or '']) + '\n')
            rows += 1
    flush()
    return shards, rows


def write_locality_index(con, out: str) -> int:
    states: dict[str, dict[str, set[str]]] = {}
    for state, locality, postcode in con.execute(
        f"SELECT DISTINCT state, locality, postcode FROM shard_rows WHERE state IN ({', '.join(repr(s) for s in SERVED_STATES)})"
    ).fetchall():
        states.setdefault(state, {}).setdefault(locality, set()).add(postcode)
    # Another name the register records for a locality reaches the same postal areas.
    for state, name, postcode in con.execute(f"""
        SELECT DISTINCT r.state, la.name, r.postcode
        FROM locality_alias la
        JOIN (SELECT DISTINCT state, lpid, postcode FROM shard_rows) r ON r.lpid = la.locality_pid
        WHERE la.date_retired IS NULL AND la.name IS NOT NULL
          AND r.state IN ({', '.join(repr(s) for s in SERVED_STATES)})
    """).fetchall():
        states.setdefault(state, {}).setdefault(name, set()).add(postcode)
    index = {
        'format': SHARD_FORMAT,
        'states': {s: {loc: sorted(pcs) for loc, pcs in sorted(locs.items())} for s, locs in sorted(states.items())},
    }
    write_gz(os.path.join(out, f'v{SHARD_FORMAT}', 'localities.json.gz'),
             json.dumps(index, separators=(',', ':'), sort_keys=True).encode('utf-8'))
    return sum(len(v) for v in states.values())


def cmd_build(args: argparse.Namespace) -> int:
    import duckdb  # imported here so `resolve` needs nothing installed

    with open(args.release, 'r', encoding='utf-8') as fh:
        release = json.load(fh)
    t0 = time.time()
    log(f'release   {release.get("name")} ({release.get("resource_id")})')
    file_facts = verify_zip(args.zip, release)
    log(f'zip       {file_facts["bytes"]:,} bytes, sha256 {file_facts["sha256"]}')

    work = args.work
    os.makedirs(work, exist_ok=True)
    with zipfile.ZipFile(args.zip) as zf:
        members = select_members(zf)
        member_sizes = {f'{s}_{t}': info.file_size for (s, t), info in sorted(members.items())}
        by_table = extract(zf, members, work)
    log(f'extracted {len(members)} tables, {sum(member_sizes.values()):,} bytes unpacked ({time.time() - t0:.0f}s)')

    # A fresh database every build: a scratch directory kept from an earlier
    # run must not hand this one its tables.
    db_path = os.path.join(work, 'gnaf.duckdb')
    for stale in (db_path, db_path + '.wal'):
        if os.path.exists(stale):
            os.remove(stale)
    con = duckdb.connect(db_path)
    con.execute(f"SET memory_limit='{args.memory}'")
    con.execute(f"SET temp_directory='{os.path.join(work, 'duckdb-tmp')}'")
    con.execute('SET preserve_insertion_order=false')
    build_tables(con, by_table)
    log(f'joined    ({time.time() - t0:.0f}s)')

    counts = {
        'addresses': con.execute('SELECT count(*) FROM addr').fetchone()[0],
        'addresses_by_state': count_by(con, 'SELECT state, count(*) FROM addr GROUP BY 1 ORDER BY 1'),
        'without_point': con.execute('SELECT count(*) FROM addr WHERE lat IS NULL OR lng IS NULL').fetchone()[0],
        'without_postcode': con.execute('SELECT count(*) FROM addr WHERE postcode IS NULL').fetchone()[0],
        'without_number_or_lot': con.execute("SELECT count(*) FROM addr WHERE n1 = '' AND lot = ''").fetchone()[0],
        'usable': con.execute('SELECT count(*) FROM usable').fetchone()[0],
        'site_rows': con.execute('SELECT count(*) FROM site').fetchone()[0],
        'unit_rows': con.execute('SELECT count(*) FROM unit').fetchone()[0],
        'rows_by_state': count_by(con, 'SELECT state, count(*) FROM shard_rows GROUP BY 1 ORDER BY 1'),
        'by_geocode_type': count_by(con, 'SELECT gt, count(*) FROM shard_rows GROUP BY 1 ORDER BY 2 DESC'),
    }

    # The refusals, before anything is written.
    if counts['addresses'] < args.min_addresses:
        raise Refusal(f'{counts["addresses"]:,} current addresses, below the floor of {args.min_addresses:,} — a partial release')
    empty = [s for s in SERVED_STATES if counts['rows_by_state'].get(s, 0) == 0]
    if empty:
        raise Refusal(f'no usable rows for {", ".join(empty)}')
    if counts['site_rows'] + counts['unit_rows'] < counts['usable'] * 0.4:
        raise Refusal('collapsing units removed more than 60% of usable addresses — the join is wrong, not the register')

    if os.path.exists(os.path.join(args.out, f'v{SHARD_FORMAT}')):
        shutil.rmtree(os.path.join(args.out, f'v{SHARD_FORMAT}'))
    shards, rows = write_shards(con, args.out)
    localities = write_locality_index(con, args.out)
    counts.update({'shards': shards, 'rows_written': rows, 'localities_indexed': localities})

    manifest = {
        'format': SHARD_FORMAT,
        'release': {**release, 'bytes': file_facts['bytes'], 'sha256': file_facts['sha256']},
        'members': member_sizes,
        'built_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'served_states': list(SERVED_STATES),
        'counts': counts,
        'licence': {
            'name': 'Open Geo-coded National Address File (G-NAF) End User Licence Agreement',
            'dataset': f'https://data.gov.au/data/dataset/{PACKAGE_ID}',
        },
    }
    with open(os.path.join(args.out, f'v{SHARD_FORMAT}', 'manifest.json'), 'w', encoding='utf-8') as fh:
        json.dump(manifest, fh, indent=2, sort_keys=True)
        fh.write('\n')

    log(json.dumps(counts, indent=2))
    log(f'wrote     {shards:,} shards, {rows:,} rows, {localities:,} locality names ({time.time() - t0:.0f}s)')
    if args.summary:
        with open(args.summary, 'a', encoding='utf-8') as fh:
            fh.write(summary_markdown(release, file_facts, counts))
    return 0


def summary_markdown(release: dict, file_facts: dict, counts: dict) -> str:
    lines = [
        '### G-NAF register built',
        '',
        f'- release: **{release.get("name")}** (resource `{release.get("resource_id")}`)',
        f'- file: {file_facts["bytes"]:,} bytes, sha256 `{file_facts["sha256"]}`',
        f'- current addresses: {counts["addresses"]:,} '
        f'(no point {counts["without_point"]:,}; no postcode {counts["without_postcode"]:,}; '
        f'no number or lot {counts["without_number_or_lot"]:,})',
        f'- rows served: {counts["rows_written"]:,} in {counts["shards"]:,} postal areas '
        f'({counts["site_rows"]:,} sites, {counts["unit_rows"]:,} units with a point of their own)',
        '',
        '| State | Addresses | Rows served |',
        '|---|---:|---:|',
    ]
    for state in ALL_STATES:
        lines.append(f'| {state} | {counts["addresses_by_state"].get(state, 0):,} | {counts["rows_by_state"].get(state, 0):,} |')
    lines += ['', 'Geocode types served: ' + ', '.join(f'{k or "?"} {v:,}' for k, v in counts['by_geocode_type'].items()), '']
    return '\n'.join(lines) + '\n'


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    sub = parser.add_subparsers(dest='cmd', required=True)
    r = sub.add_parser('resolve', help='print the current GDA2020 release as JSON')
    r.add_argument('--out', help='also write the JSON here')
    b = sub.add_parser('build', help='build the shards from a downloaded zip')
    b.add_argument('--zip', required=True)
    b.add_argument('--release', required=True, help='the JSON `resolve` printed')
    b.add_argument('--out', required=True, help='directory the service serves as /gnaf')
    b.add_argument('--work', required=True, help='scratch directory (needs ~8 GB for a national release)')
    b.add_argument('--memory', default='4GB')
    b.add_argument('--min-addresses', type=int, default=DEFAULT_MIN_ADDRESSES)
    b.add_argument('--summary', help='append a Markdown summary here (e.g. $GITHUB_STEP_SUMMARY)')
    args = parser.parse_args(argv)
    try:
        return cmd_resolve(args) if args.cmd == 'resolve' else cmd_build(args)
    except Refusal as refusal:
        log(f'REFUSED: {refusal}')
        return 2


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
