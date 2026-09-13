# Runtime consolidation — Supabase + the browser, and no Cloud Run

> **Target architecture, set in stone.** Frontend/browser + Supabase + existing
> external APIs. No Cloud Run, no Cloud Run Jobs, no Cloud Build application
> dependency, no Compute Engine, no GKE, no new Google-hosted application
> service. Google remains an API provider — principally Maps. Supabase is the
> authoritative backend, runtime and storage platform.

This file records what was **measured** before anything was changed, because
the measurement decided the plan. Read §1 before proposing any sequencing: the
number that matters is not how many report formats route through Cloud Run
(eleven) but how many client documents Cloud Run has actually produced.

---

## §1 — The finding that reshaped the cutover

**96% of every Investment PDF this product has ever delivered was produced in
the browser, not by Cloud Run.**

`investment_reports.pdf_url` carries the storage path of the delivered
document, and the two engines write different path shapes. That difference is
a fingerprint, and it settles the question by execution rather than by reading
the code's intentions:

| path shape | engine | rows |
| --- | --- | ---: |
| `<reportId>_<suburb>_<state>_<epoch>.pdf` (stored as a public URL in the older era) | `PixelPerfectPDFGenerator` — **browser, pdf-lib** | **263** |
| `generated/<YYYY-MM-DD>/<uuid>-<name>` | `render-investment-report-pdf` — **Cloud Run WeasyPrint** | **12** |
| | **total delivered** | **275** |

The browser generator is therefore not an untested alternative to be built and
proven. It is the path that has produced almost every document a client has
received, and it has been doing so continuously. What the cutover removes is
the newer, less-travelled leg.

### How much work Cloud Run has actually done

| signal | window | value |
| --- | --- | --- |
| metered WeasyPrint render calls | since metering began 2026-08-07 | **128**, all successful, last **2026-09-08** |
| `template_render_jobs` | since 2026-06-06 | 135 rows — 122 succeeded, 11 failed, 2 stuck `running` |
| the nine per-format flowing-route ledgers | all time | **42 rows in total** |
| `investment_report_renders` | all time | **0** — the route writes no row to it |
| `pdf_import_jobs` (Docling) | since 2026-06-12 | **86** — 53 succeeded, **33 failed (38.4%)**, last **2026-08-11** |

Two Cloud Run services, low hundreds of renders across the product's life, and
the PDF-import service idle for over a month at a 38% failure rate.

**Caveat, stated rather than glossed:** WeasyPrint metering began 2026-08-07,
so the 128 is not a lifetime total — `template_render_jobs` shows renders back
to June. The lifetime figure is bounded below by ~135 and is of that order, not
of the order of the 1,214 reports on file.

---

## §2 — Per-format render-path matrix

Every one of the eleven render routes is **hard-dependent** on WeasyPrint:
`weasyPrintConfig()` returning null is a hard error in all of them, and there
is no second server-side engine. (`render-investment-report-pdf` still mentions
an Api2PDF/headless-Chrome leg; it is disabled and throws rather than falling
back, deliberately, so a client never receives a stale-looking document.)

| format | Cloud Run route | live browser generator | library | already uploads to Storage |
| --- | --- | --- | --- | --- |
| Investment | `render-investment-report-pdf` + `render-template-pdf` | `reports/PixelPerfectPDFGenerator.tsx` | pdf-lib | **yes** — `secureStorageUpload` → `manage-investment-reports` → `pdf_url` |
| Portfolio | `render-portfolio-review-pdf` | `clients/PortfolioAnalysisPDFGenerator.tsx` | pdf-lib | yes |
| Market Intelligence | `render-market-intelligence-pdf` | `marketing/MarketIntelligencePDFGenerator.ts` | jsPDF | via its buttons |
| Borrowing Capacity | `render-borrowing-capacity-pdf` | `borrowing-capacity/BorrowingCapacityPDFReport.tsx` | jsPDF | via `publishReportToPortal` |
| Commercial & Industrial | `render-commercial-capacity-pdf` | `utils/commercial/commercialReportPdf.ts` | jsPDF | via its page |
| Property Comparison | `render-property-comparison-pdf` | `reports/ComparisonPDFGenerator.tsx` → PixelPerfect | pdf-lib | yes |
| Client Details | `render-client-details-pdf` | — (no dedicated generator) | — | — |
| 10 Year Cash Flow | `render-cash-flow-pdf` | inline in `CashFlowAnalysisModal.tsx` | jsPDF | **already wired as `legacyFallback`** |
| Cash Flow Comparison | `render-cash-flow-comparison-pdf` | — | — | — |
| Report Q&A | `render-report-qa-pdf` | `report-qa/{Conversation,Message}ReportEditor.tsx` | jsPDF | via its editors |
| Template Builder | `render-template-pdf` | `lib/reportTemplate/blocks/*` `drawXBlock` | jsPDF | via the route |

All five generators named in the mandate exist and are **mounted** — every one
has live UI call sites. None is dead code.

### The one place the browser path is genuinely thinner

`src/lib/reportTemplate/blocks/index.ts` already carries a complete dual
renderer — `*.html.ts` for WeasyPrint and `*.ts` `drawXBlock` for jsPDF — and
declares per block which engines support it. Measured:

* **62** registered block types
* **28** have a real jsPDF renderer
* **34** render `drawExtrasPlaceholder` — a literal placeholder

The 34 include **every chart type** (`chart-bar`, `chart-line`, `chart-pie`,
`chart-donut`, `chart-area`, `chart-scatter`, `chart-radar`,
`chart-stacked-bar`, `heatmap`, `sparkline`) plus `data-grid`, `pivot-table`,
`kpi-strip` and `auto-toc`.

This is the honest cost of the template leg and it is why §11 of the mandate —
*"if a browser renderer produces inferior output, fix the browser renderer
using existing design primitives"* — is load-bearing rather than a formality.
It is bounded by the fact that the design system renders **0.14%** of this
product's documents and **zero** investment reports, so no client document
depends on those 34 blocks today.

---

## §3 — What "change only the transport boundary" can and cannot mean

The mandate's §5 asks that only the final transport/render boundary change.
For an HTML-composing route that boundary is HTML → PDF, and the constraint
that decides the design is this:

**There is no production-grade browser HTML → PDF converter that both
preserves vector text and yields a `Blob` that can be stored.** The three
candidates fail for different reasons — `html2canvas` + jsPDF rasterises (the
inferior artefact this programme has already rejected once); the browser's own
print engine produces excellent output but cannot hand back bytes, which §6
requires; and no pure-JS vector HTML renderer exists at this quality.

So the resolution follows the mandate's **§4**, which is the more specific
instruction and names the files: the browser path consumes the same **data**,
through the same projections, calculations, branding and disclaimer logic, and
draws it with pdf-lib/jsPDF. Everything upstream of the draw is preserved
unchanged. What differs is the typesetting, and that is measured against §11's
checklist rather than assumed.

**This is not a new reporting engine.** It is the engine that already produced
263 of 275 delivered documents.

---

## §4 — Rules this consolidation answers to

* **Cost safety must never create false data.** A daily ceiling reached makes
  the provider unavailable, the measured field `null`, and the claim absent
  from the report. It never produces a substituted or estimated figure —
  `rentalEvidence`'s rule, applied at the producer.
* **One quota vocabulary.** The ceilings reconcile against the existing
  `GOOGLE_*_DAILY_LIMIT` counters and their existing units before anything is
  hard-coded. A second metering system is not built.
* **Generating a file locally is not sufficient.** Every production PDF path
  keeps download, Supabase Storage persistence, a stable PDF reference, Send to
  Client, portal access, email dispatch where supported, report history and
  access control — through the existing `secureStorageUpload` and delivery
  abstractions.
* **Nothing is deleted before cutover validation.** The order is: browser path
  live → parity passes → smoke passes → production dependency removed → deploy
  workflows deactivated → services decommissioned. No workflow is left able to
  recreate Cloud Run afterwards.
* **Asserted by effect, never by configuration.** A route is proven cut when a
  document is produced, stored, downloaded and sent without a `*.run.app` call
  — not when a setting says so.

---

## §5 — Maps cost control (RC-2)

`location-intelligence-service` was the one paid Google call site in the
product with **no ceiling of any kind** — no daily quota, no kill switch, no
circuit breaker — and it is the one that report generation drives. It makes
three kinds of call, all through `meteredFetch`, so the spend was measured and
unbounded at the same time.

### What the existing counter actually does

Read off the deployed `security_consume_rate_limit`, not inferred:

| property | measured behaviour |
| --- | --- |
| increment | `count = count + 1` — **one unit per call**, and every existing site calls it once per outbound Google request |
| allow test | `count <= p_max` — a ceiling of 250 admits the 250th and refuses the 251st |
| window | **fixed, not calendar**: `window_start` is stamped on first use and reset only once it is older than the window |
| key | `public:global:<scope>:daily`, regex-checked `^[a-z0-9:_./-]{1,200}$` — an invalid scope RAISES, which would turn a ceiling into a 500 |
| unavailable RPC | falls back to a per-isolate counter and flags `degraded` rather than denying |

### Unit vs bill — reconciled before anything was hard-coded

Geocoding, Places Nearby and Static Maps are billed **per request**, so one
unit is one billable event and the mandate's numbers apply directly. Two
places where the unit and the bill differ are recorded rather than papered
over:

* **Distance Matrix is billed per ELEMENT** (origins × destinations). It
  matches here only because the one call site sends a single origin and a
  single destination — 1 request = 1 element. A call site that ever sends more
  must consume that many units.
* **Street View metadata is free and its images are not**, and `street-view`
  consumes a unit for each. That counter over-counts relative to the bill,
  which is the safe direction, so it is left alone.

### The ceilings

`_shared/googleMapsDailyCaps.ts` names them once, reads the **existing**
environment variables and uses the **existing** primitive. No second metering
system, no new vocabulary.

| API | scope | env | default |
| --- | --- | --- | ---: |
| Geocoding | `google_geocoding` | `GOOGLE_GEOCODING_DAILY_LIMIT` | 250 |
| Places Nearby | `google_places` — **shared with `google-places-autocomplete`** | `GOOGLE_PLACES_DAILY_LIMIT` | 150 |
| Distance Matrix | `google_distance_matrix` | `GOOGLE_DISTANCE_MATRIX_DAILY_LIMIT` | 250 |

Places is deliberately the tightest because it is what actually limits report
throughput: one enrichment is 1 geocode + 6 Places + 1 Distance Matrix, so 150
admits ~25 enrichments a day against a corpus that created 32 reports in the
last thirty.

**Residual, stated:** `resolve-listing-coordinates` counts geocodes under its
own `google_listing_geocoding` scope, which is also its circuit-breaker scope.
Both sites read the same `GOOGLE_GEOCODING_DAILY_LIMIT`, so the product-wide
geocoding ceiling is up to **twice** the configured number. Merging them would
merge the circuit breakers too, which is a larger change than closing this gap;
an operator wanting a true N should configure N/2 until it is done.

### A ceiling produces absence, never a value

This is the half that makes the control safe to switch on, and it needed no new
machinery — the service already had the right absence semantics and a refusal
simply takes them:

| refused call | what it returns | what a reader gets |
| --- | --- | --- |
| Places category | `{ ok: false, count: 0 }` | `unavailableCategories` names it; `measuredCount` answers **null**, so the line is omitted rather than printed as `0` |
| Geocode | `{ ok: false, capped: true }` | `geocoder_daily_cap_reached` — a **new reason**, because `geocoder_unavailable` sends an operator to look at broken map access and a ceiling is not a fault |
| Distance Matrix | `COMMUTE_CAP_REACHED` | distinct from `no_route_returned`, which is a **measurement** a reader may act on. Nobody asked, so nothing is claimed. |

The refusal text carries **no digit at all** — a number in a refusal is a number
a report can print.
