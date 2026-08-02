# Report design system — the contract

How generated reports get their colour, type, structure and branding, and where
that will live. This is the architecture doc for the report-rendering programme;
the brand rules themselves are in the
[`npc-services-design`](../../.claude/skills/npc-services-design/) skill.

**Status:** Phase 0 (this document + the skill), Phase 1 (the Kit foundation),
Phase 2 (stylesheet, primitives, document spine), Phase 3 (brand, logo and
snapshotting) and **Phase 4 (fonts and the render container)** delivered. Charts
and the per-format migrations are next; no shipping render path has been
switched over yet.
Scope is the report/PDF layer. The Template Library catalogue and the Template
Builder editor are out of scope, but the shared **block renderers** in
`src/lib/reportTemplate/blocks/*.html.ts` are in scope as reusable infrastructure.

---

## 1 · Why

Reports are the artefact clients actually receive. Today they do not look like one
product.

| | Measured |
| --- | --- |
| PDF engines in use | **4** — WeasyPrint (server), pdf-lib (Deno), pdf-lib (browser), jsPDF (browser) |
| Client-side generation code | ~31,000 lines |
| Server-side | ~6,200 lines |
| Orphaned / unreachable | ~2,600 lines orphaned, plus ~1,400 unreachable in `useReportGenerator.tsx` (returns at :698) |
| Distinct hardcoded "brand golds" | **8** — see §2 |
| `setFont('helvetica')` calls | **599** |
| Reports embedding a logo | **0** |
| Golden / fidelity tests on shipping PDF paths | **0** |

## 2 · The eight golds

None of these is `--brand` (`43 74% 49%` → `#D9A521`).

| Hex | Where |
| --- | --- |
| `#BF9B50` | `src/utils/pdfDisclaimerPage.ts:19`, `MarketIntelligencePDFGenerator.ts:14`, `OverviewSnapshotPDF.ts:13`, `blocks/charts.html.ts` default |
| `#D4A843` | `render-investment-report-pdf/report.brand.ts:14` **and** `index.ts` `THEME` |
| `#B8902F` | `render-investment-report-pdf/index.ts` `THEME` |
| `#B9923E`, `#8B6B23` | `index.ts` `DESIGN_PALETTES` (`editorial_navy` preset) |
| `#ca8a04` | `CashFlowAnalysisModal.tsx:2424` |
| `#c9a55a` | `BorrowingCapacityPDFReport.tsx:243` |
| `#D4A017`, `#c9a227` | the app (White-Label default accent, legacy) |

## 3 · Two corrections to the obvious plan

Both were verified before writing this, and both change the shape of the work.

### 3.1 The editorial track is a prototype, not the live renderer

`render-investment-report-pdf/report.brand.ts`, `report.css.ts` and `report.html.ts`
are a well-designed brand-token module, print stylesheet and HTML primitive library
— and **nothing imports them.** `index.ts` imports only `createClient`, `marked`,
`auth`, `authz`, `csrfGuard`, `storageSign` and `markdownSafety`, and carries its
own inline `THEME` and `DESIGN_PALETTES`.

So they are the right *seed*, but adopting them is a **rewire of a live 5,580-line
function**, not "reuse what is already running". Sequence that rewire as
substitution-only — tokens and CSS swapped, markup untouched — so any visual diff is
attributable to the token change alone.

### 3.2 Single-source the modules; do not mirror them

Edge functions cannot import from `src/`. But **`src/` can import from
`supabase/functions/_shared/`**, and five production modules already do it with a
one-line re-export bridge:

```ts
// src/lib/reportTemplate/pdfImport/typographyFidelity.pure.ts — the entire file
export * from '../../../../supabase/functions/_shared/typographyFidelity.pure.ts';
```

Vite resolves the explicit `.ts`, Deno reads it natively, Vitest imports it
directly. This is strictly better than the mirroring used by
`compassSectionRegistry.ts` — which is exactly why those two copies have **already
drifted to 672 lines edge-side versus 174 in `src/`**, despite
`docs/COMPASS_40_PAGE_ARCHITECTURE.md` stating they "must stay in sync".

**Rule for this programme:** canonical `.pure.ts` in
`supabase/functions/_shared/reportDesign/`, one-line `export *` bridges in
`src/lib/reportDesign/`, and a test asserting every bridge file is *only* a
re-export and that the two directories are 1:1. Mirroring plus a parity test is the
fallback for cases where sharing is genuinely impossible — for this work, there are
none.

## 4 · Target module layout

```
supabase/functions/_shared/reportDesign/     ← canonical, pure TS
  color.pure.ts        ✅ hex/HSL conversion, contrast, ensureContrast()
  tokens.pure.ts       ✅ GENERATED from tokens.css — surfaces, ink, semantics, scale
  roles.pure.ts        ✅ role union, INK_LEGALITY, ResolvedReportPalette
  brandResolve.pure.ts ✅ resolveReportPalette(), auditPaletteContrast()
  typography.pure.ts   ✅ print stacks, CONTAINER_INSTALLED_FAMILIES, missingFamilies()
  page.pure.ts         ✅ page geometry + the seven named pages
  options.pure.ts      ✅ ReportDesignOptions, density metrics, clamping
  css.pure.ts          ✅ buildReportCss({palette, options, masthead})
  primitives.pure.ts   ✅ cover, chapter, KPI strip, table, callout, company page…
  companyBlock.pure.ts ✅ contact/disclaimer shaping shared by all three renderers
  structure.pure.ts    ✅ REPORT_ARCHETYPES, buildSpine(), validateSpine()
  assets.pure.ts       ✅ inline policy, slot fallback chains, budget
  snapshot.pure.ts     ✅ ReportBrandSnapshot, fingerprint, palette/contact adapters
  defaultAssets.generated.ts ✅ GENERATED — the house cover art and mark, inlined
  charts.pure.ts       ⬜ SVG chart geometry

src/lib/reportDesign/<same names>.pure.ts    ← one-line export * bridges
src/lib/reportDesign/__tests__/designSystemSourceOfTruth.spec.ts
src/lib/reportDesign/__tests__/printContrast.spec.ts
src/lib/reportDesign/__tests__/reportSourceHygiene.spec.ts   ← no literals, no "NPC"
src/lib/reportDesign/__tests__/reportCss.spec.ts             ← print legality
src/lib/reportDesign/__tests__/reportPrimitives.spec.ts      ← escaping + contract
src/lib/reportDesign/__tests__/reportStructure.spec.ts       ← spine validation
src/lib/reportDesign/__tests__/reportTypography.spec.ts       ← the Dockerfile contract
src/lib/reportDesign/__tests__/reportAssets.spec.ts           ← inline policy
src/lib/reportDesign/__tests__/reportSnapshot.spec.ts         ← fingerprint coverage
src/branding/__tests__/brandAssetSlots.spec.ts                ← the two resolvers agree
scripts/reportDesign/buildTokens.ts          ← the generator (+ `--check` for CI)
scripts/reportDesign/buildDefaultAssets.ts   ← asset inliner (+ `--check` for CI)
scripts/reportDesign/buildSpecimen.ts        ← `npm run reportkit:specimen`
supabase/migrations/20260813000000_report_brand_snapshots.sql
weasyprint-service/fonts/                    ← the two brand faces + OFL licences
```

`premiumPdfDesign.ts` (the design panel's option contract) and
`src/utils/pdfDisclaimerPage.ts` (the jsPDF and pdf-lib closing pages) are now
adapters over these modules rather than second definitions.

`src/branding/color-utils.ts` is now a bridge onto `color.pure.ts` rather than a
second implementation of the same ten functions.

CI gates added: `npm run reportkit:tokens:check` (token drift),
`npx vitest run src/lib/reportDesign` (bridge purity + contrast), and
`deno check supabase/functions/_shared/reportDesign/*.pure.ts` (the modules must
resolve in the runtime that actually renders).

`src/branding/brandPalette.ts` becomes a deprecated adapter over
`resolveReportPalette` so its consumers keep compiling during migration, then is
deleted.

## 5 · Token derivation

`tokens.pure.ts` states every print value **as a derivation of** a
`src/styles/tokens.css` variable, with the reason inline. The adjustments are real
and non-obvious:

- **Paper is `#FAF7EF`, not white** — `--background`, derived, not the `#FAF7F1`
  the dead prototype invented. Panels are *darker* than the sheet, inverting the
  screen relationship.
- **Contrast floors by size** (see the skill's `reports/REPORT_RULES.md` §2).
  `--brand` on ivory is 2.10:1 and fails at the 8.5pt eyebrow — the single most
  important adjustment, and the reason eight golds exist.
- **Category B darkens, never brand-derives.** `PRINT_SEMANTIC` is frozen and
  `resolveReportPalette` accepts no override for it, so tenant leakage is a type
  error rather than a code-review question.
- **Screen-only constructs are dropped, not translated** — gradient text,
  `box-shadow`, blur, motion.

The colour-format chain (`H S% L%` → hex → pdf-lib 0–1 floats) collapses to one
conversion at snapshot time; downstream everything is `#RRGGBB`.

### What the derivation actually found (Phase 1)

- **The NPC gold is a dark-ground colour.** `--brand` is **7.26:1 on obsidian**
  and **2.10:1 on ivory**. It fails at every size on paper, including the 8.5pt
  eyebrow that is the brand's own signature. On the cover it needs no help at
  all; on paper it steps down the ramp. That asymmetry — not carelessness — is
  why eight golds accumulated: each was someone solving the paper case locally.
- **The step is `--brand-800` (`#8E6C15`, 4.56:1).** `ensureContrast()` and the
  `--brand-*` ramp arrive at the same value independently, so the derived colour
  is one the design system already names.
- **A uniform lightness does not work for Category B.** At 33% L the warning
  gold is 4.35:1 and fails, while the success green passes comfortably —
  contrast is a function of hue, not lightness alone. Each semantic is therefore
  darkened until it clears the floor against the *darkest* stock any preset can
  put it on.
- **The floor is 4.5:1, not 7:1.** Body copy is graphite at **13.22:1** and
  clears AAA regardless; the floor only ever binds on accent type, which is
  short, bold and letterspaced. Forcing AAA there turns the brand gold brown.
- **`accentOnPaper` must be derived against the worst paper ground, not the
  default one.** Under `minimal_ink` the `paper` role is porcelain while
  `paperAlt` is champagne; deriving against `paper` alone shipped a palette that
  was legible on one ground and not the other. The contrast test caught it.

## 6 · Brand, logo and snapshotting

Resolution order: NPC defaults → `whitelabel_settings` → `global_report_settings`.
Today `render-investment-report-pdf` reads only the third, so **tenant brand colour
never reaches a PDF** — that is the gap.

Needs adding:

- a **`report` logo slot** (and a reversed `report-mono`) on `logo_config`; today
  the slots are `auth | sidebar | sidebar-icon | favicon`
- an **ABN** on the snapshot — `client_fact_find_brand_snapshots` has no ABN field
  and only `global_report_settings.contact_details` carries one
- a `report_brand_snapshots` table modelled on `client_fact_find_brand_snapshots`,
  referenced `ON DELETE RESTRICT`

Assets inline as base64 `data:` URIs. `weasyprint-service/app.py` permits `data:`
explicitly and bypasses its SSRF guard for it, under a 25 MB HTML cap. Inlining
makes renders reproducible and network-free, and PDF/A-2b — the variant the code
already requests — forbids unresolved external references. It also unblocks local
development, where the SSRF guard rejects `localhost` asset URLs outright.

This retires the hardcoded `lovable.app` cover URL in `index.ts:3078`.

### What Phase 3 delivered

- **`report` and `report-mono` logo slots** in `logo_config`, wired through
  `BrandLogoConfig` → `BrandProvider` → `getBrandAssetSrc` → the White Label page.
  Additive: no `theme_version` gate, so a tenant on version 1 keeps saving.
- **`resolveReportAsset()`** — the fallback chain `report → sidebar → auth →
  sidebarIcon`, with the inline policy enforced at each step. A key that fails
  policy does not stop the walk, so a tenant whose report mark is a 12 MB PNG
  still gets their sidebar logo rather than a blank space, and the skip is
  reported with a reason.
- **`report_brand_snapshots`** (migration `20260813000000`) — deduplicated by
  content fingerprint rather than one row per artefact, with
  `investment_reports.brand_snapshot_id … ON DELETE RESTRICT`. The upsert is a
  single `ON CONFLICT` statement because read-then-write races two concurrent
  renders of the same brand.
- **The `lovable.app` cover URL is gone.** `render-investment-report-pdf` now
  imports the same JPEG as an inlined `data:` URI. Same pixels, no outbound
  fetch, no dependence on a preview host still serving that path.
- **A generated report carries a logo for the first time.** `lockupFor()` puts
  the mark on the cover and the closing page; verified in a real render.

### The finding that changes the migration plan

`public/templates/npc-portfolio-cover-new.jpg` — the cover art the live
investment report has always used — **is not a photograph.** It is a finished
NPC cover with *"NAIDU PROPERTY CONSULTING SERVICES"*, the tagline and the
monogram burned into the pixels. Rendering the new cover over it produces two
company names and two marks on one page.

This is the same class of problem as the `public/icons/*` files (email-signature
banners carrying the director's mobile number). The consequence for the
migration phases: **no legacy cover asset can become a white-label default**, and
any format still using one needs replacement artwork before it can be re-skinned.
`NPC_HOUSE_COVER_ART` is named to make misuse obvious, and
`reportSourceHygiene.spec.ts` fails if any design module imports the asset file
at all.

## 7 · Charts

`src/lib/reportTemplate/blocks/charts.html.ts` already emits inline SVG for bar,
line, area, pie, donut, scatter, radar, sparkline and heatmap, is WeasyPrint-targeted
by design, and is security-tested against colour injection. The premium track adds
17 more bespoke renderers inside `index.ts`.

**Reuse both; do not write a third chart engine.** Extract the geometry into
`charts.pure.ts` with plain signatures and leave the existing renderers as thin
adapters, keeping the sanitisation where its test targets it.

`src/components/charts/useChartExport.tsx` (html2canvas) stays — it is the on-screen
"download this chart" feature — but leaves every *report* path, because
html2canvas cannot run server-side.

### What Phase 4 found and fixed

The font contract in `typography.pure.ts` described itself as "a contract with
`weasyprint-service/Dockerfile`". Nothing checked it, and it was wrong in a way
that had a much larger consequence than bad typography.

**The image could not be built.** The Dockerfile installed
`fonts-playfair-display`, `fonts-cormorant-garamond` and `fonts-fraunces`. None
of the three exists in Debian — verified against both bookworm and trixie.
`apt-get install -y` exits non-zero on an unknown package, so that `RUN` layer
failed and the build aborted. Whatever image is serving Cloud Run today was not
built from this Dockerfile.

That also explains the one typographic defect visible in the Phase 2 render: the
accent stack led with Cormorant Garamond, which was never installed, so every
standfirst and dek fell through to the engine's default serif and was *not
italic at all*.

| Fixed | How |
|---|---|
| Three non-existent packages | Removed. Playfair Display now arrives as a COPY-ed TTF. |
| Cinzel absent | `weasyprint-service/fonts/Cinzel-Bold.ttf`, extracted from the repo's own `Cinzel_Playfair_Display.zip` with its OFL licence. |
| No italic for the accent role | `PlayfairDisplay-MediumItalic.ttf`. Without a real italic the engine synthesises a slant, which on a high-contrast didone reads as a printing fault. |
| Two serif families where the second never loaded | The accent role is now the *same* family as display, set in italic. One editorial serif used two ways is a system; two where the second is missing is a bug. |
| Unpinned base image | `python:3.12-slim-bookworm`. A font-package contract is only checkable against a known release, and `-slim` moves distribution when the tag is rebuilt. |
| Stale service README | It claimed a Api2PDF fallback on WeasyPrint failure. `index.ts:5567` re-throws — deliberately. The service is critical infrastructure and the README now says so. |

Three new gates, because a font failure is uniquely invisible — the engine
substitutes silently, the PDF renders, every test passes:

1. `reportTypography.spec.ts` reads the Dockerfile and fails if the packages, the
   COPY-ed files, `CONTAINER_INSTALLED_FAMILIES` and the type stacks disagree —
   including a named regression check for the three phantom packages.
2. The Dockerfile's own `fc-cache` layer asserts each brand family resolves, so a
   missing face breaks the build rather than the document.
3. CI builds the image, checks `fc-list` inside it, renders a smoke document
   through the service and asserts with `pdffonts` that Cinzel, Playfair and
   Inter are **embedded** — a substituted face still produces a valid PDF.

Fonts are also now verified in the specimen: the render in §9 was produced with
the real faces installed, which closes the caveat recorded there.

## 8 · Two migration targets

Not every report can move server-side. `CashFlowAnalysisModal` computes its three
PDFs from live form state; there is no row for a server to read.

| Target | For | Path |
| --- | --- | --- |
| **A** — server-side | data already persisted: investment, market intelligence, portfolio, borrowing capacity | edge function reads the row → builds HTML → WeasyPrint |
| **B** — client-side HTML | data that exists only in browser state: cash flow, Formara, Q&A | client imports the same design system via the bridge → POSTs HTML to `render-template-pdf` |

Target B is already in production for Compass via
`routeReportThroughTemplate.ts` → `render-template-pdf`, with auth, resource-safety
(`assertSafeRenderResources`), upload and an audit row all solved. Both targets share
one design system, so brand consistency does not depend on which one a format uses.

## 9 · Verification

- **Bridge purity + 1:1 directory parity** — every `src/lib/reportDesign/` file must
  be only an `export *`.
- **Contrast** — every colour role × every legal ground, against the §5 floors.
- **Golden PDFs** — build the WeasyPrint container, render fixtures, rasterise,
  pixel-diff. Fixtures must inline every asset, because the SSRF guard rejects
  non-global hosts — which is also the production policy, so the goldens exercise
  the real path. **This will be the first fidelity coverage any shipping PDF path
  has had.**
- **Brand-drift ratchet** — clone `scripts/audit-style-tokens.cjs`: count `helvetica`
  calls, jsPDF/pdf-lib/html2canvas imports, the eight golds, and `lovable.app` under
  `supabase/functions/`; fail on any increase.
- **Structure QA** — extend `compassQAValidator.ts` to every format.
- **Edge tests must actually run.** `vitest.config.ts` includes only
  `src/**/*.{test,spec}.{ts,tsx}`, so every `supabase/functions/**/*.test.ts` —
  including `render-investment-report-pdf/security-contract.test.ts` — never
  executes in CI.

### What the first real render found (Phase 2)

`npm run reportkit:specimen` builds a document that exercises every primitive;
rendering it through WeasyPrint and rasterising the pages found six defects that
no amount of reading the CSS would have. All six are fixed, and each one is now
either impossible by construction or asserted by a test.

| Defect | Cause | Fix |
|---|---|---|
| No running head on any continuation page of a chapter | `page: chapter-opener` applies to **every** page an element spans, not its first | The low title is `padding-top` on `.chapter`; `openChapter()` defaults to the `body` page |
| Table caption stranded on the previous page | A `<caption>` is a separate box; `page-break-inside: avoid` on the table does not cover it | `renderDataTable` wraps table + caption in `.table-block` |
| A pale stripe down the left of every banded row | The first cell is `<th scope="row">` for the tagged-PDF structure tree, and the band selector named only `td` | Cell selectors hoisted to constants that name both, so a variant cannot forget one |
| Contact block ran off the right edge of the closing page | `.company-page` is 210mm **plus** 22mm padding on a zero-margin page | `box-sizing: border-box` on every full-bleed block |
| Running foot wrapped to two lines | The `@bottom-left` box is a third of the measure; company + document name does not fit in letterspaced mono | `mastheadFor()` returns the company name alone; the document name lives on the cover, in the PDF title and in the running head |
| The drop cap printed on top of the words it opened | WeasyPrint places a floated `::first-letter` but does not shorten the first line box around it | Ships a raised initial instead; `reportCss.spec.ts` fails on `float: left` |

One caveat on that render, stated because it bounds what it proves: it was
produced by WeasyPrint 69 on this workspace, not by the container
(`weasyprint-service` pins 62.3). **Phase 4 closed the font half of this
caveat** — the faces are now installed and the specimen re-rendered with Inter,
Playfair Display (upright and italic), Cinzel and IBM Plex Mono. What remains
unverified is engine-version parity, which needs the container itself.

The specimen is also the re-skin proof: the same content rendered with
`--preset=minimal_ink --brand='#00A3FF' --density=compact --table=ledger
--chapter=opener_band` changes stock, rhythm, rules and every brand mark, while
the negative figures stay the one red and the positives the one green.

## 10 · Known hazards

1. ~~**Cinzel is not in the render container.**~~ **Resolved in Phase 4.** Cinzel
   and Playfair Display (upright *and* italic) are `COPY`-ed from
   `weasyprint-service/fonts/` and `fc-cache`-d, the build fails if either
   family fails to resolve, and CI builds the image and asserts the faces embed
   in a rendered PDF. **The container must be redeployed** before any report set
   in Cinzel ships — the image on Cloud Run predates this change.
2. **Signed-URL TTLs are inconsistent and long** — 7 days in
   `render-investment-report-pdf:5447`, 24h in `render-template-pdf`, against a
   15-minute ceiling that `secure-storage` enforces on client-originated requests.
   Migrating volume onto these paths multiplies the exposure. Unify before the
   first format migration.
3. **WeasyPrint hard-fails.** Contrary to `weasyprint-service/README.md`, the
   Api2PDF fallback is disabled when WeasyPrint is configured, so a render failure
   is user-visible. The README is stale.
4. **PDF/A + tagged output** constrain markup: heading levels must be semantically
   correct, and external references are forbidden.
5. **Three divergent `InvestmentReport` types** bridged by a hand-maintained
   `overrideMapping` table. The system needs one payload contract or it inherits
   the drift.
6. **Most brand artwork in the repo is unusable in a client PDF.** The cover
   JPEGs carry NPC's company name and tagline in their pixels; every
   `public/icons/*` file is an email-signature banner with the director's mobile
   number. The monogram at `public/images/npc-logo-monogram.png` is the only
   clean mark. A white-label rollout needs artwork, not just plumbing.
7. **Server-side generation changes delivery** — a Blob download becomes an
   authenticated invocation plus a storage object plus a signed URL, with Cloud Run
   cold-start latency. The UI needs progress states.
