# Coverage — how many real documents the design system actually renders

This is the number the report programme did not have, and its absence is why
months of work were invisible. Everything else in `docs/reports/` measures
whether the design system is *correct*. This measures whether it is *used*.

**Run it before believing any other report metric.**

## The number, 2026-08-06

| format | documents | via design system | coverage |
| --- | ---: | ---: | ---: |
| investment | 1,162 | 0 | **0.00%** |
| report_qa | 251 | 1 | **0.40%** |
| portfolio | 21 | 1 | **4.76%** |
| market_intelligence | 6 | 0 | **0.00%** |
| **total** | **1,440** | **2** | **0.14%** |

Every `*_renders` ledger combined holds **nine rows**, all of them the same test
client across four days in August — they are engineering's, not the product's.

Meanwhile `investment_reports` grows 5–18 a week, continuously, and
`report_generation_runs` stands at 1,317.

## What that means, and what it does not

It does **not** mean the render routes are broken or undeployed. All thirteen
are deployed and current, `WEASYPRINT_SERVICE_URL`/`_TOKEN` are set and working
(proved by `render-borrowing-capacity-pdf`, which has no fallback and refuses to
run unconfigured — and which succeeded), and the container serves them.

It means **almost nothing calls them**. Four mechanisms route around the design
system, none of which is visible to the person clicking the button:

1. **The legacy control carries the plain-English label.** On Cash Flow
   Comparison, Market Intelligence and Client Details the legacy button says
   *"Export PDF"* / *"Download PDF"* / *"Download Client Details PDF"*; the
   design-system button beside it says *"Typeset"* or is an unlabelled icon.
2. **`report_templates.engine`** — 80 rows are `jspdf`, 1 is `weasyprint`.
   `routeReportThroughTemplate.ts` skips the design system unless a row says
   `weasyprint`, and `resolveTemplate.ts` defaults NULL to `jspdf`. No admin UI
   sets this column.
3. **`tryRouteThroughTemplateBuilder` returns `null` on four silent paths** —
   wrong engine, report type not `investment_compass`, a failed
   `render-template-pdf`, or any thrown exception — each falling through to the
   old renderer with nothing shown to the user.
4. **Six surfaces have no server route at all**: `ReportViewer.tsx`,
   `InvestmentReportModal.tsx`, `EnhancedInvestmentReportModal.tsx`,
   `ClientPortfolioActions.tsx`, the Formara download in `ClientDetailsModal.tsx`,
   and every `FlattenPdfIconButton`.

And one contradiction worth naming on its own: the same Compass report
downloaded from the report viewer routes through the Template Builder, and
downloaded from the client's Reports tab does not (`ClientReportsTab.tsx:517`).

**The Investment report specifically** is rendered by WeasyPrint already — but by
`render-investment-report-pdf`'s own inline `THEME` and HTML, which predate the
design system and import none of it. Right engine, old document.
`renderInvestmentFromBrand` is complete, tested, written against the real row
shape, and has **zero callers**.

## The query

Run in the Supabase SQL editor. It needs no schema change.

```sql
WITH src AS (
  SELECT 'investment'         AS fmt, count(*) AS documents FROM investment_reports WHERE status='completed'
  UNION ALL SELECT 'portfolio',           count(*) FROM portfolio_analysis_reports
  UNION ALL SELECT 'market_intelligence', count(*) FROM marketing_intelligence_reports
  UNION ALL SELECT 'report_qa',           count(*) FROM report_qa_conversations
), ds AS (
  SELECT 'investment'         AS fmt, count(*) AS design_system FROM investment_report_renders
  UNION ALL SELECT 'portfolio',           count(*) FROM portfolio_review_renders
  UNION ALL SELECT 'market_intelligence', count(*) FROM market_intelligence_renders
  UNION ALL SELECT 'report_qa',           count(*) FROM report_qa_renders
)
SELECT src.fmt, src.documents, ds.design_system,
       round(100.0 * ds.design_system / NULLIF(src.documents,0), 2) AS pct
FROM src JOIN ds USING (fmt) ORDER BY src.documents DESC;
```

Every ledger at a glance:

```sql
SELECT 'borrowing_capacity' t, count(*) FROM borrowing_capacity_renders
UNION ALL SELECT 'cash_flow',            count(*) FROM cash_flow_renders
UNION ALL SELECT 'cash_flow_comparison', count(*) FROM cash_flow_comparison_renders
UNION ALL SELECT 'client_details',       count(*) FROM client_details_renders
UNION ALL SELECT 'investment',           count(*) FROM investment_report_renders
UNION ALL SELECT 'market_intelligence',  count(*) FROM market_intelligence_renders
UNION ALL SELECT 'portfolio',            count(*) FROM portfolio_review_renders
UNION ALL SELECT 'property_comparison',  count(*) FROM property_comparison_renders
UNION ALL SELECT 'report_qa',            count(*) FROM report_qa_renders
ORDER BY 2 DESC;
```

## The limit of this measure, stated plainly

The numerator is exact — the render routes write a ledger row before they
render, so a design-system document cannot escape being counted. **The
denominator is a proxy**, because the legacy generators run in the browser and
record nothing at all. A client who downloads the same report four times shows
as one document.

So the real coverage is *lower* than the figure above, not higher. Closing that
gap needs a `report_render_events` row written by the legacy paths too, which is
the one schema change worth making here.

## Why this file exists

Every other measurement in this programme — the ink floor, the critique rubric,
the golden diff, PDF/UA validation — was taken against **fixtures written by the
people doing the work**, rendered in a harness, and never against a document a
client received. All of them passed. None of them could see that the pipeline
they were grading carried 0.14% of the traffic.

A correctness measure cannot detect an unused system. Check coverage first.
