# The render boundary

*Why every design-system document came out in the legacy layout, and what the
rule is now.*

## What was measured

On 14 August 2026 a person chose a template for the 10 Year Cash Flow, the
picker said the choice was kept, and every download came out of the standard
composer. The evidence, in order of how decisive it was:

| Source | Reading |
| --- | --- |
| `activity_logs` (`report_pdf_downloaded`, 14 Aug) | 10 of 10 rows carry `metadata->>'source' = 'cash_flow_server'`. **Zero** have ever carried `cash_flow_template`. |
| `template_render_jobs` | 79 rows, newest **11 August**. Nothing since. |
| `template_events` | newest `render_success` 11 August; newest `render_failed` **6 August**. |
| `report_templates` | 11 active rows, `cashflow` has two, both `weasyprint`. |
| `report_template_selections` | the selection exists, is active, and names a `cashflow` template. |

So a file *was* produced on every attempt — the composer's — and the templated
one was never even attempted as far as any ledger could tell. `render-template-pdf`
writes its `template_render_jobs` row **before** it calls WeasyPrint, so an
absent row proves the renderer was never reached.

## The cause

`render-template-pdf` runs `assertSafeRenderResources` over the HTML before it
invokes the engine. That gate is an SSRF boundary and it admits exactly two
things: `data:` payloads, and objects under this project's own Supabase storage
origin. Everything else throws.

All 500 Investment Compass masters declare their typefaces as
`tokens.fontFaces` entries carrying a Google Fonts `cssUrl` — **2,838
references across the seed migrations** — because that is how a template names
a webfont for the *browser*. `tokensToFontFaceCss` emitted each as
`@import url('https://fonts.googleapis.com/…')`, and one is enough to fail a
document.

Reproduced locally against the production bytes, the chain was:

```
parseTemplate        ✓ 11 pages, 84 blocks
productionTemplateGuard ✓
renderTemplateToHtml ✓ 73,722 bytes, 0 unresolved bindings
assertSafeRenderResources ✗ Remote render resources must be normalized …
```

A document that was completely correct, refused on its last step.

## Why nothing said so

Three separate silences stacked:

1. **The gate ran before `templateId` was read**, and before the job row was
   inserted. The `template_events` failure insert is guarded on `templateId`.
   So a refused render wrote *nothing* — the ledger and the analytics table
   both read exactly as though nobody had asked for a render.
2. **The error named no URL.** "Remote render resources must be normalized into
   project storage" is true of a stray import, an un-normalised logo and a font
   stylesheet alike; the module's own comments record two earlier debugging
   sessions lost to that.
3. **The route's fallback is by design.** Every failure in
   `routeReportThroughTemplate` is a fallback rather than an error, because a
   templated document is an improvement on a working path. On the migrated
   formats the legacy generator is itself a well-typeset WeasyPrint document,
   so "your template rendered" and "your template was skipped" produced
   visually similar files.

## The rule

**For print, the container is the font source.** The image installs its faces
(`weasyprint-service/Dockerfile`), `typography.pure.ts` is the contract for what
it has, and a printed document names a family which fontconfig resolves with no
network involved. That is already how the ten legacy report formats set type,
and it is why they render while the design system did not.

Three things enforce it:

- `renderTemplateToHtml` takes `fontSource: 'remote' | 'container'`. Under
  `'container'` no remote stylesheet link and no remote `@font-face src` is
  emitted. A `data:` src — the embedded faces a PDF import produces — still is,
  because it travels with the HTML.
- `compileTemplateHtmlForPdf` **forces** it. It is documented as the one way to
  turn a template into HTML for the server-side renderer, for exactly this class
  of omission, and there is no PDF render for which `'remote'` is correct. The
  production route had its own hand-rolled copy of the compile step and so
  inherited none of that; it now goes through the compiler.
- A family the image lacks is **substituted explicitly**
  (`printFontPolicy.pure.ts`) rather than left to fontconfig. Dropping the link
  and saying nothing would set the page in the engine's default with no warning
  from anything, which is the failure the Dockerfile's own font contract exists
  to prevent. Two rows today: Fraunces → Playfair Display, Public Sans → Inter.
  The substitution applies to the **preview as well**, so what a designer sees
  is what prints.

## Two rules that will bite

**A substitution is a stopgap, not a design decision.** Ship the real face — a
Debian binary package in the Dockerfile's `apt-get`, or a TTF in
`weasyprint-service/fonts/` with its OFL — add it to `CONTAINER_FONT_PACKAGES`
or `CONTAINER_FONT_FILES`, and delete the row. Verify a Debian package against
`dists/<release>/main/binary-amd64/Packages.gz` and never against
packages.debian.org, which serves pages for source package names too; that is
how `fonts-ibm-plex` got into the list and broke the image build.

**A measure taken against a fixture cannot see this class of defect.** Every
other check in this programme — the ink floor, the critique rubric, the golden
diff, PDF/UA validation — runs on a template written in the harness, and a
harness template has no Google Fonts URL. `printFontPolicy.spec.ts` renders and
then puts the result through the *real* gate;
`productionMasterRenderBoundary.spec.ts` does it with the seeded master the
production selection actually points at. `docs/reports/COVERAGE.md` makes this
point about content bindings, and it is just as true of the boundary.

## Where the pieces are

| Concern | Module |
| --- | --- |
| The boundary itself | `supabase/functions/_shared/renderResourcePolicy.pure.ts` |
| What the image installs | `supabase/functions/_shared/reportDesign/typography.pure.ts` |
| Substitutions and stack rewriting | `supabase/functions/_shared/reportDesign/printFontPolicy.pure.ts` |
| Emission | `src/lib/reportTemplate/cssTokens.ts` (`tokensToFontFaceCss`) |
| The one PDF compiler | `src/lib/reportTemplate/compileTemplateForPdf.ts` |
| The production route | `src/lib/reportTemplate/routeReportThroughTemplate.ts` |
| Ledger and error text | `supabase/functions/render-template-pdf/index.ts` |
