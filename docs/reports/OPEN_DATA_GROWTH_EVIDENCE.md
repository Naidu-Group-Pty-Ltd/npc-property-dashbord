# Open-data growth evidence — the zero-cost growth stack

*15 September 2026. Read this before touching `_shared/reports/market/openData/*`,
`openDataSalesEvidence.pure.ts`, `salesRegisterRead.ts`, the
`market-sales-ingest` Edge Function, the `market_sales_medians` table, or the
open-data block in `generate-investment-report`'s market-evidence section.*

## 1. The problem it answers

The Investment Grade requires a capital-growth reading before a letter is
printed (`SCORING_V2_ACTIVATION.requiredDimensions = ['growth']`), and the
only wired source of one was Domain's suburb-performance series. Measured
from production on 15 Sep 2026, Domain answers every request on that key with
HTTP 403 *"Operation not permitted on project"* — the project the key belongs
to has no API package attached (`docs/integrations/DOMAIN_ACTIVATION_REQUEST.md`).
Attaching one is the owner's action in Domain's portal, and whether it costs
anything is a question Domain's portal does not answer in public.

The owner's brief was a no-cost route that changes no infrastructure and no
key. The 8 September zero-cost inventory (`zeroCostSources.pure.ts`, ME-6)
had concluded that the corpus sat in the two states with the least usable
open data — QLD (50.8%) and WA (20.6%) — and that Queensland published
"none". That finding was wrong about Queensland, and the correction is what
this document records.

## 2. What was measured, and from where

Two egresses matter and they disagree. The **production egress** is the
Supabase project's own network (`pg_net`), which a scheduled or operator-run
load actually uses; the development container reaches none of these hosts.
A third, a **GitHub-hosted runner**, was used to read the workbooks, because
`pg_net` stores a response as text and a workbook comes back as five bytes.
The manual workflow `.github/workflows/evidence-source-inspect.yml` is that
reader; it writes nothing and holds no secret.

| source | production egress (`pg_net` request) | GitHub runner | what it holds |
| --- | --- | --- | --- |
| QGSO residential land development activity spreadsheet, all monitored regions | **200**, `application/vnd.openxmlformats…`, 617,018 bytes (240150); page 200 (240130) | read: 18 sheets; `SalesDetached_Price`, `SalesDetached_Number`, `SalesAttached_Price`, `SalesAttached_Number`, each 99 rows × 104 columns | median price and number of detached and attached dwelling sales, **quarterly from June 2008 to March 2026**, for every monitored LGA plus regional groupings, from the Queensland Valuation and Sales database |
| NSW DCJ Rent and Sales Report, sales tables (March 2026 quarter) | **200**, PK header (240181); report page 200 (240153); previous-reports page 200 listing 70 workbooks back to 2017 (240256) | read: `Explanatory Notes`, `LGA` (2,850 rows), `Postcode` (1,455 rows) | sale-price quartiles, **median** (thousands of dollars) and **count** by postcode and by LGA, for `Total`, `Non Strata` and `Strata`; `-` where thirty or fewer sold; one workbook per quarter |
| VIC Property Sales Report, median house by suburb | 403 Cloudflare interstitial (ME-6: 126902/126922; DataVic and data.gov.au catalogue entries 200 but point at the same host: 240126/240127) | **403 "Just a moment…"** | the finest open series in the country, unreachable by a scripted client on three networks |
| SA metro median house sales | CKAN `package_show` **403** (240128), `package_search` 403 (240151) | 200: 43 quarterly XLSX resources, CC BY | reachable from GitHub only |
| City of Melbourne house prices by small area | 200 CSV (240185) | 200 | one LGA; the growth shape exactly |
| NSW Valuer General bulk PSI | `valuergeneral.nsw.gov.au` 403 (240125); `valuation.property.nsw.gov.au` DNS failure (240184) | DNS failure | individual sales; and the portal's licence page reads CC BY-NC-ND, which forbids commercial reuse |
| data.qld.gov.au CKAN | 202 bot challenge (240129) | — | not needed: QGSO's own site answers |
| WA catalogue | 200 (240131): Landgate "Sales Evidence data" and "Perth Metro" under *Custom (Other)* | — | **no open median sale price series in WA** |

The two that decide the strategy are the first two rows: Queensland at LGA
grain and New South Wales at postcode grain, both reachable from the
production egress under an open licence.

## 3. Licences, in the publishers' words

- **QGSO**: *"The Residential land development activity profiles are licensed
  under a Creative Commons Attribution 4.0 International licence. You are
  free to copy, communicate and adapt the work, as long as you attribute the
  authors."* (statistics.qgso.qld.gov.au/rlda-profiles). The site's general
  copyright notice says specific licence terms prevail over it.
- **DCJ**: *"Unless otherwise stated, material on this website is licensed
  under a Creative Commons Attribution 4.0 License (CC BY 4.0)."*
  (dcj.nsw.gov.au copyright and disclaimer).

Attribution travels on every row (`source`, `source_url`, `licence`) and on
every evidence point's `sourceNote`, and each point is stamped
`licensingStatus: 'open'`, `acquisition: 'open_public'` — the footing that
makes a figure both production evidence (`mayEnterProductionEvidence`) and
printable to a client (`mayReachClientReport`). Domain's series is neither
until its rights follow-up is answered.

Two sources were **refused on licence**, not reachability: SQM Research's
asking-price series ("for personal reference only … for commercial purposes
please reach out to us") and the NSW Valuer General's bulk sales (CC BY-NC-ND).
They would have been the easiest to fetch.

## 4. The register

`market_sales_medians` (migration `20261125090000`), one row shape for both
publishers:

| column | meaning |
| --- | --- |
| `state` | `QLD` or `NSW` |
| `area_kind` | `lga`, `postcode`, or `region` (a publisher grouping such as *South East Queensland*, and the state total — context and benchmark, never subject evidence) |
| `area` | the publisher's own label: `Moreton Bay (C)`, `2155`, `Total (all monitored regions)`, `New South Wales` |
| `area_token` | the lookup token (`salesAreaToken`): a postcode's digits, or the council name with its dressing stripped — `Moreton Bay (C)` and the cadastre's `MORETON BAY REGIONAL` both become `BAY MORETON` |
| `dwelling_type` | `house`, `attached`, or `any` (DCJ's *Total* — a real answer, never read as `house`) |
| `period` | the quarter the sales settled in, as its END month (`2026-03`) — the data's own vintage |
| `median_price`, `sales_count` | dollars and settled sales; **null where the publisher suppressed**, never zero |
| `source`, `source_url`, `licence` | attribution, on every row |

Three rules. **The period is the quarter, never the load date** — `asOf`
on every point is derived from it, and the growth confidence's freshness
factor ages it honestly. **An area is stored under the publisher's label and
found by token**, so one indexed read answers a cadastre council name or a
boundary-service postcode. **A suppressed figure is null**: DCJ prints `-`
where thirty or fewer sold; a zero median would be a real number about
nothing.

### The loader — `market-sales-ingest`

Stages, one per publisher, re-invoked to refresh:

- `qld` — fetches the QGSO residential development page, **discovers** the
  dated all-regions link (never a pinned URL: the file name carries its
  date), downloads the workbook, parses the four sales sheets
  (`qgsoRldaSales.pure.ts`) and upserts every LGA and regional quarter.
- `nsw` — lists the sales tables on the current and previous-reports pages
  (`dcjSalesLinks`), loads the newest quarter and the same quarter one,
  three, five and ten years earlier (`chooseDcjSalesFiles`; a horizon the
  publisher never issued is recorded as absent, never substituted), or the
  quarters named in `periods`. A workbook that refuses is recorded and the
  others still load; a run that loads nothing answers 422.
- `probe` — asks whether both pages answer from production, writes nothing.

The parsers refuse rather than store: a moved header (`Region / LGA`,
`Quarter`, `Median Sales Price`), a month that ends no quarter, a dwelling
label outside `Total / Non Strata / Strata`, a workbook whose own *Reporting
period* line disagrees with the quarter its link named, too few areas or
quarters, and a median outside the measured dollar bounds all throw before a
row is written. Every run writes a `market_sales_sync` row with the file,
its own vintage and the counts — or the refusal.

Run it from the production database (the same route the probes use; the
gateway JWT is on, and `verifyAuth` inside accepts the service role):

```sql
select net.http_post(
  url := rtrim((select decrypted_secret from vault.decrypted_secrets where name = 'supabase_url'), '/')
         || '/functions/v1/market-sales-ingest',
  headers := public.cron_service_role_headers(),
  body := '{"stage": "qld"}'::jsonb,
  timeout_milliseconds := 120000);
-- then '{"stage": "nsw"}', and read net._http_response for the detail.
```

Refresh cadence: QGSO publishes about ten weeks after a quarter ends; DCJ
about three months. Re-running a stage is idempotent (an upsert on the
primary key). No pg_cron job is scheduled by this change — the caller gate
(`check-cron-caller-names.mjs`) wants the signed route, and that is a
separate, small piece of work — so a load is an operator act, quarterly.

## 5. The adapter — `openDataSalesEvidence.pure.ts`

`openDataSalesPoints` turns one area's rows into the points the Growth
scorer reads: `medianPrice`, `priceSeries`, `growth1Year`,
`growth3YearCagr`, `growth5YearCagr`, `growth10YearCagr`, `salesCount`, and
from the state-wide row the `benchmark*` counterparts. The arithmetic is the
Domain adapter's (`compoundAnnualGrowth`), and a horizon is computed only
where the same quarter exists that many years earlier — never a nearer
quarter called a five-year figure.

**The grain is the publisher's, and the scorer prices it.** Every point
carries `level: 'lga'` (QLD) or `'postcode'` (NSW) and the area under the
publisher's own label; `growthScoring.pure.ts` scores the geography factor
at 55 for an LGA and 80 for a postcode against 100 for a suburb. A council
median is therefore a lower-confidence measurement of growth, never a
substitute claiming to be the suburb — and never absent. The zero-cost
inventory's grain rule was narrowed to match (`zeroCostEvidence.spec.ts`):
a state or capital-city price is context; a council or postcode median is
Growth at its own grain.

**The dwelling type is matched or said to be unmatched.** The engine's
`house` asks for the `house` series, then `any`; `attached` for `attached`,
then `any`; a fallback is stamped `dwellingTypeMatched: false` and noted,
and the dwelling-type confidence factor prices it. Land is refused: the
register holds dwelling sales.

## 6. Where the generator asks

In the market-evidence block of `generate-investment-report`, **after Domain
and before the population driver**. Queensland's register is keyed by local
government area, which the cadastre names for the verified coordinate
(`planningData.parcel.lga`); New South Wales's by postcode, which the
boundary service resolved (`marketPostcode`), with the cadastre's council as
a second ask where a postcode's rows are suppressed. Nothing is asked for a
typed suburb or a parsed four-digit token — the rule Domain and the crime
evidence answer to (`openDataGrowthWiring.spec.ts` pins it).

Where Domain also answered, `mergeEvidence` decides per measure: a
dwelling-matched point beats an unmatched one, then the finer geography
wins, so a suburb series outranks a council one the day Domain's package is
attached, with no code change. The provider is pushed to
`providersConsulted`, and an area the register does not hold is pushed to
`providersUnavailable` with the reason *"the register holds no rows for lga
X (load it with market-sales-ingest)"*, which the growth gap prints. The
gap's remedy now names the loader beside Domain's portal.

A second provider also lifts the scorer's `sourceIndependence` factor from
55 to 85 once Domain answers too — corroboration is scored as its own claim.

## 7. What a client sees

An open point prints its provenance: *"Moreton Bay (C) local government
area, QLD — houses, 1,873 sales, 2026-03-31"* (`describePoint`), and the
`sourceNote` names the Statistician's Office and the Queensland Valuation
and Sales database. Nothing here is withheld under licensing, which is the
difference from a Domain figure today.

## 8. What remains, honestly

- **Western Australia (20.6% of the Growth-ready corpus)** publishes no open
  median sale price series; Landgate's products are *Custom (Other)*. A WA
  report still withholds its grade for growth, and the gap says so.
- **Victoria** is walled to scripted clients on every egress tried. The
  licence permits the file; only a browser can fetch it. The route that
  would work — an operator downloads the CC BY workbook and the platform
  ingests the upload — is not wired: `evidenceIngestion.pure.ts` validates
  and projects but nothing on the generation path reads what it produces.
  A `vic` stage that takes an uploaded workbook is the next step.
- **South Australia** (2.9%) is refused from the production egress and open
  from GitHub; a runner-hosted loader posting to `market-sales-ingest` would
  reach it. Not built.
- **Tasmania, the ACT and the Northern Territory** were not measured for
  sale prices.
- **Domain stays first-class.** Attaching the package makes suburb-grain
  points, which win the merge; nothing here replaces that.
- **The first real grade under this stack is a production event**: the
  loader has not run against production and no report has been regenerated
  with the register populated. §9 lists the proof to take.

## 9. Verification

Verified here: 45 new specs across `openDataSalesRegister`, `qgsoRldaSales`,
`nswDcjSales`, `openDataSalesEvidence` and `openDataGrowthWiring`, plus the
updated `zeroCostEvidence` spec; the QGSO parser against the workbook's
transcribed header rows and the DCJ parser against transcribed postcode and
LGA rows; Deno type-checks of every new module and the loader; the generator
at its frozen 14 baseline errors with none from the wiring; the verify-jwt,
column-name, registry, static-auth, mass-assignment, error-disclosure and
cron-caller gates; eslint on every changed file.

Not verified here, and the order to take it in: (1) apply the migration;
(2) run `{"stage":"probe"}` and read the answer; (3) run `qld` and `nsw` and
read `market_sales_sync`; (4) invoke `investment-scoring-service` for a QLD
subject with a register-backed `marketEvidence` (or regenerate a QLD
report) and confirm `measuredDimensions` includes `growth` and the record
carries a grade; (5) the same for a NSW postcode.
