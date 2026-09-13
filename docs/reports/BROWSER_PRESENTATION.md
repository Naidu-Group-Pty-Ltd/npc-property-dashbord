# The Investment report is drawn in the browser, and chosen in the browser

Read this before touching `src/lib/reports/investment/deliverInvestmentPdf.ts`,
`investmentPdfDocument.ts`, `src/lib/reportTemplate/pdfRenderer.ts` or anything
that decides which presentation a client's Investment PDF comes out in.

One report truth, several approved presentations:

```
Report Engine        → generates and validates the report
Report Editing       → persists the operator's approved edits
Templates page       → selects the presentation
Presentation         → applies presentation only
Export / Delivery    → Blob → Supabase Storage → download / send / portal
```

`produceInvestmentDocument` is the one contract. Every surface that hands a
client a PDF asks it — the report page's button, the flatten copy, Send to
Client, the client workspace's Reports tab — and `publishInvestmentPdf` is the
one that also stores the bytes and records `pdf_url`. **There is no second PDF
truth to choose between by pressing a different button**, which is what there
used to be: three controls produced three different artefacts, and only one of
them honoured the operator's template selection.

Nothing on this path reaches a render service. `render-investment-report-pdf`,
`render-template-pdf`, `WEASYPRINT_SERVICE_URL` and every `*.run.app` host are
unreachable from it, asserted over the module graph rather than by grepping a
directory (`investmentJourneyNoRenderService.spec.ts`) — the repository still
holds WeasyPrint clients and a Cloud Run export dialog, and the point is that
they belong to **Template Builder**, which a client PDF must never require
anybody to open.

## Two presentations, one payload

| | standard | selected template |
| --- | --- | --- |
| renderer | pdf-lib, `investmentPdfDocument.ts` | jsPDF, `reportTemplate/pdfRenderer.ts` |
| telemetry | `browser_pdf_lib` | `browser_template_jspdf` |
| drawn from | the report's own Markdown | the adapter's frozen binding payload |

Both identities are exported constants rather than literals at the logging call
site, because telemetry has exactly one question to answer — *which renderer
produced these exact bytes* — and it used to answer `premium_weasyprint` on
every download, long after WeasyPrint had stopped being reachable. A telemetry
value naming a retired service is worse than none, because it is read as
evidence.

**The readiness gate sits above both.** `assertInvestmentReportClientReady`
refuses a report carrying a blocking `governed_authority` flag whichever
presentation it would have come out in, because the defect is in the report and
not in the layout. It used to live inside the two render services, which meant
removing them would have deleted it.

## Five controls, and the two kinds they are

`presentationOptions.ts` states them once.

* **Sources** and **Scoring** are CONTENT INCLUSION. They remove whole sections,
  and they are applied to the report's Markdown **before either renderer sees
  it** — so a chosen template and the standard document agree about what belongs
  in this client's copy. They were inline in the standard generator before,
  which meant a report delivered through a template carried its source notes
  however the switch was set, and nobody was told. Measured over the corpus, the
  Sources rule matches a heading in **964 of 1,210** reports and the Scoring rule
  in **1,043**; a report whose source notes are folded into a combined appendix
  with the disclaimer matches neither, and that is correct — removing that
  heading would remove the disclaimer.
* **Charts**, **Hero images** and **Sparklines** are PRESENTATION. They decide
  what is DRAWN, never what is true: turning charts off leaves every figure,
  table and sentence the chart was drawn from exactly where it was. Measured on
  report `783bb982`, Charts off takes the standard document from 20 pages to 14
  and the Dictionary template from 29 to 23, and removes no number.

Hero images place what `report_hero_placements` already holds. **Nothing is
generated during export** — no model call, no image API. That table currently
holds zero rows across the whole database, so the control is wired and has
nothing to place; that is an honest empty rather than a broken switch.

## A directive is drawn or dropped — its source is never printed

The generator's prompt tells the model to write its figures as `{{bars: …}}`,
`{{gauge: …}}`, `{{glance: …}}` and nine more kinds. `markdown.pure.ts` states
the rule and the template presentation obeys it through `vizFigures.pure.ts`.
The standard presentation had never heard of them: on report `783bb982` it set
**thirty-six** of them as body copy on a client's pages, one repeated across
four consecutive pages because the line was carried as a table's header row. 60
of the 1,195 completed reports carry directives — 4,652 of them, 77.5 a report —
and they are the ones the current generator writes.

Two rules came out of fixing it.

**The removal happens at paint time, and nowhere earlier.** Stripping before
`parseReportContent` cost the document FOUR CHAPTERS and the disclaimer:
`parseReportContent` saves a section only `if (currentContent.length > 0)` and
`allSectionNames` drops anything under forty characters, so a chapter whose own
body is a single `{{glance: …}}` opener — "Why This Location Matters", "Amenity
& Access", "Property Fit Within the Suburb", "Appendix, Source Notes &
Disclaimer" — became a heading over nothing and vanished with its contents entry
and its subsections' parentage. Sectioning, the section filter and the table of
contents see what the record holds; only the painted text loses the tokens.

**A removed figure never removes a sentence.** The prose around a directive, and
every number in it, is untouched.

## An unresolved binding renders as the empty string, never as a visible `{{…}}`

That is the presentation renderer's own contract, and `definition-list` broke it
in the one place the Investment masters put the report's own facts: it read
`String(item.definition)` instead of resolving it, so **thirteen tokens** —
`{{org.name}}`, `{{property.address}}`, `{{assumptions.capitalGrowth |
percent}}`, `{{recommendation.grade}}`, `{{assessment.4.details}}` and the rest —
were set as body copy on the assumptions page and the colophon of every rendered
report, identically across all three selectable structures.

`productionMastersBindingsResolved.spec.ts` asks the question of the BYTES,
because that is the only place it is actually answered: a renderer that forgets
to resolve a prop typechecks, lints and draws a plausible page.

## Template failure is a fallback, never a worse document

`routeReportThroughTemplate` answers `null` for ten named reasons and the
operator is told which gate closed. The standard presentation then draws the
**same** payload — the same content rules already applied, the same record, the
same readiness gate — so a refused template costs the chosen design and nothing
else. There is no partial PDF, no placeholder panel, no raster, no render
service and no regeneration, and the operator's edits are not lost because
nothing is re-read.

Compatibility is asked of the RENDERER (`judgeBrowserProductionExport`), not of
the template's `engine` column: that column records which service a template was
authored for, not whether it can be drawn. All four selectable Investment
templates pass it, with zero block types lacking a full jsPDF renderer.

## The selectable Investment catalogue

Measured against production on 13 Sep 2026 — four active rows, three distinct
structures (the two Chancery rows are one structure bound to two format
spellings):

| template | format | pages | blocks | block types |
| --- | --- | ---: | ---: | ---: |
| Private Banking — Chancery | `investment` | 50 | 320 | 16 |
| Private Banking — Chancery | `investment_compass` | 50 | 320 | 16 |
| Data / Analyst — Dictionary | `investment_compass` | 51 | 327 | 18 |
| Luxury Editorial — Frontispiece · Midnight Editorial | `investment_compass` | 53 | 325 | 16 |

## What is NOT settled

**The standard presentation withholds the financial KPI set on a Compass report
and the templates publish it.** `extractKPIMetrics` opens with
`if (reportTier !== 'financial') return null` under a comment reading "purchase
price, LVR, yield, rent and similar KPI tiles must never render", while the
masters' Verdict and Financials pages bind `financials.*` unconditionally. On
report `783bb982` that is eleven figures present in all three templates and
absent from the standard document — every one of them correct and drawn from the
same record, so nothing contradicts anything, but the same report delivered two
ways tells a client different things. **1,124 of 1,195 completed reports are
`compass` tier**; eleven are `financial`. Which of the two decisions is current
is a product question, not an engineering one, and it is recorded here rather
than resolved by whichever side was easier to change.
