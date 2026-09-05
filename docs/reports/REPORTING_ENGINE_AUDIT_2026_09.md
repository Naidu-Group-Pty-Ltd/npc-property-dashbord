# Reporting Engine audit — September 2026

A full end-to-end audit of the reporting engine, conducted stage by stage with the
product owner: architecture → data injection → generation pathways → template
selection and white-label → practical rendering. This file is the durable record
of what was measured and found. **No behavioural change ships with this
document** — every fix is listed for the consolidation programme, and anything
that hides or retires a legacy pathway explicitly awaits the owner's
authorisation.

Method: the docs in `docs/reports/` were read first and then re-verified against
the code and against the **live production database** (read-only). Rendering
claims were verified by rendering: the pinned engine (WeasyPrint 69.0) with the
container's own typefaces, the repo's measurement tooling, real production rows
through the real projections and templates, and a page-by-page review of the
result. Every load-bearing number below is a fresh measurement dated
2026-09-02, not a quotation of an earlier doc.

---

## 1 · Architecture census

Two layers, separate in code and time:

**Generation** (content): `generate-investment-report` writes model-authored
Markdown into `investment_reports.report_content` under a wall-clock budget with
three resume drivers (browser pump, bulk worker, 2-minute cron watchdog). Other
formats are deterministic calculators plus bounded model prose. Sub-reports
derive from a Compass parent: **fork** (`fork-investment-report` — deterministic
section split via `_shared/reportSplitRegistry.ts`, no model calls, idempotent,
inherits the parent's data wholesale) and **condense**
(`condense-investment-report` — model-condensed briefing/snapshot, regenerates
in place).

**Rendering** (documents): five engines exist in live code.

| # | Engine | Carries |
| --- | --- | --- |
| 1 | WeasyPrint via nine per-format design-system routes (`render-*-pdf`) | the migrated formats' standard documents |
| 2 | WeasyPrint via `render-template-pdf` (browser compiles HTML through `compileTemplateHtmlForPdf`) | chosen-template documents |
| 3 | WeasyPrint via `render-investment-report-pdf` — 5.7k-line monolith, own inline THEME, own private client, Api2PDF fallback | nearly all Investment volume |
| 4 | pdf-lib in Deno ×2 (`quantitative-report-pipeline`, legacy export inside `report-qa`) | quantitative reports; legacy Q&A export |
| 5 | ~17 live browser generators (jsPDF / html2canvas / pdf-lib) | the legacy side of most formats; record nothing |

Storage: `investment-reports` (two producers), `client-files` (six routes),
`marketing-reports`, `qa_exports`, `quantitative-reports`, `converted-templates`;
all report PDFs served by signed URL (TTLs vary: 7d legacy / 24h routes / 15-min
`secure-storage` ceiling). Ledgers: nine `*_renders` tables +
`template_render_jobs` + `template_events`.

Two unrelated systems share the word "template": `report_templates`
(presentation / white-label) and `report_structure_templates` (generation-time
structure guides). They never touch.

## 2 · Live measurements (2026-09-02)

- Coverage (per `COVERAGE.md`'s own query): investment **1,174 / 0** via design
  system; report_qa 255/2; portfolio 26/2; market_intelligence 7/0.
  **The coverage query cannot see the templated path** — it counts `*_renders`
  ledgers, while template renders land in `template_render_jobs` (127 rows, 114
  succeeded, successes for `investment_compass` and `commercial_capacity` on the
  audit date). `investment_report_renders` has **no writer anywhere in the
  codebase**, so that cell can never move.
- Templates: 10 active global WeasyPrint masters (one per format spelling,
  "Private Banking — Chancery") + 4 active user-scoped adoptions; 96 legacy
  jspdf rows deactivated. 4 stored selections, all valid.
- Downloads, last 45 days: `premium_weasyprint` 24 (legacy investment route),
  `cash_flow_server` 11, `cash_flow_template` 7, `report_viewer` 6 (browser),
  `pixel_perfect_generator` 1.
- `investment_reports`: 1,174 completed / 18 failed / 1 stale pending (the
  resume watchdog works). 17 new reports in 30 days.
- Sub-reports in production: snapshot 25, briefing 22, financial 10,
  strategic 10 — all four active on the audit date.

## 3 · Findings register

Class key: **D** data/content · **P** pathway/delivery · **T** template/white-label · **R** rendering.

| # | Class | Finding | Evidence / location |
| --- | --- | --- | --- |
| F1 | D | `financial_calculations` injection unreliable: 190/1,174 rows overall; 71% of Compass rows since June; no record of why any row lacks it | live DB; `generate-investment-report` phase 2 |
| F2 | D | Stored record contradicts itself: `keyMetrics.annualNet/weeklyNet` vs `projections.moderate[0].cashFlow` agree on **0 of 162** rows, median gap **$24,793**; legacy renderer prints the keyMetrics side, templates print the series | `cashFlowProjection.pure.ts` header; `render-investment-report-pdf` exec summary |
| F3 | D | Overrides go stale: saving `manual_overrides` does not recalculate; legacy renderer references the column **zero** times; only `{{overrides.*}}` carries corrections and no master binds it. 435 rows (37%) carry overrides | `ManualDataOverrideModal.tsx:1174`; grep of legacy renderer |
| F4 | D/T | Brand baked into content: generator writes `# BRAND / YOUR DEDICATED PROPERTY PARTNER / Investment Report: …` into `report_content`; `narrative.source` republishes it verbatim, so templated documents print a second, generation-time cover inside the body (verified on a real render — including the literal heading "Cover Page") | `generate-investment-report:5311`; `compassSectionRegistry.ts` cover section `includeInCompass: true` |
| F5 | D | Missing source data is silent: Phase-1 service failures only log to console; nothing on the row records completeness | `generate-investment-report:2541-2575` |
| F6 | P | The two investment pathways differ in **content**: legacy adds a self-authored executive summary, an "Editor's Note", and hero photography; the templated path has none of these | `render-investment-report-pdf:3025-3055`, hero reads at `:2702-2730` |
| F7 | R | Charts drawn by two implementations (legacy's 11 private SVG renderers vs shared `vizFigures`) | both files |
| F8 | D | Reports unlinked from clients: `client_property_id` on 2/1,174; no client name on the row | live DB |
| F9 | P | Two engines answer to "Financial": `TierSwitcher` generates it via condense (model) while `ReportVariantControls` forks it (deterministic); both address the same child row and regenerate in place | `TierSwitcher.tsx:99`; `ReportVariantControls.tsx:30`; `condense-investment-report:404` |
| F10 | P | Sub-reports go stale silently: children refresh only on click; nothing compares child freshness to the parent's `updated_at` | `fork-investment-report`, `condense-investment-report` |
| F11 | P | The report page's primary "Download" produces a **.txt dump**; the PDF exits live lower in the export panel | `InvestmentReportView.tsx:136-151` |
| F12 | P/T | **Send to Client / client portal never receive the templated document**: they ship stored `pdf_url` (written by legacy route *or* browser generator, whichever last) or a fresh browser PDF | `SendToClientModal.tsx:159-199`; `InvestmentReportView.tsx:282`; `PortalReports.tsx:82-114` |
| F13 | T | The template invariant is process-enforced only: binding expressions permit arithmetic (`{{=financials.x * 1.1}}` passes `SAFE_EXPR_RE`), so nothing mechanical stops an approved template computing a figure | `bindingResolver.ts:193` |
| F14 | T | `client_branding_profiles` (the Templates → Branding tab) is a decoy: nothing in the reporting engine reads it | `BrandingManager.tsx`; grep of `applyOrganisationAndBrand` chain |
| F15 | T | `whitelabel_settings.company_name` stored with trailing space (no visual effect — the projection trims; data hygiene only) | live DB |
| F16 | P | Market Intelligence scheduled email has nothing to attach: `pdf_storage_path` is 0/7 (only the unused server persist path writes it); the labelled "Generate Report" button is the browser jsPDF path, which persists nothing | live DB; `MarketIntelligencePDFGenerator.ts` |
| F17 | D | Model prose contradicts structured facts: a real report states "3 bedrooms" (×3, including the closing summary) for a 4-bedroom subject; nothing reconciles prose against `property_specs` on any pathway | real render, pages 27/28/32 |
| F18 | R | Truncation leaves skeletons: `truncateNarrativeToCap` keeps headings while deleting their prose and appends a literal "…" — nine content-less headings and eight severed sentences on one real document | `compassPostProcessor.ts:190-210` |
| F19 | R | Markdown paging under-fills by ~2×: fixed `DEFAULT_LINES_PER_PAGE = 34` undershoots the rendered frame; 26 consecutive pages at 30–60% full; lead-in lines stranded above white | `reports/markdownPaging.pure.ts:16` |
| F20 | R | Loose ordered lists render as separate `<ol>`s — a 15-item checklist numbered "1., 1., 1., …" | `reports/markdown.pure.ts:985-1012`, `listHtml` ~`:1245` |
| F21 | R | A table row can be clipped with its continuation drawn above the running head and lost — observed mid-word on a real risk register | real render, pages 29→30 |
| F22 | D | The money page doesn't foot: upfront total $500 short of its own column; net position $2,176 off the visible rows (stored totals vs stored lines) | real render, page 6; `financial-calculator-service` outputs |
| F23 | R | The company/back page renders in a different palette and typeface from the template family around it | real render, page 36 |
| F24 | R | Footnote syntax (`[^abs]`) prints as body copy — no footnote handling in the Markdown renderer | `reports/markdown.pure.ts` |
| F25 | R | Part numbering counts pages, not sections: running heads reach "Part 49" on an 11-section document; two pages share "07" | `reports/investment/render.pure.ts:380` |

Minor (unnumbered): display heading overrun on one risk page; duplicated
headings 16 pages apart; pseudo-tables flattened to bullets; raw scoring-band
strings ("Good walkability (50-69)") and enum values reaching client prose;
mixed minus glyphs; "andother" missing space; contents labels disagreeing with
page headings.

## 4 · What verified sound

- **The template invariant holds on real data**: one live Compass row rendered
  through two families produced 81 currency/percent figures each, identical
  except each family's KPI strip curating a different *published* figure.
  Switching templates changes presentation only.
- **The selection chain**: 159 repo tests pass (route enforcement, resolver
  parity ×3, selection rules, seeded master through the real render boundary,
  font policy, brand-mark rules, adoption idempotency). Selections are re-read
  and re-validated server-side; stale choices fall back with a notice.
- **White-label sources are live and correctly keyed**: `report`/`reportMono`
  logo slots uploaded and matching the resolver's spelling; ABN, address,
  phone, disclaimer present in `global_report_settings`.
- **Typed design-system pages are professional**: fixture harness renders all
  formats with zero high-severity findings; real cash-flow tables are
  immaculate (banded, aligned, unwrapped numerals, semantic negatives).
- **The sub-report mechanism**: fork inheritance, idempotency, and one
  selection driving the whole family (compass + tiers fold to one key, active
  masters exist under both raw spellings).
- **Pipeline health**: watchdog keeps `investment_reports` at 1 stale row;
  production template renders succeeded on the audit date.

## 5 · Pathway / duplication register

**Same report, competing engines (user-visible):** investment's six exits
(.txt, template route, legacy server route, browser pdf-lib, Send-to-Client,
listings-modal jsPDF); Q&A's two exporters; Comparison's model-rewrite-per-
download beside the deterministic route; Market Intelligence's labelled jsPDF
button vs typeset popover; Cash Flow's four PDF exits; Client Details' Formara
twin; `FlattenPdfIconButton` on 18 surfaces. Commercial Capacity is the
consolidated model: one road.

**Same logic, multiple copies:** cash-flow cascade ×3 (the F2 divergence);
template resolver ×3; report-type normaliser ×2; chart primitives ×2;
browser/server calculator mirrors (`lenderLvrCaps.ts` and
`capitalAllocationLedger.ts` measurably drifted); orphaned
`buildTemplateBindingContext.ts` (three documented defects, zero callers);
drifted `compassSectionRegistry` mirror (672 vs 174 lines).

**Same name, different product:** "Financial" (F9); two unrelated "10 Year
Cash Flow" reports (investment modal vs commercial calculator print view).

**Dead but shipped:** `EnhancedInvestmentReportModal`, `QAPDFGenerator`,
`HybridPDFTemplate`, `StrictPDFTemplate`, `ClientPDFTemplate`,
`reportTemplate/pdfRenderer.ts`.

## 6 · Consolidation programme (draft — sequencing for owner sign-off)

Priorities agreed during the audit: accuracy · consistency · reliability ·
template compatibility · rendering quality · user experience. Legacy pathways
stay reachable throughout; **hiding them is a later, separately authorised
step**.

**A — Narrative channel (fixes most of what a client sees; small, local):**
exclude the Cover Page section from Compass assembly (the contents section
precedent is recorded in the registry's own header); truncation drops a heading
with its prose and never emits "…"; calibrate/measure markdown paging against
the rendered frame + keep-with-next for lead-ins; merge loose ordered lists and
carry `start`; strip or render footnote syntax; number parts by section, not
page; keep table rows whole across breaks; theme the company page from the
template family.

**B — Data-layer reconciliation (accuracy):** reconcile model prose against
`property_specs` at the enrichment boundary and fail loudly (F17); make
`financial_calculations` internally consistent or publish one side only (F2,
F22); record per-source fetch outcomes on the row (F5); regenerate-on-override
or stamp staleness (F3); investigate and alarm on missing fincalc (F1).

**C — Delivery unification (reach):** route Send-to-Client / portal / scheduled
sends through the same template-first delivery the downloads use (F12, F16);
make the report page's primary Download produce the document, not a .txt
(F11); single writer for `pdf_url`.

**D — Sub-report cascade:** one engine per variant name (fork for
financial/strategic, condense for briefing/snapshot — remove `financial` from
condense's accepted tiers or repoint `TierSwitcher`) (F9); staleness marker
against the parent (F10); regenerate children on parent regeneration or offer
one-click "refresh family".

**E — Invariant hardening:** refuse arithmetic over financial namespaces in the
production template guard (F13); retire or wire `client_branding_profiles`
(F14); write a `report_render_events` row from legacy paths and include
`template_render_jobs` in the coverage measure so the number tells the truth.

**F — Later, upon authorisation:** hide (not delete) the legacy generators
behind the unified delivery; retire dead components; fold the duplicated logic
copies onto their canonical modules.

## 7 · Reproduction

- Fixture harness: `npx tsx scripts/reports/renderAll.mts` (WeasyPrint 69 +
  `weasyprint-service/fonts/` installed locally; poppler-utils for
  `pdftoppm`/`pdftotext`).
- Real-row template render: build the projection data exactly as
  `scripts/template-library/productionFit.ts` does (`investmentData`), render
  with `renderTemplateToHtml(schema, { data, fontSource: 'container' })`, and
  measure with `scripts/reports/measure_pages.py`.
- Live counts: the SQL in `COVERAGE.md`, plus `template_render_jobs`,
  `report_template_selections`, `report_templates` grouped by
  engine/scope/active.

## 8 · Phase 0 + Phase 1A — implemented (2026-09-02)

The first two phases of §6's programme shipped together, and every number
below was re-measured on the same two production rows §5 measured, so the
before and after are the same instrument.

### Phase 0 — the measure

`public.report_render_coverage` (migration `20260915100000`) unions the nine
`*_renders` ledgers, `template_render_jobs`, and engine-tagged
`activity_logs` events into one engine × format × week matrix. The write side
is two pieces: `src/lib/secureInvoke.ts` auto-tags every successful
`render-*-pdf` / `render-template-pdf` invocation (the meteredFetch pattern —
coverage a new call site cannot forget), and `src/lib/reports/renderEvent.ts`
is the explicit helper for the ledgerless pathways, wired into the stored-PDF
chokepoint (`clientPdfDownload`), Formara, the Market Intelligence jsPDF
buttons and the portfolio pdf-lib generator. Remaining minor surfaces (print
views, flatten buttons, the QA editors, the commercial/industrial utils, the
listings modal) are listed for the same one-line treatment in the follow-up.

### Phase 1A — the narrative channel, calibrated and cleaned

`scripts/reports/markdownCalibration.mts` is the new measuring instrument: it
rendered probes through the real seeded Chancery master twice — pager in
charge, then bucket cap lifted — and found the pager sending every narrative
page at **40–47% of its measured capacity** (~54.5 rendered line-units per
continuation page, ~42.5 on the first; prose wraps at ~98 chars, the charge
model said 65). That under-fill was every "large sectional gap".

What changed (all charge-model changes are opt-in per format via
`resolveNarrativeProfile`; every uncalibrated caller is byte-identical):

- **Measured charges + calibrated budgets** for the investment narrative
  (`markdownPaging.pure.ts`, `markdown.pure.ts:charging`), resolved
  identically by the markdown block and the projection so the conditional
  page count and the drawn buckets cannot disagree. The deployed schemas'
  baked `linesPerPage: 34` is read as the legacy sentinel.
- **Keep-with-next**: a page never ends on a heading or a lead-in line
  ending in a colon.
- **Tables split by rows with the head repeated** when taller than a page
  (`splitTableBlock`), charged by real cell wrap — the clipped risk-register
  row (F21) is structurally impossible now.
- **Loose lists merge** (fifteen "1." items are one list again) and ordered
  runs keep their opening number (F20).
- **Footnotes render**: `[^id]` becomes a superscript with a Notes list;
  a citation-shaped ref with no definition strips instead of printing (F24).
  `sup.fn-ref`/`ol.fn-notes` joined the print stylesheet's vocabulary.
- **Skeleton headings drop** (`dropEmptyHeadings`, default on) and the
  word-cap truncation now cuts cleanly: no heading survives its deleted
  prose, no literal "…", while figures and tables still always survive
  (F18, and the standing figures-and-tables rule).
- **The baked cover is gone twice over**: `compass.cover` is excluded from
  generation (the contents-section precedent), and
  `reports/investment/narrativeClean.pure.ts` strips the masthead and
  "Cover Page" section out of the 1,100+ stored narratives at read time, on
  both sides of the contract (F4).
- **Scorecard band jargon is cleaned at the projection** — "Good walkability
  (50-69)" publishes as "Good walkability" (the F-series readability item).

Measured on the same rows as §5: 48 Budgeree via the user's selected
Dictionary master went **36pp → 22pp, median body ink 0.055 → 0.111**, with
every narrative page inside the native 0.10–0.13 band, zero cover/masthead
artefacts, zero footnote syntax; the 6 Acer Court financial fork via Chancery
went **21pp → 15pp, median 0.097**, risk register split with repeated heads
and no severed row. The remaining sparse pages are the typed fixed-geometry
pages (contents, dashboard, property, sources) — Phase 1B's schema-side
economy work, alongside the part-numbering and back-page theming that also
live in the seeded schemas.

### Phase 1B — the schema-side pass (2026-09-02, same day)

- **One part number for the whole report body.** Every narrative continuation
  page minted its own — running heads marched "Part 08 · Report" through
  "Part 33", and Sources introduced itself as Part 49 with a two-inch numeral.
  The opener mints the label once and every continuation (and the cut page)
  carries it verbatim; a Compass now runs Part 01–09. The labels are baked
  into schema furniture, so the fix ships as the v9 catalogue seed
  (`20260916100000`) plus a reactivation migration (`20260916110000`) that
  refreshes every active row from its published entry — the same mechanism,
  guards and colourway-exclusion as `20260816150000`, with a probe that no
  active investment schema still carries "Part 15 · Report".
- **The closing page dresses in the family's tokens.** `disclaimer.html.ts`
  hardcoded a foreign ground (#141414), one of the audit's eight stray golds
  (#BF9B50) and a Helvetica fallback — the critic's "back cover from a
  different design system". It now reads the colourway (`bg`,
  `accentOnField`, `text`, `mutedOnField`, the heading face), with the old
  literals as fallbacks so token-less templates render unchanged. The
  split wordmark (every word large, the last small beneath — "SERVICES" as a
  subtitle) is one name at one size in the family's heading face.
- **Deliberately not done here, and why:** the typed front-matter pages
  (contents, dashboard) measure sparse and are left so — front matter in a
  premium document is airy by intent, and densifying it is a family-design
  decision for the Claude Design catalogue, not a defect fix. The data-sparse
  typed pages on financially-empty rows are queued with Phase 2's
  completeness work, where the row-level `when:` guards already carry most of
  it.

## 9 · Phase 2 — accuracy gates (2026-09-02)

Phase 2 set out to make the Investment report's figures one truth end to end.
Reconnaissance for it found something larger than the divergence the audit
had measured: **every stored 10-year projection series was charging the
property's operating costs roughly three times over.**

### F26 — the projection fold triple-charged operating costs

`generateProjections` (financial-calculator-service) folded
`Object.values(annualCosts)` into its cost base, and that object carries its
own totals (`totalAnnual`, `totalAnnualExcludingLandTax`) and a percentage
beside the line items — so the opex base was
`2·totalAnnual + totalAnnualExcludingLandTax + percent`. Proven to the
dollar on the captured production row ($1.19M NSW house, rent $739/wk):

|                                   | stored | honest |
|-----------------------------------|--------|--------|
| Year-1 operating costs charged    | **$59,931** | $22,232 (totalAnnual × 1.038 CPI) |
| Year-1 cash flow (moderate)       | **−$92,557** | −$54,858 |
| Year-1 ROI                        | **−18.89%** | −3.05% |
| 10-year cumulative position       | overstated by ~**$370k** | — |

The buggy base reconstructs exactly: 2×21,418 + 14,893 + 7 = $57,736, and
×1.038 (that day's cached year-1 CPI) = $59,930 ≈ the stored charge. The
headline `keyMetrics` used a third base (un-escalated, land tax out), so one
page contradicted itself by $43,885/yr — and the generator's prompt injected
the poisoned series verbatim as the cash-flow table the model transcribes,
directly under a stated formula ("rent − operating costs − repayments")
whose quoted operating costs were the sane ones. The sensitivity analysis
carried the same fold twice more. Nobody could reconcile these numbers
because they were not reconcilable.

### F27 — adjacent accuracy defects, same commit series

- `totalUpfront` = deposit + duty + hardcoded $2,000 — ignoring the row's
  own `legalFees`/`inspectionFees` lines (historic rows off by $500+); the
  cash-on-cash denominator was a second hardcoded derivation.
- The prompt forced **accounting-negative notation onto positive cash
  flows** (`($X)` via `Math.abs`), taught that P&I repayments decline ~5% by
  year 10 (they are constant; the split changes), bound `p.lvr` — a field
  the series never had — printing the literal "XX%", and asserted "all
  scenarios produce negative cumulative cashflow" unconditionally.
- Manual overrides reached `financial_calculations` by three writers, all
  splatting values over computed leaves: the captured row carries overridden
  line items summing $13,578 beside `totalAnnual` $21,418, with projections
  and metrics describing neither (C5's defect, proven on the same row).

### What shipped

- **C1 — one engine, one cost base**
  (`_shared/reports/investment/financialEngine.pure.ts`). All calculator
  arithmetic extracted pure and pinned by `financialEngine.spec.ts` against
  the captured row; the service keeps orchestration only. Projections,
  sensitivity and headline cash flow share `operatingExpensesFrom` (the
  footed total, never a fold); the year-0→year-1 gap is exactly the declared
  escalation. The one deliberate asymmetry: net rental **yield** keeps the
  land-tax-excluded base (land tax follows the owner's aggregated holdings,
  not the property) and the report states the exclusion. Cash-on-cash
  divides by the same `totalUpfront` the report prints. The prompt's
  narrative figures are now derived FROM the series (`impliedOpexFromSeries`,
  `fmtCashFlow`, `seriesLvrPercent`, `cumulativeCashFlow`), so prose and
  table cannot disagree; the sign convention keeps the sign, and the
  cumulative-cashflow teaching is conditional on the data.
- **C2 — historic rows healed at every read boundary**
  (`reconcileStoredFinancials`). ~1,170 stored rows carry the fold; nothing
  rewrites them until regeneration, so readers heal them exactly: the fold
  base reconstructs from the row's own aggregates (original even where line
  items were overridden — nothing ever rewrote the aggregates), each year's
  CPI factor recovers as impliedOpex ÷ base, and cash flow, cumulative and
  ROI follow. Detection cannot misfire (buggy year-1 charge ≥ 2× totalAnnual;
  healthy ≤ ~1.1×). Totals are derived from the row's own lines; headline
  metrics recompute from components. Wired at the template binding
  projection, the legacy `render-investment-report-pdf` route (its 10-year
  and cash-flow charts drew the inflated series on every historic re-render),
  and the design-composer normaliser. Idempotent, never mutates the stored
  row, no-op on post-fix rows. Historic **prose** is beyond render-time
  repair — regeneration is the remedy, and regeneration now writes correct
  figures.
- **C5 — overrides go INTO the engine, on every writer**
  (`overrides.pure.ts`). An override that changes a modelled input (price,
  rent, rate, reviewed costs, duty, conveyancing) becomes calculator INPUT —
  `calculateAnnualCosts` takes the reviewed figures, an explicit $0 replaces
  the estimate, letting fees join the totals, and the totals foot against
  the final lines whoever supplied them. Only non-modelled fields (tax
  treatment, occupancy display, build splits, loan labels) merge afterwards,
  through one shared `applyDisplayOverrides`. `manage-investment-reports`
  recomputes server-side before the write (never blocking the save; the
  response and the modal's toast say which happened), and the generator's
  30-line splat loop is gone.
- **C3 — fact reconciliation** (`factReconciliation.pure.ts`). The prose is
  compared with the record at completion — bedrooms, bathrooms, car spaces,
  purchase price, weekly rent, land size. Report-level rule (recorded value
  never appears + a different value repeats) so comparative prose cannot
  trip it; money facts are context-anchored. Findings disclose as
  `validation_flags` `type:'fact'` entries in lay wording and never gate
  completion. Feeding findings into regeneration retries is deliberately
  deferred until the detector has production mileage.
- **C4 — completeness recorded and disclosed, no schema change.**
  `data_sources` now records all eleven attempted sources (was four) —
  present with provenance, or null as a recorded fact. The viewer's new
  `InvestmentReportCoverageNote` renders ONLY when a source is missing or a
  fact check flagged ("9 of 11 sources", the gaps named, each contradiction
  in a sentence); a complete, clean report shows nothing, because a badge
  must mean something is unmet. Carried on the detail projection of
  `get-investment-reports`.

### Verification

63 new spec assertions across `financialEngine.spec.ts`,
`investmentOverrides.spec.ts`, `factReconciliation.spec.ts` — the engine
pinned against the captured production row (its reconstruction reproduces
the stored totals and monthly payment exactly, and the heal reproduces the
stored corruption before repairing it). Full affected surface green: 2,330
tests, tsc, eslint, `audit:style` under baseline, production build.

### Deferred, with reasons

- Regeneration-retry wiring for fact findings (detector mileage first).
- Browser viewer chart components reading `financial_calculations` directly
  (the two live PDF routes and the composer are healed; the viewer's own
  charts join in the delivery-unification phase).
- Historic prose corrections (regeneration is the remedy; C1 makes every
  regeneration correct).

## 10 · Phase 3 — delivery unification (2026-09-02)

Programme item C: every pathway that puts an Investment document in front of
a person produces THE document — template-first, one implementation — and
the scheduled Market Intelligence email can finally attach one.

### What shipped

- **`deliverInvestmentPdf.ts` — investment's own `deliver*` module.** The
  correct chain (the person's chosen template → the legacy WeasyPrint
  route) existed once, inside `PremiumPdfButton`. It is the module now, in
  the same shape every other migrated format has, and every surface asks
  it. `templateRouteEnforcement`'s investment pins moved onto the module,
  which makes them stronger: they now guard the path every surface uses
  rather than one button.
- **F11 — the primary Download produces the document.** The page's main
  action (header, mobile bar) had saved the markdown as a `.txt` for the
  life of the page while the real PDF sat lower in a collapsible panel. It
  now delivers template-first with a busy state, and says "Download PDF".
  The raw-text export survives everywhere its label already said "raw
  text": the panel button, the header menu item, the document card.
- **F12 — Send to Client publishes what the operator reviewed.** The send
  produced nothing before: it shipped whatever `pdf_url` held (legacy
  route or browser raster, whichever wrote last) or minted a fresh raster.
  It now produces fresh through the same chain, uploads template renders,
  reuses the path the legacy route just persisted rather than re-uploading
  the same bytes, and falls back to the raster only when both engines fail
  — reachability kept, primacy corrected. The portal needed no change: it
  serves the snapshot it was sent, and the snapshot is now the document.
- **`pdf_url` has one meaning**: the storage path of the most recent
  standard-delivery document, recorded through the one
  `manage-investment-reports` broker (the module and the browser
  generator's bookkeeping both go through it; the legacy route's internal
  write is the same delivery's server half).
- **F16 — the scheduled Market Intelligence email renders its own
  attachment.** The dispatcher's generate step writes content, never a
  PDF, so every dispatch that had to generate failed before sending
  (`pdf_storage_path` 0/7 in production). It now reuses a recent report
  even when that report carries no PDF yet, renders through the same
  design-composer route the download button uses (`persist` on), and
  attaches the path handed back. The route still refuses anonymous
  service_role exactly as pinned; the dispatch acts FOR the schedule's
  creator, whose `marketing_analytics` permission the route checks under a
  delegated authMethod that cannot hit the permission short-circuit.

### Verification

18 behavioural assertions on the delivery module (chain order, option
forwarding, publish reuse-vs-upload, bookkeeping-never-fails-a-document)
plus the `investmentDeliveryUnified` source pins (F11/F12/F16 wiring by
name). Full affected surface green: 6,243 tests, `tsc`, eslint,
`audit:style` under baseline, production build; MI's `legacyPathStays`
route pins all hold; security inventory regenerated with the new
dispatcher→render edge.

### Deliberately not done here

- The orphaned investment design-composer (`buildInvestmentReport` /
  `render.pure.ts`) stays orphaned: it is the legacy monolith's eventual
  replacement and belongs to the separately-authorised legacy phase (F),
  not to delivery unification.
- `ClientPDFGenerator`'s client-side override splat (a fourth copy) is
  harmless now that stored financials are override-coherent (Phase 2 C5)
  and folds with the duplicate-copy work.

## 11 · Phase 4 — sub-report cascade (2026-09-02)

Programme item D: the Compass family behaves as one family — one engine per
variant name, one linkage, and staleness that shows itself.

### What the phase found live (beyond the register)

- **F9 was structural, not just a mis-routed button.** The two engines used
  DIFFERENT linkage columns (fork → `derived_from_report_id`, condense →
  `parent_report_id`) with different idempotency keys, so neither could see
  the other's child: one Compass could hold two contradictory "Financial"
  documents, one deterministic and one model-written.
- **F28 — the tier switcher read `investment_reports` from the browser.**
  The table's policies are service-role-only, so the sibling lookup always
  answered `[]` with HTTP 200: switching to an existing child was
  impossible and every click regenerated one (model spend included). The
  fourth surface to hit the read-through-the-server trap.
- **A regenerated condense child kept its first-creation data copies.**
  Regeneration rewrote the prose and left `financial_calculations`,
  demographics, specs et al. as copied on day one — fresh words over stale
  figures.
- **Every fork was scored against $0.** The fork's score inputs read
  `financial_calculations.purchasePrice` / `.weeklyRent` — paths the record
  never had (the figures live at `initialCosts.propertyValue` and
  `income.weeklyRent`).

### What shipped

- **`subReportFamily.pure.ts`** — one mapping (`engineForVariant`:
  financial/strategic → fork, briefing/snapshot → condense), family
  resolution across BOTH historical linkage columns, and derived staleness
  (`variant_generated_at` vs the parent's `updated_at`; missing stamps never
  cry wolf). Bridged to src; both switchers route through the shared
  `generateSubReport`, and `condense-investment-report` refuses
  `financial` at the server, naming the right engine.
- **`familyOf` on `get-investment-reports`** — the family read, server-side,
  under the reports module gate: two indexed lookups (never a composed
  `.or()` string), per-child staleness in the answer. `TierSwitcher` uses it
  (its direct browser query is gone), lists all five variants including
  Strategic, and shows "parent has changed since" on stale rows.
- **Staleness stamps and honest refreshes.** Condense stamps
  `variant_generated_at` on completion and refreshes the structured copies
  from the parent on regeneration; both engines write both linkage columns
  on new rows.
- **`InvestmentReportFamilyNotice`** on the report page: renders nothing
  when the family is clean; on a stale child, one "Refresh from latest
  data"; on a parent, which sub-reports lag and one click that refreshes
  exactly the children that already exist — a refresh never mints documents
  nobody asked for. Fork refreshes are free (deterministic); condense
  refreshes cost a generation and the button counts what it touches.
- **Fork scores read the record** (override → initialCosts/income), not
  absent top-level paths.

### Verification

31 assertions across the pure-module spec (engine mapping, dual-column
family resolution from any anchor, the staleness truth table, orphan and
incomplete-child handling) and the source pins (server refusal, no inline
engine choice on any surface, no browser table read, stamps and structured
refresh present, page wiring). Full affected surface green: 2,356 report
tests, `tsc`, eslint, `audit:style` under baseline, production build, edge
column gate; security inventory unchanged (no new call edges).

### Deliberately not done here

- Auto-regenerating children when a parent regenerates: a condense refresh
  spends a model generation, so the family refresh stays an explicit,
  counted click on the page rather than a silent side effect of every
  parent save.
- Backfilling the two linkage columns into one: readers resolve the union
  either way; a data migration is pure tidiness and can ride with any later
  schema work.

## 12 · Phase 5 — invariant hardening (2026-09-02)

Programme item E: the rules the engine lived by become rules the machine
enforces.

### F13 — the template invariant is mechanical now

A template FORMATS data; it never COMPUTES it. `{{= financials.x * 1.1 }}`
used to pass the expression evaluator's character whitelist, so an approved
template could print a figure no engine produced. One implementation
(`templateLibraryCore.pure.ts`), two layers:

- **`expressionComputesOverData`** refuses arithmetic over ANY data
  reference — not only the financial namespaces, because a computed figure
  under `property.*` fabricates as readily as one under `financials.*`.
  Selection stays legal (ternaries, comparisons, `&&` presence logic choose
  between engine-supplied values); pure-literal arithmetic touches no data.
  Deliberately strict: `financials.x > -1` is refused (write `>= 0`) — a
  stricter refusal beats a parser.
- **The publish gate** (`validateForPublish`, code
  `library_template_computes`) refuses a computing schema with the
  offending expressions named, so no library entry can ship one.
- **The binding resolver** refuses at evaluation — the always-on stop for
  schemas that never meet the gate (activated copies, user drafts,
  imports). A computing expression resolves to nothing, like every refused
  expression; never to an invented figure.

Measured first, pinned after: zero of the 543 seeded templates use
expression arithmetic at all — `templateComputePolicy.spec.ts` asserts it
per template across all twelve collections, so the measured fact stays a
fact. 24 assertions on the rule, the walker, the gate and the runtime stop.

### F14 — the Branding decoy is retired

Templates → Branding collected per-client logos and colours into
`client_branding_profiles`, and no document generator ever read a row —
an operator configuring it was being promised branding the reports never
applied. The tab and `BrandingManager.tsx` are deleted rather than left
dormant (the platform's own rule: a dormant component is one import away
from returning). Untouched: the table, its rows, the `manage-templates`
allow-list, and the `ai-dashboard-agent` listing tool that reads the table
as data. The real brand source remains `whitelabel_settings` through the
brand resolvers; per-client REPORT branding, if ever wanted, is a
design-system feature on that chain and goes through Claude Design.

### E's third bullet — verified already delivered

"Write render events from legacy paths; include `template_render_jobs` in
the coverage measure" shipped in Phase 0: the `report_render_coverage`
view unions the nine `*_renders` ledgers, `template_render_jobs`, and
engine-tagged activity events, and the legacy investment route is
auto-tagged `legacy_server` by `secureInvoke`. Nothing further owed.

### Deliberately not folded

`compassSectionRegistry` / `compassPostProcessor` keep their src/edge
mirror pairs: the duplication is deliberate (edge functions cannot import
`src/`), drift-guarded by `compassRegistryParity.spec.ts`, and the src
copies carry src-only content below the shared block — a fold is churn,
not hardening. `ClientPDFGenerator`'s client-side override merge likewise
stays: it is the browser generator's compatibility shim for historic rows
whose stored financials predate the Phase 2 recalculation.

### Verification

6,709 template-suite tests green (the golden-render byte-stability guard
included — the refusal branch changes no rendered byte of a
non-computing template), `tsc`, eslint (0 errors), `audit:style` under
baseline, production build, edge column gate; security inventory
unchanged.

## 13 · Phase F — legacy incorporation and hiding (2026-09-02, upon authorisation)

The owner's standing instruction was that the legacy system be "incorporated
and hidden at a later stage once authorization is provided"; the
authorisation arrived after Phase 5 merged, and this phase is that step. The
model for what "incorporated and hidden" means was already in the tree: the
Borrowing Capacity Snapshot's one control offering the server render as the
primary act and the in-browser generator as an explicitly named
"legacy layout" choice — a decision its own spec records was taken so the
generator's retirement from reachability would never happen by accident.
Phase F generalises that arrangement to every format that still had
competing exits, deletes what nothing could reach, and folds the duplicate
logic copies the earlier phases had deferred here.

### Dead code deleted, not left dormant

Seven files with zero reachable callers went: `EnhancedInvestmentReportModal`,
`QAPDFGenerator` (whose unreachability the Q&A contract had recorded for two
migrations — the spec now pins the *deletion* so nobody restores it from
history), `HybridPDFTemplate`, `StrictPDFTemplate`, `ClientPDFTemplate`,
`reportTemplate/pdfRenderer.ts`, and the orphaned
`_shared/buildTemplateBindingContext.ts` (three documented defects, zero
callers). The style ratchet was re-measured downward in the same edit —
hexLiterals 636→611, fontHardcoded 53→51 — because the deleted print
components carried much of the recorded backlog. The orphaned investment
design-composer (`buildInvestmentReport`) turned out NOT to be dead — its
modules feed `reportBindingProjection` and `compassSectionRegistry`, i.e.
the template path itself — so it stays, and the §10 note that called it
orphaned is superseded by that measurement.

### The folds

**The read-boundary heal now covers the browser.** `get-investment-reports`
reconciles `financial_calculations` through `reconcileStoredFinancials`
before any row leaves the service — the same heal the two PDF routes and
the binding projection have applied since Phase 2 — so browser charts, the
library summaries and the legacy browser generator read one set of figures.
This closes the Phase 2 deferral ("the viewer's own charts join in the
delivery-unification phase") at a single server-side point instead of
per-component.

**The fourth override-splat copy is folded and named.**
`ClientPDFGenerator`'s hand-written flat-key→path merge is now
`overlayOverridesForHistoricRow` in `overrides.pure.ts` — the modelled
overlay a pre-recompute-era row needs, then the ordinary display paths —
documented as a display compromise for historic rows, never a recompute,
and a no-op on current rows. `applyDisplayOverrides` shares the same splat
mechanics (`splatByPaths`), so the path-walking exists once. The modal's
`OVERRIDE_FIELD_PATHS` deliberately stays: it is the override editor's own
field metadata (broader vocabulary, read-back concern), not a competing
money path.

**The browser/server mirror pairs were measured and left.**
`lenderLvrCaps`, `capitalAllocationLedger` and `scenarioDeltaEngine` are
deliberate structural twins with parity tests
(`scenario_parity_test.ts`, `lender_shading_parity_test.ts`, in place since
2026-08-30): the lenderLvrCaps constants are byte-identical, the ledger's
numeric content identical modulo comment counting, and the size difference
is inlined types on the Deno side. The §5 "measurably drifted" note is
superseded by that measurement; folding them would repeat the
`compassSectionRegistry` churn §12 already declined.

### One road per format, with the legacy named behind it

- **Investment** — all six exits now converge. The listings modal's
  "Download PDF" delivers through `deliverInvestmentPdf` (template-first,
  legacy server route behind it); its raw-text jsPDF dump survives only for
  an unsaved generation, where no row exists to deliver. The three
  `ClientPDFGenerator` mounts (export panel, Generated Reports viewer, the
  client tab's download sheet) sit after the unified control as
  "Download (legacy layout)" — the browser pdf-lib generator keeps its ref
  because the send fallback still reaches it. The client tab's sheet gains
  the unified download it never had.
- **Market Intelligence** — generating no longer draws and auto-saves the
  legacy jsPDF (the browser engine was the default road nobody picked). The
  typeset control leads the success strip and the History modal rows; the
  legacy layout is drawn only when chosen, and the choice is labelled. The
  spec's "never a silent substitute" reasoning survives: nothing falls back
  across engines.
- **Client Details** — the typeset control is the toolbar's one primary
  document control; the two Formara raster buttons moved to the end of the
  toolbar, demoted and named ("Send to Finance (legacy layout)",
  "Download (legacy layout)"). They stay because the raster document
  carries capabilities the typeset one does not (owner-occupied toggle,
  borrowing-capacity appendix) and a broker's workflow may depend on the
  exact document.
- **Property Comparison** — `ComparisonPDFGenerator` used to spend a
  metered model call (`format-comparison-report`) on every viewer MOUNT,
  download or not. It now formats only when "Download (legacy layout)" is
  actually chosen — once per stored row, and the click that paid for the
  formatting gets its download (the generator handle gained a programmatic
  `download()` for exactly this). The deterministic typeset control was
  already first at both mounts.
- **Cash Flow / Cash Flow Comparison** — the 10 Year menu already carried
  the converged shape ("Generate PDF" server-first, legacy named beneath);
  the comparison modal's two jsPDF exports are now demoted ghosts labelled
  "(legacy layout)" beside the typeset controls that already led.
- **Report Q&A** — the toolbar's ambiguous "Export PDF" is now
  "Transcript (legacy layout)": it posts a pdf-lib *transcript* into the
  chat, a different document from the typeset structured report, which is
  why it remains a choice rather than being folded. The editors' own jsPDF
  exports stay untouched — they export user-EDITED content the server
  routes cannot see.
- **Borrowing Capacity, Portfolio, Commercial Capacity** — already
  conformant; nothing changed.

Out of scope, recorded: the quantitative-analysis viewer
(`pages/ReportViewer`), `PropertyReportGenerator`, `OverviewSnapshotPDF`,
the Strategy Rationale Brief, call-log and lender-packet exports are
standalone documents with no typeset twin — there is no unified delivery to
hide them behind, and inventing one is new-format work, not consolidation.

### Contracts renegotiated, not broken

Each affected `legacyPathStays` spec records the new decision in place of
the old one: Q&A pins the deletion; Market Intelligence pins "named choice,
drawn only when picked, never a side effect of generating"; Client Details
pins the order (unified first) and the naming. The specs that pinned
handlers, field names, destinations and server contracts pass unchanged —
demotion touched chrome, not machinery.

### Verification

2,360 report-suite tests green across 108 files (every legacyPathStays
contract included), `tsc` clean, eslint at exact error parity with `main`
(zero introduced), `audit:style` ratcheted down and holding, production
build, edge column-name gate, the security gate chain (registry, static,
authz, CORS, mass-assignment, public-validation et al.), and esbuild parse
checks for the touched Deno modules; security inventory unchanged (no new
internal call edge).

## 14 · Closing pass — every open finding and deferred item, measured and closed (2026-09-02)

The owner asked for whatever remained — "remaining phases and stray
patterns" — to be executed and the loops closed once and for all. The named
phases were complete, so this pass took the register's open findings and
every "deferred, with reasons" note in §9–§13, measured each against the
live system, and acted where the measurement supported action. What follows
is the whole list, including the items closed by *decision* rather than by
code, because a loop closed by "we looked, here is why not" is closed.

### Closed by code

**F17 at its source — the generator fabricated a bedroom count.**
`effectiveBeds` was `mergedOverrides.bedrooms || propertyDetails?.beds || 3`
(bathrooms `|| 2`), and the prompt's specification table read it, so a
property whose count was never captured was asserted to the model as "3
bedrooms" — which is exactly how a real report said "3 bedrooms" three
times about a four-bedroom subject. Measured the same day: **0 of the last
43 reports carry a bedroom count in `property_specs`** while 651 older ones
do, because the callers spell the facts four ways (`beds`/`bedrooms`,
`landSizeSqm`/`landSize`/`land_size_sqm`, `carSpaces`/`parking`) and every
site read exactly one; the specs write read `.landSize`, `.buildingSize`
and `.parking` while every caller sent `landSizeSqm`, `buildSizeSqm` and
`carSpaces`, so three of nine specs were null on every row whatever the
caller knew. Now: one normalisation, once, before anything reads a fact;
the FACT is null when unknown and the prose says "Not specified"; the
MODELLING DEFAULT (`modelledBeds`) exists separately and feeds only the
scorer and the rent lookup, which need a number to model with and never
reach a page. Pinned by `closingPass.spec.ts`.

**F17's detector, measured on production prose.** The regeneration-retry
deferral said "detector mileage first"; the detector had had none (0 rows
touched since Phase 2 merged), so it was run offline over 18 production
reports — 10 recent, 8 with bedroom counts. Result: **one true positive**
(a lot priced at $693,100 whose entire money section anchored on the suburb
median, $625,000, six times — the class disclosure exists for) and **one
false positive**: a spec list, "Bedrooms: 3 - Bathrooms: 2", whose " - "
separator the `[\s-]*` bridge read as the hyphen of "3-bathroom", while
the true label-first "Bathrooms: 2" never counted as the recorded value
appearing. Counted mentions now allow one separator character, label-first
forms are collected, and both production cases are pinned as tests.
**The retry itself is deliberately not wired**: one positive in eighteen is
not the volume that validates a section-scoped correction loop inside the
highest-volume generator's resume bookkeeping, and the fabrication fix
above removes the mechanism that produced the reported contradiction.
Disclosure stays the remedy; this measurement is recorded so the next
decision starts from evidence.

**F26's remaining readers.** `reconcileStoredFinancials` now runs where
the two comparison producers read rows (`compare-investment-reports`,
`compare-cash-flow-reports` — both were handing a model triple-charged
figures for historic rows) and inside `projectCashFlow` itself, so the 10
Year Cash Flow heals whatever path a row arrives by (browser adapters,
sample data, the live-projection carrier). The cash-flow render routes
turned out not to read the column at all — they render the snapshot the
adviser reviewed — so nothing was owed there.

**F28's class, five more instances.** `investment_reports`' SELECT policy
is `generated_by = auth.uid()` (plus the client-owner branch) — measured
from `pg_policies` — so a browser read answers with the current user's own
reports and calls it the whole: the Overview's "reports this month" was one
person's count, the Q&A library picker offered a user only their own
reports, a client's portfolio actions listed nothing for a colleague, the
auto-generated badge marked only your own rows, and the error-log retry's
status reset matched zero rows for anyone else's report and said nothing.
All five read through `get-investment-reports` (whose `listOptions`
already carried every filter needed) or write through
`manage-investment-reports`; the picker now fetches a body per pick rather
than 200 documents to draw a list. `closingPass.spec.ts` pins all six
files (the Phase 4 one included) against a table read.

**A sixth instance, found by the gate rather than by the sweep.** Removing
the browser client from the Q&A picker left one call behind, and CI's
undefined-identifier gate caught it — `check-src-missing-names.mjs`, the
one gate this repo keeps precisely because the app is never fully
type-checked (`tsconfig.json` declares `"files": []` and delegates to
project references, so a bare `tsc --noEmit` verifies **nothing**; that is
why a local run said clean). Looking at the line it named turned up a
defect older than this pass: the call read `client_properties`, whose only
SELECT policies are **service-role**, so it answered `[]` with HTTP 200 for
every user — and an empty property list short-circuits the picker to "no
reports" whenever it is opened for a client. It now reads through
`get-client-data`, which brokers that table behind the
`client_management` permission and a client filter. The lesson is the
gate's, not the sweep's: an import removed is an audit of every use of it.

**F15.** `manage-branding` trims string columns at the write boundary, and
the migration brings the stored `company_name` — trailing space, measured
— to what every reader was already trimming it to.

**Linkage columns.** 48 rows carried only `parent_report_id`, 20 only
`derived_from_report_id`, 0 disagreed where both were set; the migration
backfills each from the other, idempotently. Readers already resolved the
union, so no reading changes — the record is coherent now. All three
statements were planned against the live schema with `EXPLAIN` before being
committed (45, 17 and 4 estimated rows, matching the counts above); nothing
was executed against production.

**A test that failed for its own weight, not for a defect.**
`printFontPolicy.spec.ts` reads and regex-scans every
`seed_template_library` migration — **199 MB across nine files**, the
catalogue written out as SQL — under vitest's default **5-second**
allowance. Alone it takes about a second; in a loaded parallel run it took
**7.3 s** and failed the file, which is what "flaky" looked like from the
outside. The assertion is untouched and the scan is unchanged; only the
clock now reflects the work, so the gate fails when a face is missing
rather than when the machine is busy.

**A silent skip made visible.** The Q&A library picker now reads a body per
pick, and a completed report carrying no body cannot be asked questions
about. It names the ones it could not read rather than dropping them from
the selection without a word — a pick that vanishes with no reason reads as
a broken button.

### Closed by decision, with the measurement

- **F6 (content parity: hero photography, exec summary, editor's note).**
  The binding projection publishes no hero image and no master binds one;
  adding a cover photograph is a change to all fifty generated investment
  masters, which by the catalogue's own rule goes to Claude Design and
  comes back through the generator — recorded as the design-catalogue
  decision it is. The legacy route's render-time executive summary and
  editor's note were model calls made at RENDER; the templated document is
  the stored report, and a renderer that invents content is the invariant
  this programme exists to enforce. Not ported, deliberately.
- **F7 (legacy renderer's eleven private chart drawers vs `vizFigures`).**
  The legacy route is now the hidden fallback behind every unified
  delivery; rewriting its charts onto the shared primitives would be
  effort spent on a road nobody is offered. Left, named.
- **F8 (reports unlinked from clients).** 2 of 1,193 carry
  `client_property_id`; both came from the client tab, which links
  correctly. The other 1,191 were generated from listings or the report
  form, where no client exists to link — a post-hoc "link to client"
  affordance is a product feature, not a stray pattern.
- **Template resolver ×3.** The browser resolver calls the authoritative
  `resolve_report_template` SQL function first and falls back to a JS
  ranking parity-locked to the edge copy — one authority, two guarded
  mirrors. Report-type normaliser ×2: the browser re-exports the shared
  pure module. Both already folded; the register's note is superseded.
- **Minor unnumbered items.** Table rows keep together
  (`table.data tr { page-break-inside: avoid }`); contents labels derive
  from the spine; the scoring band strings are the engine's own one-line
  reasons carried for the wheel. "andother" and the mixed minus glyphs
  were prose defects in one generation, remedied by regeneration.

### Verification

Full vitest suite green end to end in one run — **1,071 files, 20,503
tests, 0 failures** (the two that failed the first pass were the font-policy
timeout above and one load-sensitive market-updates fixture, both green
now); `tsc` clean; eslint **0 errors** on every changed file; style ratchet
holding; production build; all seven touched Deno modules parsed with
esbuild and the edge type-check ratchet run locally with Deno installed —
**no file this changeset touches sits above its baseline**; the security
gate chain (registry, static, authz, CORS, mass-assignment,
error-disclosure, public-validation, migrations, portal boundaries);
security inventory regenerated and unchanged. Production measurements were
taken read-only through the project's SQL interface and are quoted above;
the migration was validated with `EXPLAIN` and never executed.

---

## 15 · The generation engine — a control that could never take effect (2026-09-04)

The owner sent a screenshot of the Investment Analysis page's **GENERATION
ENGINE** drop-down and asked a fair question: how is an operator meant to
know whether "the trimmed version" is the one to pick — and if it is now the
primary engine, name it Primary.

The answer is worse than the question assumed. **There was nothing to pick.**

### What the drop-down did

Nothing. `InvestmentReportGenerator.tsx` sends no `reportTier`, so the
generator's `rawTier` falls to its default:

```ts
const rawTier = propertyDetails?.reportTier || 'compass';
const isCompassTier = rawTier === 'compass' || rawTier === 'compass-40';
const generationEngine = isCompassTier || requestedEngine === 'compass-40'
  ? 'compass-40' : 'legacy';
```

`isCompassTier` is therefore **always true from that page**, and the engine
resolves to Compass whatever the operator selected. That is not a bug in the
resolution — the tier is the data-minimisation boundary, and an engine
preference must never be able to pull financial content into a non-financial
report — but it makes the control inert.

The drop-down opened on the option that never ran, and described it as the
safe one: *"Legacy Compass — Stable · Full DB template, ~12 chunks,
battle-tested."* Every quality gate this programme built runs under the
other one — the canonical section registry, `postProcessReportMarkdown`,
`runQAValidation` — all inside `if (compass40OverlayActive)`. So the default
was labelled *stable* and was in fact the ungated path, and it made no
difference either way.

**A dead control is worse than no control**, the rule this repository
already applies to the AUSTRAC path card. This one was worse than dead.

### What the column recorded

`generation_engine` was written **only by the browser**, at request time.
So the row recorded the *selection*, not the run. Measured on 2026-09-04:

| `report_tier` | `generation_engine` | rows |
| --- | --- | --- |
| compass | legacy | **1,124** |
| snapshot | legacy | 25 |
| briefing | legacy | 21 |
| strategic | legacy | 10 |
| financial | legacy | 10 |
| compass | compass-40 | 2 |
| briefing | compass-40 | 1 |

Every one of those 1,124 rows says "legacy" about a document the Compass
engine produced. **A record of what was requested is not a record of what
happened.** `generate-investment-report` now writes the column on the
completion update, from `compass40OverlayActive` — the flag that actually
governed the run.

The historic rows are **deliberately not backfilled**. The rows predating
the tier promotion genuinely did run on the legacy engine, and the honest
discriminator is `total_sections` (the Compass registry persists 17, the
legacy section list 12) rather than a date nobody can pin to a deployment.
Replacing one guess with another is not a repair; a regeneration now stamps
the truth on the rows it touches.

### What changed on screen

The page **states** the engine instead of offering it: *Compass — Primary*,
with what it produces and what it deliberately omits (purchase price, yield,
LVR, loan and ten-year cash flow belong to the Financial Analysis Report).
The name lives in `ENGINE_LABEL` in one module, because two literals is how
two screens come to disagree.

The Regenerate dialog carried the same two options, and there the choice was
not merely dead but **harmful**: on a Compass report the server overrides it,
and on a Financial Analysis report picking Compass would strip the financials
the report exists for. It is a statement now too, resolved from the report's
own record.

### The rule, in one place

`src/lib/reports/generationEngine.pure.ts` mirrors the server's expression —
tier first, caller preference only where the tier leaves the question open.
It is deliberately neither trimmed nor lower-cased, because the server
compares with `===`: a module whose whole job is to say what will happen
must not be kinder than the rule it reports. `generationEngineTruth.spec.ts`
reads the edge function's own source and fails when the two drift, the guard
`llmUsageBinding.pure.ts` already carries against the router.

### One defect found on the way

`useChunkedRegeneration` sent `reportTier: normaliseReportTier(...)`, and
that helper collapses **everything except `financial*` into `compass-40`**.
It is right for counting chunks and wrong for the tier, which is the
boundary the server resolves the engine from — so regenerating any of the
**56 production `snapshot` / `briefing` / `strategic` reports** would have
sent `compass-40`, and returned a Compass document in place of the report
that was there. It now sends the report's own stored tier and resolves the
engine through the shared rule.

Two smaller things fixed in passing: the dialog read the `detail` projection
(~95KB of report prose plus every JSON blob on the row) to read one string,
and passed `listOptions.select`, which that function documents as
"deprecated and deliberately ignored" — it takes `generationProgress` now.

### Verification

Full vitest suite green in one run — **1,075 files, 20,556 tests, 0
failures**; `check-src-missing-names` clean; the edge column-name gate and
the style-token ratchet both holding; eslint **0 errors on every changed
file** and the repo total down one (44, from 45 — a
pre-existing `prefer-as-const` in a file this touches); production build;
the edited edge function parsed with esbuild; the edge type-check ratchet run
under the Deno version CI resolves (`v2.x` → 2.9.6) with **no file above its
baseline**. A local Deno 2.1.4 reports four unrelated `builderStock` /
`immutableDocuments` files as regressed: they use `Uint8Array<ArrayBuffer>`,
which needs TypeScript 5.7, and they are clean under the CI toolchain — the
gate is only meaningful on the version CI pins. Production counts were taken
read-only through the project's SQL interface and are quoted above; nothing
was written to the database.

---

## 16 · The template picker becomes a gallery (2026-09-04)

The owner's ask, verbatim in intent: choosing a template from names alone is
not choosing — show the actual template styles, lead with **different design
families** rather than one family's variants stacked above the next family's
first appearance, and let it cascade to every report being generated.

### What was there

`ReportTemplatePicker` listed the catalogue as radio rows of text. For the
Investment format that is **sixty rows** — ten families × five layouts plus
the ten individual designs — in which "Sovereign Folio" and "Signal Dark"
are names nobody can rank without seeing them, and the five Private Banking
variants sat above Dark Executive's first appearance. Meanwhile the Template
Library's browse page already rendered every design's real first page
(`TemplateDocumentPreview` — the same `renderTemplateToHtml` the customer's
PDF goes through, with sample data), so the pictures existed one page away
from the decision they were for.

### What it is now

- **Families first.** One tile per design family — ten visually different
  documents — each tile the family's reference layout rendered for real, on
  the light-table sheet treatment the Library established. Opening a family
  reveals a tray with its five layouts and its ten curated colourway swatches,
  and choosing a colourway repaints every sheet in the tray, so "Oxblood or
  Platinum?" is answered by watching. The tray scrolls itself into reach when
  opened, because a family in the gallery's second row would otherwise reveal
  it below the fold — a click that appears to do nothing.
- **Individual designs** (the voice templates, no `designMeta`) sit beside
  the families as their own tiles, each with its own face.
- **Active rows with no library lineage** get a face too. Their rows carry no
  `preview_schema`, and the picker's projection deliberately never fetches
  `config`/`schema` whole — so page one and the token palette alone are
  fetched, lazily, only when the dialog is open with such a row to draw
  (`fetchActiveTemplatePreviewPages`; PostgREST `schema->pages->0`, measured
  at ~50KB across every active row in production, largest page 3.9KB). A row
  whose schema has no pages, or a failed fetch, degrades that tile to an
  empty sheet — a missing picture never takes the chooser down.
- **A stored selection is followed visually**: its family opens pre-expanded
  with the design checked and badged Current, its colourway pre-selected.

**Nothing behavioural changed.** The save flow (adopt-then-select,
idempotent on entry + version + colourway), the fold of active rows into the
designs they descend from, "Choose automatically", the unavailable-choice
alert, the non-WeasyPrint disclosure and the ownership model are all exactly
as `TEMPLATE_SELECTION.md` records them — the same tests assert them against
the new surface. And because every surface mounts this ONE dialog
(`ReportTemplateSelector`, `useReportTemplateMenu`, the Templates page's
bindings list — the map `templateRouteEnforcement.spec.ts` holds complete
against the adapter registry), the gallery reaches all nine production
formats' download controls without touching any of them.

### Measured in a real engine

jsdom has neither layout nor iframes, so a DOM test passes while every tile
paints blank. `tests-e2e/report-template-picker/` mounts the real dialog in
Chromium over **sixteen real catalogue rows** (the ten family references,
all five Private Banking layouts, two standalone designs — their production
`preview_schema`, fetched read-only) and asserts on painted iframes and
bounding boxes: families visible and painted before any variant, the tray's
five layouts painted after one click, swatch repaint, one checked radio on
the followed selection, no sideways scroll at 1440×900 or 390×844
(`npm run test:e2e:report-template-picker`).

One environmental fact worth recording: a preview document's Google-Fonts
`@import` blocks a srcdoc iframe's **first paint** while the stylesheet is
pending, so an environment that black-holes `fonts.googleapis.com` shows
blank sheets until the connection dies — which is how this harness's first
screenshots came out, and why its fixtures strip `tokens.fontFaces` (the
fallback stacks are what a browser with no reach to the CDN uses anyway).
Production serves those fonts and the Library page demonstrably paints the
same previews.

### Verification

Picker unit suites rewritten and green (8 gallery tests, 14 selector tests —
one renegotiated wording pin); `templateRouteEnforcement.spec.ts` and the
adjacent template suites green; all five Chromium layout tests green; eslint
0 errors on every changed file (repo total holding at 44); style-token
ratchet holding; `check-src-missing-names` clean; production build; full
vitest suite green in one run — **1,077 files, 20,575 tests, 0 failures**. Production reads for fixtures and measurements were
read-only.

---

## 17 · Five client PDFs, six defects, one render (2026-09-04)

The owner attached five PDFs downloaded that morning — three reports of
1/27D Mitchell Street, Muswellbrook (a Compass, a Financial Analysis and a
derived Snapshot), rendered through Chancery and through the Luxury
Editorial "Frontispiece" chosen in the new picker — and named four
complaints: N/A everywhere, no table of contents anywhere, every report
titled Investment Compass whatever was chosen, and content cut off. All
four reproduced from the files, and the investigation found two more
underneath them that none of the four names: the silently dropped figures
(§1), and — visible only once those figures drew — the chart primitives
clipping their own labels (§6).

### 1 · Every figure the model composed was silently dropped

The stored Compass body carries **43 chart directives** — 13 glance strips,
6 bars, 6 donuts, 6 gauges, 4 timelines, a wheel, tiles, a heatmap, a
pictograph — and the rendered PDF contains **none of them**.
`markdownBlock.html.ts` called `renderMarkdown` without `renderDirective`,
and a shortcode is an instruction to the renderer either way, so every
directive was removed and drawn as nothing. The Disclaimer, whose whole
content is one glance strip, printed as a heading over nothing.

The block passes `vizDirectiveRenderer` now, in a `ChartContext` built from
the template's own tokens (keyword fallbacks, per the planning-context
convention), and `projectReportNarrative` charges the SAME directives
through `planningChartContext()` — `figureLines` reads the SVG's geometry
alone, so the page count and the buckets stay one arithmetic. The Compass
document grows from 13 truncated body pages to 23 complete ones.

### 2 · The tail printed over the running foot, silently

Page 19 of the Compass render ends mid-bullet — "Commercial Property Data
Providers (CoreLogic, Domain, realestate.com.au)" with its description
gone — and the footer beneath it is garbled where overflow text struck
through it. Measured: the final bucket packed **47 charged units under the
50 budget** and still overflowed the physical box, because the measured
charge model undercounts a bold-lead bullet list (a top-level item was
charged at the full measure, ignoring its own hanging indent) and page
margins. The estimator's error exceeded the 8% held back.

Two changes: measured list charging now subtracts the marker indent at
depth 0, and `CALIBRATED_CONT_LINES`/`CALIBRATED_FIRST_LINES` sit at
**46/36** (~16% under the bench capacity) — because a sparse page costs
white space and an overfull one costs a client the end of the document.
Re-packed against the real content: the failing bucket splits, the
Disclaimer and Notes get their own page, nothing touches the foot.

### 3 · N/A nineteen times, about figures the row held

The Snapshot's "The report" pages tabulate Median Price N/A, Grade N/A,
Score N/A/100, five component scores N/A, six financial rows N/A — while
the SAME ROW carries score 62, grade B and a complete
`financial_calculations` block. `condense-investment-report` hands the
model only the parent's PROSE — and a Compass parent deliberately states
no financials — then demands tables. The model, forced to fill a table
from a document that never says the numbers, wrote N/A.

`condenseFacts.pure.ts` renders the row through `projectInvestmentReport`
(the same reconciled projection every templated document binds) into an
authoritative RECORDED FIGURES block in the prompt, and the rule travels
with it: a metric absent from the record and the prose loses its ROW —
never gains a placeholder. The snapshot/financial guides' fixed metric
menus became choose-from lists under the same rule.

### 4 · Four document kinds, one name

Cover eyebrow, wordmark, running head and running foot were the literal
words "Investment Compass" in the Investment composer — and those masters
serve the compass, financial, snapshot, briefing AND strategic tiers. So a
Financial Analysis was titled Investment Compass on all 15 of its pages.
The composer binds `{{report.documentTitle}}` / `{{report.standfirst}}`
now, and `DOCUMENT_IDENTITY` in the projection is the one place a tier is
translated into words (Financial Analysis; Snapshot Report; Executive
Briefing; Strategic Overview; compass keeps its name and standfirst — and
an unrecognised tier reads as compass, the ranking's default document).

### 5 · Two whole families had no contents page

37 of the 50 Investment masters carry a Contents page; **Luxury Editorial
and Private Banking declare `toc_style: none` family-wide** — the house
default and the design the owner chose, which is why all five PDFs lack
one. `hasContents` returns true for every style now: navigability is a
property of the document, not of a family's styling, and `toc_style` keeps
deciding how the list is drawn, not whether the reader gets one.

### 6 · The chart primitives clipped their own labels

Fixing §1 made the figures visible, and the first honest render showed the
primitives cutting text: the score wheel printed "FUTURE RESILIENCE" as
"RE RESILIENCE" and lost GROWTH ALIGNMENT's tail; the bars' label column
clipped "Property-specific verification need" at the left edge; and the
risk matrix drew "5=High)" as an orphan row label floating under a one-row
grid.

The wheel taught the real lesson. `text()` converts points to viewBox
units through `w / widthMm`, so **widening the box also enlarges every
label in units** — a first fix added the label's estimated width to the
padding and the clip only moved ("TURE RESILIENCE"). Measured in Chromium
(`getComputedTextLength` over the failing labels): a 17-character tracked
uppercase micro label needs 140u of the 78u available at w=460, 161u of
114u at w=532, and would need w≈813 — wider than the wide box — on one
line. The fix is structural: long labels **wrap at the word break that
best balances two lines** (never truncated — a shortened dimension name is
a different dimension), the width is the closed-form solution of
`w/2 − labelR ≥ label(w) + edge` (solvable because label(w) is linear in
w), and the label/value blocks stack radially outward with leads computed
from the type's own unit size, growing the box height from the actual
extents. The advance is measured, not guessed: 0.71em per uppercase
character, 0.55em mixed-case, carried with margin.

The same honesty went to the other two. The bars and matrix label columns
size from `ptToUnits(micro) × 0.58` instead of a 5.4-unit guess (three
characters short on the real 26-character row label); the matrix solves
its width as a converged fixed point, refuses — the module's own rule —
when labels at micro size are physically wider than the measure and no
box width can fit them, and scales its header band and cell height with
the type. And the orphan label was the directive parser: `csv()` split
`rows=Risk level (1=Low, 5=High)` on the comma inside the parenthesis,
declaring a second row the grid never had — it now splits only on commas
outside parentheses (the quote-aware splitter's rule, extended), and
`renderHeatmap` refuses to draw a label for a row or column the grid does
not hold, because a labelled row is a promise that figures follow.

### Shipping the fix to documents people already generate

Master schemas are COPIES — seeded and adopted rows never updated — so the
v10 seed alone would fix only future adoptions. Two migrations ship
together: `20260917100000` reseeds the library (543 templates revalidated),
and `20260917110000` refreshes every ACTIVE `report_templates` row that
descends from a listed design: the entry's new schema with THE ROW'S OWN
token colours carried forward (a colourway bake is exactly that merge, so
no palette is invented), and the lineage's entryVersion advanced so the
picker's fold keeps recognising the copy. Rows with no lineage are
untouched.

### Verified against the failing documents themselves

Both real reports were re-rendered through the updated Luxury Editorial
master with the real projection in Chromium: the Financial Analysis covers
itself as FINANCIAL ANALYSIS with its own standfirst; both carry Contents
as page 2; the wheel, donuts, glance strips and gauges draw in the family
palette; and both tails — the exact sentences missing from the shipped
PDFs — sit whole on their pages. Every chart-bearing page was then
screenshot and read: all five wheel labels whole (wrapped, values clear of
the disc), the three DD-focus bar labels whole, and the risk matrix one
labelled row with six labelled columns. `reportRenderDefects.spec.ts` pins
all six fixes; `narrativeCalibration.spec.ts`, `vizDirectives.spec.ts` and
`vizFigures.spec.ts` hold.

## 18 · Coverage of the choice, and the cascade into every format (2026-09-04)

The owner attached a real 15-page Property Comparison and asked two things:
that the visual template choice reach **every** area that produces a report
or downloadable document, and that §17's rectifications (Contents pages and
the rest) demonstrably cascade beyond the Investment format. Both were
measured before anything was changed.

### The choice — 40 exits swept, three gaps, one lawful absence

Every document exit in `src/` was inventoried: forty inside the report-format
system and twenty-three deliberately outside it (AML records, agreement
templates, portal file downloads — each governed by its own rules, none a
candidate for a template choice). Coverage was already strong: the primary
exits of nine formats carry `useReportTemplateMenu` or an inline
`ReportTemplateSelector`, and `templateDocument.ts` honours the stored
selection at delivery with the `unavailable` guard. Three Investment exits
did not — the Generated Reports **viewer**, the listings **modal** and the
client-property **download sheet** all delivered through the unified
template-first road while offering no way to see or change which template
the document comes out in. Each now mounts the selector where the export
panel precedent puts it: before the buttons that use it. The Cash Flow
Comparison's absence is correct, not a gap — the format is preview-only
because nothing about a comparison is persisted anywhere a template can
read, and the menu hook already returns nothing for a format a choice
cannot change. Legacy jsPDF paths are outside selection by definition: they
ARE the named legacy layout.

### The cascade — one real comparison, eight defects, three of them global

The attached PDF (three properties, NSW) reproduced a defect family §17's
fixes had not reached, because every §17 measurement was taken on the
Investment format:

1. **Parts jumped 12 → 19.** Part numbers were baked at compose time
   (`partNo += 1`), so every page a `conditional` dropped left a hole in the
   numbering of the document that shipped. Part numbers now resolve at
   render time: the renderer counts `{{partNumber}}`-binding pages over the
   pages that actually draw (the binding is also the opt-in, so the cover
   stays outside the count), `pad2` keeps the "Part 07" style, and the same
   per-page value serves the running head and the section numeral so the two
   cannot disagree. All six composers that number parts converted
   (`renderTimePart` in `blocks.ts`); the count is folded into the page
   cache signature because a page's number depends on which preceding pages
   opted in.
2. **Empty ruled stripes under labels.** The scorecard drew two blank zebra
   rows for axes the record does not hold, and three of six "Basis of the
   analysis" rows printed as label-over-nothing. `data-table` rows already
   had the answer — an explicit per-row `when`, added for exactly this rule —
   so `definition-list` items gained the same (`renderDefinitionListHtml`
   filters, a list whose every item is absent draws nothing), and the
   comparison composer declares the conditions on every fixed slot.
3. **Whole pages of furniture over nothing.** The "Money · cash flow" page
   rendered a heading and zero rows; "Who each property is for" rendered a
   heading and nothing at all (its continuation page was conditional, the
   first page was not). The axis-reason pages are now conditional on holding
   at least one slot, and the first investor-fit page on `matches[0]`.
4. **A callout that asked its own question and left it blank.** "Why there
   is no recommendation here" bound `comparison.truncationNote`, which was
   composed only for salvaged rows — the attached row is structured and
   complete, merely without a structured `bestOverall`, so the heading drew
   over an empty body. The projection now composes the note whenever the
   pick is absent, whatever the cause, in the format's own sentences.
5. **"Eleven axes, side by side"** was a hardcoded count over a
   data-dependent table showing eight. The heading is count-free; with row
   suppression the table describes itself.

The Contents-page cascade needed no new work — every format's composer gates
its Contents on the same `hasContents` §17 made unconditionally true — but
it was verified rather than trusted: the fixture comparison renders 14 pages
with Contents as Part 01 and parts 01–12 consecutive, the empty pages gone,
the basis list three honest rows, and the verdict callout answered. A
converted Borrowing Capacity master renders gap-free under sample data with
no unresolved `{{partNumber}}`.

Shipping is the §17 pattern: the v11 seed (543 templates revalidated) plus
`20260918100000_refresh_active_masters_from_library_v11.sql`, which
re-copies every active library-descended row with its own baked colourway
carried forward. `reportCoverageCascade.spec.ts` pins the renderer count,
the filter, the item `when`, the projection note, the composer conditionals,
the three selector mounts and the migration pair; the four catalogue specs
that assert "bind nothing the projection cannot publish" now name
`partNumber` as renderer-ambient, beside `pageNumber`.

## 19 · Phase 1 of the tier framework — derived reports read the record (2026-09-05)

The signed-off framework (`docs/reports/TIER_FRAMEWORK.md`, and the audit that
preceded it) reduced every derived-tier defect to one cause: prose was the only
carrier of substance, and the Compass — the only parent — stopped carrying
financial prose in v3.0. Phase 1 makes the record the carrier. All figures
below were measured on the 4 September production family of 1/27D Mitchell
Street (parent `0478c410`, children `c21ed1fa`/`2f1f7f6f`/`89b451f6`/
`8c6edc56`) before and after, re-composed through the same modules the
functions now run.

**The Financial fork composes its chapters from `financial_calculations`.**
The "Client Investment Feasibility & Financial Performance Report" was a
substring routing of a parent with no financial sections to route: 7 headings,
ONE dollar sign, while its own row held seven key metrics, eleven annual-cost
lines, ten loan details, three projection scenarios and a sensitivity grid.
`reports/investment/financialChapters.pure.ts` writes the missing chapters —
purchase & holding costs, rental & yield, loan structure, sensitivity, the
ten-year table (with equity and LVR, which the stored series already carried),
the scorecard and the SWOT — from `reconcileStoredFinancials(...)`'s healed
record, the same heal the KPI tiles bind, so a chapter and a tile cannot
disagree. Composed chapters REPLACE routed prose claiming the same FIN ordinal
or heading (the record wins over a legacy parent's stale tables), and the
response names what was replaced. After: **14 headings, 109 dollar signs,
0 N/A**, and the document reads as the declared FIN structure.

**The Briefing's guide is cut to the parent that exists.** It still described
the 17-section legacy Compass — eight financial tables and a market-performance
grid demanded from a parent forbidden to carry them, which the model filled
with N/A: 33.2 per briefing before August, 87 on the newest. The guide now asks
the model only for the condensed location case; the financial tables, score
breakdown and SWOT are composed server-side after the call (`composed_sections`
in the response), and the SWOT is typed from the score record's own four lists
rather than improvised.

**A labelled row is a promise — enforced on stored markdown.**
`derivedHygiene.pure.ts#stripPlaceholderRows` drops a table row whose first
value cell is a placeholder, blanks trailing placeholder cells, drops tables
left with no body, and drops placeholder-confession lines ("- Source
attribution: N/A (…)"). Run over the worst production briefing it removed 39
rows, 11 tables, 5 lines and blanked 15 cells — **87 → 0**. It runs on every
fork and condense output, alongside `stripEditorialLabelsFromMarkdown` (the
label strip alone, exported from the post-processor — the full pass's word
caps are the Compass's and must not touch other tiers' sections).

**The Snapshot is one document again.** The newest snapshot carried its 8
declared sections and then the parent's 9 echoed back — 17 headings, 2.5× the
format's length, and nothing post-processed it (hygiene ran on the briefing
alone, which was exactly backwards). `trimToDeclaredSections` keeps what the
tier declares and names what it dropped; the guide now says so to the model
too. Measured: 17 → 9 headings, 12,325 → ~3,000 chars, 17 → 11 rendered pages.

**The Due Diligence scorer can score, and the verdict sentence can no longer
print holes.** `scorePropertyFundamentals` counted `dDemand` twice (as demand
AND "tenant fit") against a three-of-five floor, so a row without both real
dimensions never scored — `investment_score` was null on 11 of 11 strategic
rows and the verdict page printed "Graded  at  out of 100" with the holes
left in. Four honest dimensions now, floor stated in place (≥2 available, at
least one of location/demand), weights rebalanced 40/35/15/10. The fork falls
back to the parent's composite score when the variant scorer cannot compute
(a refresh never overwrites a good score with null) and carries the parent's
strengths/weaknesses/opportunities/risks onto variant scores, whose engine
leaves them empty. And the sentence itself is COMPOSED: the projection
publishes `recommendation.gradedLine`/`gradedDetailLine` only when grade and
score exist, with a weighting clause naming the dimensions THIS score carries
(`scoreSections.pure.ts`); the two verdict bodies bind it (template library
v12 + active-master refresh). Measured: the strategic child renders "Graded
C+ at 53 out of 100, weighted across location and planning risk." where it
rendered holes.

**Lineage is stamped.** `fork-investment-report` never wrote
`generation_engine`, so every child took the column default `legacy` —
including the four forked from a compass-40 parent — and never carried
`report_scope` at all. Both engines now stamp the parent's engine; the fork
carries scope.

Pinned by `tierFrameworkPhase1.spec.ts` (19 tests: composition, hygiene,
scorer, sentence, source-scans of both functions, the v12 migration pair).
Bridges keep the new pure modules inside the investment format's closed
import set; `condenseFacts` now shares `figures.pure.ts` with the composer so
one thousands-separator serves both.
