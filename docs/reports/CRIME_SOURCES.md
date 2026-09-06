# Recorded crime — the sources, verified by execution

2026-09-06. Every figure below was produced by downloading and parsing the
real files, not by reading documentation. This is the acquisition log for
`_shared/crimeIngest.pure.ts`, the `crime-data-ingest` edge function and
the rewired `crime-statistics-service`.

## The two integrated registers

### NSW — BOCSAR, by POSTCODE

`https://bocsarblob.blob.core.windows.net/bocsar-open-data/PostcodeData.zip`
("Recorded criminal incidents by month – by postcode", one of BOCSAR's
published open datasets; quarterly releases).

Measured: a 4.2 MB zip holding one 60 MB CSV — **38,564 rows, 622
postcodes, 21 offence categories** (transcribed verbatim into
`NSW_OFFENCE_CATEGORIES`), wide format with one column per month,
**Jan 1995 → Dec 2025**. Postcode-keyed, which is the platform's own
geography (the ABS POA tables and the report pipeline key the same way).

BOCSAR also publishes suburb quarterly data, per-LGA workbooks and
pre-computed 2/10-year trend books (`LGA_trends.xlsx` — LGA × offence ×
ten Apr–Mar years); the postcode monthly dataset was chosen because it
matches the request geography exactly and needs no name matching.

### QLD — QPS, by LOCAL GOVERNMENT AREA

`https://open-crime-data.s3-ap-southeast-2.amazonaws.com/Crime%20Statistics/LGA_Reported_Offences_Number.csv`
(data.qld.gov.au dataset `lga_reported_offences_number`; monthly releases).

Measured: 5.7 MB, **23,946 rows, 78 LGAs, months JAN01 → JUL26**,
2,226,978 numeric cells with zero blanks. Long format, one row per
(LGA, month), one column per offence.

Three quirks, all load-bearing:

1. **The header is 94 columns; every data row carries 95 cells.** The
   95th is an unnamed running row counter (Aurukun JAN01 = 1, FEB01 = 2 …
   across all 23,946 rows). The parser validates it equals the row number
   and discards it — a mismatch means column alignment cannot be trusted
   and the load refuses.
2. **`Common Assault'` carries a stray apostrophe** — QPS's own header,
   transcribed exactly (`QLD_HEADER`); "fixing" it would be the invisible
   column-name drift the 42703 class taught.
3. **The columns mix rollups with details**, so summing columns
   double-counts. The hierarchy was MEASURED (400/400 sampled rows per
   identity): `Offences Against the Person` = Homicide (Murder) + Other
   Homicide + Assault + Sexual Offences + Robbery + Other Offences Against
   the Person; `Offences Against Property` = its 7 parts; `Other Offences`
   = its 11 parts; Assault/Robbery/Sexual Offences decompose likewise
   (`QLD_DIVISIONS`). The ingest re-checks a sample per load and the
   reading layer presents ONE level at a time.

## What is stored

`crime_reference`: one compact row per (state, area_kind, area, offence) —
last-12-month and prior-12-month counts plus the last six complete
calendar-year totals, with `latest_month`/`series_from` read from the
data itself (freshness of a load is not currency of the data). Each state
also writes `state_total` rows (plain addition over every area in the same
file) and a `crime_state_benchmarks` row.

**The NSW benchmark's denominator is named**: the 2021 Census
usual-resident population of exactly the postcodes in the BOCSAR file,
joined on the file's own keys — never a typed-in state figure. On the
first production load all **622 of 622** postcodes matched
`abs_census_poa`, giving 617,838 recorded offences (Jan–Dec 2025) over
8.13 M residents ≈ **7,598 per 100k**. QLD's benchmark carries counts
only (no LGA population source is integrated yet; the T-stream's ERP work
is where that lands), so QLD readings offer state count-change context and
never a rate with an unnamed denominator.

## What the reading refuses to say

No `safetyScore`, no `overallRating`, no trend adjective, no per-capita
rate without its denominator: the fabricated predecessor (§24) invented
all four, and a spec now bans the vocabulary from the reading, the
service and the prompt block. What a report gets is counts, their
arithmetic (change on the same window a year earlier, six-year totals),
the postcode's per-100k rate beside the state's where the denominator
exists, and the register's own reference period and name.

## Production load (2026-09-06)

Two lessons were paid for during the first load and are now in the code:

- **A whole-table bootstrap seals after stage one.** Both stages write
  `crime_reference`, so after QLD loaded, the NSW stage answered
  `forbidden`. The bootstrap arm is per STATE now: each state's first
  load opens without the secret and seals itself.
- **A 60 MB string does not fit the edge worker.** The first NSW attempt
  died at `WORKER_RESOURCE_LIMIT` inflating the zip via jszip. The stage
  now locates the single deflate entry from the zip's central directory
  (`zipSingleDeflateSpan`) and STREAMS it through
  `DecompressionStream('deflate-raw')` into the incremental accumulator —
  verified byte-identical to the whole-string parse against the real
  archive before deploying.

Loaded and spot-checked in production, byte-identical to the local parse:
NSW 13,062 + 21 rows (latest 2025-12; POA 2150 Theft 2,968 last 12 months
vs 2,830 prior); QLD 7,176 + 92 rows (latest **2026-07**; Brisbane
Unlawful Entry 2023 total 12,963).

## The states that are honestly absent

VIC's Crime Statistics Agency refuses scripted clients (the DFAT class);
SA/WA/TAS/NT/ACT publish LGA or suburb tables in varying shapes none of
which has been verified by execution yet. `crime-statistics-service`
answers `no_data_for_location` for them, naming the real register — a
state without a loaded register has no figures, not borrowed ones.

## Refresh

Re-invoke the stages (`{"stage":"nsw"}` quarterly, `{"stage":"qld"}`
monthly) with the internal edge secret; rows carry the data's own months,
and every parse re-runs the full refusal battery, so a drifted or
truncated file refuses instead of loading.
