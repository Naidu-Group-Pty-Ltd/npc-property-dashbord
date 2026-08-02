# 10 Year Cash Flow Analysis — the format's contract

The second format on the report design system, after the Borrowing Capacity
Snapshot. Read [`DESIGN_SYSTEM.md`](./DESIGN_SYSTEM.md) first; this document
covers only what is specific to the cash flow projection.

---

## 1. Where the boundary is, and why it moved

The Snapshot is computed server-side, and its contract document says why: *"for a
document that tells someone how much they can borrow, the contents are not the
browser's to decide."* That reasoning does **not** carry over here, and applying
it anyway would ship a worse document.

A borrowing capacity assessment is a saved row in
`borrowing_capacity_assessments`. A cash flow projection is not.
`CashFlowAnalysisModal` lets an adviser override any of ten fields
(`EDITABLE_FIELDS`) in any of ten years, live, and those overrides are not
persisted until they press save. A server that recomputed from
`investment_reports.financial_calculations` would produce a *different* ten years
from the one the adviser just reviewed, and the client would receive numbers
nobody looked at.

So the split is drawn one step further out:

| | Owner |
| --- | --- |
| The arithmetic — amortisation, growth, tax | The browser, as it already does |
| The document — brand, palette, typography, page geometry, disclaimer | The server |
| Storage, signing, the render ledger | The server |
| Deciding whether a payload *is* a projection | The server |

Everything the legacy jsPDF generator gets wrong is on the server's side of that
line.

**Not trusting is separate from not computing.** `normalise.pure.ts` rejects a
payload that is not a complete, finite, correctly-shaped projection, and names the
field: `years[3].rentalIncome must be a finite number` costs an hour less than
`invalid payload`. Equity, LVR, the weekly figures, the year-one block, the
ten-year outcome and the opening paragraph are all **derived** rather than
accepted — a smaller surface for the caller to get wrong, and the reason the
sentence a client reads first cannot disagree with the table under it.

---

## 2. What the document is made of

| Section | Slot | Pages | Content |
| --- | --- | --- | --- |
| Cover | `cover` | 1 | Property as the title, client in the meta, tenant's mark |
| The purchase and the first year | `chapter` | 2 | Lede, KPI strip, purchase table, acquisition costs, year-one lines |
| The *n*-year projection | `wide-table` | 2 | Two landscape matrices — position, then cash flow |
| Value, debt and equity | `chapter` | 2 | Outcome KPIs, equity-build chart, ending table, cash-position chart |
| What this assumes | `chapter` | 1 | Assumptions, notes, the projection caveat |
| Contact & disclaimer | `closing` | 1 | The tenant's company block |

The `assumptions` section appears only when there is something to say; the spine
validator would otherwise fail a document that claimed a section it did not have.

### Why the matrix is two tables

Fourteen lines is **one row more than a landscape page holds**. The first render
of this document put "After tax, per week" alone on a page of its own. Splitting
by what the rows are about — the position, then the cash flow — fits, and reads
better than the fourteen-row wall: the two groups answer different questions and a
reader was already scanning for the boundary between them.

That split then exposed a second defect in the shared stylesheet: `page:` only
forces a break when the page **name** changes, so two adjacent
`.page-landscape-table` sections ran together. `css.pure.ts` now emits
`.page-<name> + .page-<name> { break-before: page; }` for every named page,
generated from the same table as the rest of the page rules.

---

## 3. The charts

Two, and only two. The projection table already states every figure; a chart earns
its page only by answering something the table answers slowly.

- **Equity build** — a stacked column per year. Reading value-against-debt off the
  table means tracking two columns down ten rows and subtracting each pair.
  Stacked rather than paired because the two parts *sum* to the property's value:
  a stack says "the same thing divided", paired bars say "two things compared".
- **Cash position** — horizontal bars of after-tax cash flow, each with its figure
  printed beside it, so the chart still reads in monochrome and to a reader who
  cannot separate the two hues.

Neither is load-bearing: both return `''` when the data is absent or degenerate,
and the section prints its table either way.

The debt segment uses `withAlpha(ink, 0.22)`, not `groundAlt`. `groundAlt` is a
page tint — at column size it disappears against paper, and the first render read
as plain bars growing rather than as a value being split.

---

## 4. Two modules that moved

`measure.pure.ts` and `brand.pure.ts` were written for the Snapshot and neither is
about borrowing capacity:

- A `Measure` is the design system's vocabulary. This format needs the same
  `$1,240/mo` against `$14,880 pa` distinction, and a second implementation would
  be a second set of rounding rules on the same client's money. Now
  `reportDesign/measure.pure.ts`.
- `resolveSnapshotBrand` reads a brand snapshot and returns a palette, a company
  block, a masthead and a lockup — none of which know what document they are
  about. Now `reportDesign/documentBrand.pure.ts`.

Both had to move: `cashFlowSourceOfTruth.spec.ts` (like its Borrowing Capacity
twin) forbids a format module from importing anything but its siblings and
`../../reportDesign/*.pure.ts`, because Edge Functions resolve relative `.ts`
paths and nothing more.

`aud/week` is new. The headline of this report is what a property costs a week,
and the legacy generator prints that figure beside an annual one with nothing to
tell them apart.

---

## 5. The render path

`supabase/functions/render-cash-flow-pdf/index.ts`

1. **Auth is a human, then a permission.** `verifyAuthOrNativeUser` establishes
   identity — the service-role identity is refused because it is not a person —
   and `requireModulePermission(reports, can_view)` establishes the right. That is
   the same gate `render-investment-report-pdf` applies to the same report.
2. **The address and the client name are read, not accepted.** A name the caller
   supplies is a name the caller can change, and the address on a financial
   projection is not a display preference.
3. **The brand is snapshotted, then referenced.** `upsert_report_brand_snapshot`
   dedupes by content fingerprint, so re-rendering an unchanged brand reuses the
   row.
4. **Resources are checked before the POST.** `assertSafeRenderResources` runs on
   HTML this function built, because the assets in it came from a tenant's
   settings form — the guard belongs on the boundary, not on the trust.
5. **There is no fallback.** If WeasyPrint fails, this fails. A silent downgrade
   ships a client a document nobody approved.
6. **Every attempt leaves a row** in `cash_flow_renders`, which is the difference
   between "the client says the PDF never arrived" and an answer.

The projection itself is deliberately **not** stored: `cash_flow_analyses.analysis_data`
already holds the saved form, and a second copy would be a second answer to "what
did this report say".

### The filename

`Cash_Flow_Analysis_<Address>_<YYYY-MM-DD>.pdf`. The `[^a-zA-Z0-9]` → `_` rule is
the existing one from `CashFlowAnalysisModal`, kept exactly; the date is appended
so a client who receives two revisions of the same property can tell them apart.

---

## 6. The legacy generators stay

Explicitly, and under test. `render.spec.ts` asserts that
`exportSingleReportPDF`, `exportComparisonPDF`, `exportAiAnalysisPDF` and
`handleExportExcel` are all still present in `CashFlowAnalysisModal`, that it
still imports jsPDF, and that the legacy item is still in the export menu.

The comparison PDF and the AI analysis PDF are **not** migrated. They are
derivative documents built from the same modal, and neither is the artefact the
business sends. If they are migrated later, they get their own archetypes rather
than being bolted onto this one.

---

## 7. Deployment

`render-cash-flow-pdf` must be deployed and
`supabase/migrations/20260815000000_cash_flow_render_path.sql` applied before the
menu item does anything. Until then `requestCashFlowPdf` falls back to
`exportSingleReportPDF` and says so — on a missing *function* only, never on a
400 or a 500, because falling back on a real failure would hand a client a
document produced by the generator this format exists to replace while telling
nobody.
