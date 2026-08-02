# Borrowing Capacity Snapshot — the format's contract

The Snapshot is the document a client is handed when they ask *"how much can I
borrow?"*. It is the most-generated report in the product and the least
governed: five separate PDF implementations draw parts of it, three of them
carrying their own copy of the same untyped adapter, and none of them has ever
had a test.

This is the contract for the migration described in
[`DESIGN_SYSTEM.md`](./DESIGN_SYSTEM.md). It starts as the Phase 0 output —
what the format does *today*, in numbers rather than impressions — and each
later phase adds what it settled and corrects what the previous ones got wrong.

Everything below was read from the source or measured from a captured PDF. Where
a claim comes from a rendered page, the page is named.

---

## 1. The five implementations

| | Path | Lines | Engine | Status |
|---|---|---|---|---|
| **A** | `src/components/borrowing-capacity/BorrowingCapacityPDFReport.tsx` | 1325 | jsPDF | **This is the Snapshot.** Live, 4 call sites |
| **B** | `src/utils/borrowingCapacityPdfSections.ts` | 1369 | jsPDF | Live — section pack for the Formara report |
| **C** | `src/utils/borrowingCapacityPdfLibSections.ts` | 940 | pdf-lib | Live — section pack for the Portfolio report |
| **D** | `src/components/borrowing-capacity/BorrowingCapacityPDFSection.tsx` | 401 | pdf-lib | **Orphaned** — re-exported by the barrel, zero consumers |
| **E** | `src/components/borrowing-capacity/scenarios/StrategyRationalePDF.ts` | 718 | jsPDF | Live — the Strategy Rationale Brief |

4753 lines drawing one subject in two engines.

**D is dead code.** `src/components/borrowing-capacity/index.ts:14` does
`export * from './BorrowingCapacityPDFSection'`, so it survives tree-shaking
analysis by eye, but every one of its six exported functions has zero references
outside its own file. It is not a fallback and not a work in progress; it is a
copy of C that was never wired up. Phase 5 deletes it.

### Where A is called from

| Call site | Path |
|---|---|
| Results panel "Download PDF" | `ResultsPanel.tsx:229` |
| Scenario modelling export | `StrategyScenarioModeling.tsx:2984` |
| Client card quick action | `BorrowingCapacityCard.tsx:141` |
| Client reports tab — download | `ClientReportsTab.tsx:835` |
| Client reports tab — **publish to portal** | `ClientReportsTab.tsx:559` |

The last one matters for Phase 4: it is the only path that does not hand the
file to the browser. It calls `generateBorrowingCapacityPDF({ returnBlob: true })`
and uploads the blob to `client-files/portal-reports/<clientId>/…`. Any
replacement must keep that contract — a blob and a filename, generated without a
download side effect.

---

## 2. What the document is made of

A draws 19 steps into a single `jsPDF` instance. In fixture terms, with every
conditional turned on, that is 8 pages:

| Page | Content | Conditional on |
|---|---|---|
| 1 | Cover — full-bleed raster | always |
| 2 | Client name, executive summary, three KPI tiles, utilisation bar, key assumptions, LMI panel | LMI panel: `lmi_mode !== 'none'` |
| 3 | Income analysis table, expenses & liabilities tables | always |
| 4 | Capacity breakdown ledger, recommendations, warnings | recommendations / warnings non-empty |
| 5 | How this was calculated | `explanation` present |
| 6 | Audit trail — raw vs assessed | `audit_trail.entries` non-empty |
| 7 | Scenario comparison | ≥1 non-base preset |
| 8 | Closing — contact and disclaimer | settings fetch succeeds |

Pages 1 and 8 are unnumbered; the running foot on 2–7 reads *"Page N of 6"*
(`BorrowingCapacityPDFReport.tsx:1233`, `totalPgs - 2`).

### The input

`BorrowingCapacityExportData` (`:188–199`) types `assessment` as **`any`**. In
practice it is a raw `borrowing_capacity_assessments` row, and the generator
reaches into ten or so nested shapes on it without a single guard. The type
carries no information; the real contract is spread across 1300 lines of
property access. Reconstructing it is Phase 1.

---

## 3. The golden

`src/components/borrowing-capacity/__tests__/snapshotGolden.spec.ts` renders the
shipping generator against a fictional fixture and writes
`reports/golden/borrowing-capacity-snapshot.pdf` (gitignored — a golden PDF of a
*real* assessment must never be committed, and a fixture that looks real invites
exactly that). 12 assertions pin the page count, the section titles, the
typeface and the cover's identity.

This is the first fidelity coverage on any shipping PDF path in the repo.

**The fixture must carry whole objects, not patches.** `ScenarioPreset.adjustedInputs`
is a complete `BorrowingCapacityInput` and `result` a complete
`BorrowingCapacityResult` (`StrategyScenarioModeling.tsx:174`). A partial one is
not a smaller version of the real thing — it is a different thing. Feeding
`adjustedInputs: {}` for the base case makes the generator print `Rate NaN%`,
which the product never produces. Four earlier drafts of this fixture invented
shapes — `source` for `component`, `liability` for `type`, a percentage where
the code wants a 0–1 fraction, free-text audit verbs (`shade`, `floor`) where
the engine emits `shading_applied` and `hem_benchmark_applied`, an `lmi_mode`
of `capitalised` where the column holds `debt_capitalised` — and every one
produced a page of plausible-looking wrong output. **Read the reader, not a
summary of it.**

Captured today: 8 pages, 215 KB, jsPDF 4.2.1, fonts all base-14 Type 1.

Phase 1 moved the fixture to
`src/lib/reports/borrowingCapacity/__tests__/fixtures/sampleAssessment.ts` so
the golden and the payload contract are asserted against the same assessment
and cannot drift apart.

---

## 4. Findings

Numbered so Phases 1–5 can cite them. F1–F11 came out of Phase 0; F12–F14 came
out of Phase 1, from reading the producer rather than the renderer, and F9 was
corrected there.

### F1 — The cover carries our brand into a white-label tenant's report

Page 1 is `npc-cashflow-cover.jpg`, a full-bleed raster reading **NAIDU PROPERTY
CONSULTING SERVICES / YOUR DEDICATED PROPERTY PARTNER**. The generator *does*
resolve the tenant's own name at `:216–220` into `__brandLine1` / `__brandLine2`
— and then uses it **only in the `catch` branch**, when the image fetch fails.

So a tenant configured as "Meridian Property Partners" ships a document whose
cover says Naidu and whose closing page (page 8) says Meridian. One document,
two identities, and the wrong one is on the front. Verified on the captured
golden: page 1 vs page 8.

The fallback is not clean either: it prints the tenant's name in a gold that
appears nowhere else (`#C9A55A`, see F7) and then hard-codes **NPC's own
tagline**, "YOUR DEDICATED PROPERTY PARTNER", underneath it (`:250`).

The cover also carries no client name, no report title and no date. It is a
brand plate, not a cover.

### F2 — The audit trail formats interest rates as currency

Page 6 renders every `rawValue` / `assessedValue` / `delta` through `fmt()`
(`:45–49`), which unconditionally prefixes `$` and rounds to zero decimals.
`audit_trail.entries` includes `policy` entries, and
`calculate-borrowing-capacity/index.ts:1641–1642` pushes the **interest rate
override** through that category:

```ts
audit.add('policy', 'override_applied', 'Interest Rate Override',
          activePolicy.loanDefaults.interestRate, overrides.interestRate, 'Manual override')
```

On the golden, page 6, that renders as:

> Assessment rate  ·  **$6** → **$9**  ·  **+$3**  ·  Servicing buffer 2.5%

for 6.15% → 8.65%, +2.50%. A lending document is telling the client their
assessment rate is nine dollars. The unit belongs to the entry, not to the
column, and Phase 1 must carry it.

### F3 — Fixed column positions collide

Two confirmed on the golden, both from hard-coded x offsets with no width check:

- **Liabilities table, page 3.** `Balance` right-aligned at `MARGIN+140` and
  `Monthly Repayment` right-aligned at `MARGIN+174` render as
  **"BalanceMonthly Repayment"**.
- **Scenario table, page 7.** `Band` left-aligned at `MARGIN+145` and `Change`
  right-aligned at the margin overlap for every row: **"STRONG+$27,000"**,
  **"MODERA⌷$81,000"** (`:1081`).

These are deterministic, not data-dependent — the widest legitimate band label
and the widest legitimate change value do not fit between those two constants.

### F4 — Text is clipped rather than wrapped

Page 2, key assumptions box: *"Selected Lender: Example Bank — Investor P&I"*
runs past the panel's right edge and off the content area. `doc.text` without
`maxWidth` does not wrap and does not clip — it simply draws past whatever was
meant to contain it.

Page 5 has the inverse: the explanation callout's text is given a `maxWidth`
around half the box it sits in, leaving the right half of a full-width panel
empty.

### F5 — Contrast: seven of nine colour pairs fail

Measured from the constants at `:26–40` (WCAG 2.1 relative luminance):

| Ratio | | Pair |
|---:|---|---|
| 2.62:1 | **fail** | white on `GOLD` — the "Maximum Borrowing Capacity" band, page 4 |
| 2.15:1 | **fail** | `AMBER` on white — the MODERATE band label and every warning |
| 1.94:1 | **fail** | `AMBER` on `AMBER_LIGHT` — "Capitalised to Loan", page 2 |
| 3.30:1 | large only | `GREEN` on white — every surplus and positive delta |
| 3.33:1 | large only | `GRAY` on `GOLD_LIGHT` — the scenario note |
| 3.76:1 | large only | `RED` on white — every negative currency value |
| 3.95:1 | large only | `GRAY` on white — the running foot |
| 11.90:1 | pass | `BODY_TEXT` on white |
| 14.98:1 | pass | `NAVY` on white |

The "large only" exemption does not apply: those seven are drawn at 7–8 pt. And
this is a document that gets **printed** — on paper there is no display gamma to
rescue a 2:1 pair.

Category B of the design system exists for exactly this. `PRINT_SEMANTIC`'s
`positive` `#157A3A`, `caution` `#856514` and `negative` `#D31212` are the
contrast-checked equivalents, and they are frozen — unreachable from tenant
input — so no brand override can reintroduce this.

### F6 — Red and green track the arithmetic sign, not the client's interest

Page 6: the HEM floor adds $700 to assessed expenses — which **reduces**
capacity — and renders **green, "+$700"**, because the delta is positive.
Rental shading renders red because its delta is negative, and it also reduces
capacity. Same effect, opposite colour.

Page 2: capacity utilisation at 97% draws a **red** bar directly above a
narrative sentence saying the loan *"falls within the assessed borrowing limit"*.

Colour is doing arithmetic when it should be doing meaning.

### F7 — Three golds, two ambers, and none of them is the brand

| Value | Where |
|---|---|
| `#BF9B50` | A (`GOLD`), B, E |
| `#C9A55A` | A — a *second* gold in the same file |
| `#C9A326` | C, D (`NPC_GOLD`) |
| `#F59E0B` | A, B, C, D — amber |
| `#D97706` | E — a different amber |

The brand gold is **`#D9A520`** (`tokens.pure.ts:71`), and its on-paper type
colour is `#8E6C15`. None of the five implementations uses either. A also
carries two brown-golds (`#644114`, `#785A1E`) for text on tinted panels — hand-
darkened approximations of exactly what `brand.onPaper` already is.

Navy is the one thing they agree on: `#0D264D` in all five.

### F8 — 100% Helvetica

64 `setFont('helvetica', …)` calls in A, 72 in B, 40 in E. `pdffonts` on the
golden lists only base-14 Type 1 faces. There is no brand typeface anywhere in
the document — not on the cover plate (which is baked into the raster), not in
the headings, not in the figures.

Figures are also set in a proportional face, so columns of currency do not align
on the digit. The Phase 4 container ships Cinzel, Playfair Display, Inter and
IBM Plex Mono precisely so this stops being true.

### F9 — The same adapter, written three times

> **Corrected during Phase 1.** This finding was originally written as *"the
> three implementations disagree on field names"*, from a survey rather than
> from the source. They do not. All three read `component` first and treat
> `shadingRate` as a 0–1 fraction, which matches `calculateIncomeBreakdown`
> (`calculate-borrowing-capacity/index.ts:755`) — the only producer. The real
> finding is worse in a different way.

The normalisation exists **three times**, character-for-character:

```ts
label:        item.component  || item.label            || item.source_name        || 'Income',
grossAmount:  item.grossAmount || item.gross_annual_amount || 0,
shadingRate:  item.shadingRate || item.custom_shading_rate || item.default_shading_rate || 1,
shadedAmount: item.shadedAmount || (item.grossAmount || 0) * (item.shadingRate || 1),
```

— inline in A's draw loop (`:602–605`), and again in private adapters in B
(`:1171–1174`) and C (`:791–794`). The liability adapter is duplicated the same
way (A `:667–674`, B `:1198–1204`, C `:803–809`).

Three copies of one fallback chain means three copies of F10's bug, and any
future field the producer adds has to be remembered in three places. This is
what Phase 1 replaces: `normalise.pure.ts`, once, with `??`.

### F12 — The audit trail and the explanation never render in a shipping PDF

`calculate-borrowing-capacity` builds `auditTrail` and `explanation` and returns
them in its response (`index.ts:1935–1936`). Its `insert` into
`borrowing_capacity_assessments` (`:1948–1983`) does **not** write them, and
there is no column for either.

Every generator reads them off the stored row — A at `a.auditTrail` and
`a.explanation`, in camelCase, from a table whose columns are all snake_case.
`fetchLatestBorrowingCapacity` returns the row unchanged; the What-If override
builder (`StrategyScenarioModeling.tsx:1337`) does not supply them either. So
across all five call sites, both are always `undefined`.

**Pages 5 and 6 of the golden — around 230 lines of the generator — have never
appeared in a document a client received.** They are also the two pages that
would actually explain a lending decision. The data exists; it is computed on
every assessment and thrown away.

### F13 — The liability audit row subtracts a monthly repayment from a balance

```ts
audit.add('liability', action, l.type, l.balance || 0, l.monthlyServicing, `$${…}/mo servicing`)
```

`rawValue` is a **balance** ($412,000) and `assessedValue` is a **monthly
repayment** ($2,480). `AuditTrailBuilder.add` computes `delta = assessedValue -
rawValue` regardless, and the report prints the resulting −$409,520 in the Delta
column as though it were a quantity.

Both sides are money, which is why one currency formatter makes it look
plausible. They are not the same unit.

The same table mixes periods: `income` and `tax` entries are annual, `expense`
and `property` entries are monthly, and all four are printed in one column with
the same `$` and no period.

### F14 — An entry that carries no numbers is printed as `$0 → $0`

`audit.add('policy', 'lender_profile_selected', 'Lender Profile', 0, 0, activePolicy.name)`
records **which** lender policy was used. Its two zeroes mean "not applicable".
Rendered through the currency formatter they state a fact that is not true.

### F10 — `||` swallows legitimate zeros

`:604`: `const rate = item.shadingRate || item.custom_shading_rate || item.default_shading_rate || 1`

A genuine `shadingRate: 0` — income the lender does not count at all — falls all
the way through to `1` and is reported to the client as **fully assessed**. The
same pattern appears at `:1162` (`acq.maxPurchasePrice || 0`) and throughout.
`??` is the correct operator in every one of these positions.

### F11 — The closing page can vanish without a trace

`:1213–1218` wraps the disclaimer page in a `try` whose `catch` only
`console.warn`s. If the settings fetch fails, the document ships **without its
disclaimer** — and the footer arithmetic at `:1222–1233` still subtracts two
chrome pages, so the last content page silently loses its page number and the
denominator is one short.

A general-advice disclaimer is not decoration on a lending document.

---

## 5. What Phase 1–5 must preserve

The migration is free to change everything about how this document looks. It is
not free to change these:

1. **`{ blob, fileName }` when `returnBlob: true`.** `ClientReportsTab.tsx:559`
   uploads that blob to the client portal.
2. **The filename shape.** `Borrowing_Capacity_Snapshot_<SafeName>_<yyyy-MM-dd>.pdf`.
3. **Every section listed in §2**, under every one of its conditionals. The
   golden's page-count assertion is what catches a dropped audit trail.
4. **The four download call sites**, which pass `(clientId, clientName,
   scenarioPresets?, overrides?)` and expect a browser download.
5. **The numbers.** Phase 0 asserts no arithmetic; Phase 1 lifts the computation
   into a pure module and pins it, and the golden's figures are the reference.

## 6. The payload contract (Phase 1)

Canonical in `supabase/functions/_shared/reports/borrowingCapacity/`, bridged
into `src/lib/reports/borrowingCapacity/` by one-line `export *` files, and held
to that shape by `borrowingCapacitySourceOfTruth.spec.ts` — the same guard the
design system has, for the same reason. A format that already exists five times
does not need a sixth copy that started life as "the frontend's version".

| Module | What it settles |
|---|---|
| `measure.pure.ts` | `Measure = { value, unit }`. Nine units, each read off a real value. Formatting is per-unit, so an interest rate cannot render as money (F2, F14) |
| `audit.pure.ts` | The unit **and** the polarity of every `(category, action)` the engine emits (F2, F6, F13) |
| `payload.pure.ts` | `BorrowingCapacitySnapshot` — every figure a `Measure`, every absence a `null` |
| `normalise.pure.ts` | Row → payload, once, with `??` (F9, F10) |

### Three things worth knowing about it

**Nothing is a bare number.** `Measure` carries its unit to the page. The unit
list distinguishes `percent` (`8.65` → `8.65%`) from `rate` (`0.8` → `80%`),
because shading is stored as a fraction and interest rates are not; and
`aud` from `aud/month` from `aud/year`, because F13's delta is only nonsense
once you can see that its two sides are different units. `subtract` returns
`null` across units rather than a number, and a `null` delta renders as an em
dash.

**Direction is not the sign of the delta.** `auditDirection` reads a polarity
table keyed by action: *does a larger `assessedValue` help this client?* A HEM
floor has a positive delta and is `adverse`. Polarity flips **within** the tax
category — `tax_calculated` reports after-tax income, `medicare_levy_applied`
reports the levy charged — which is why the table is keyed by action and not by
category. Phase 2 maps `favourable`/`adverse`/`neutral` onto `PRINT_SEMANTIC`;
Phase 1 only decides which is which.

**The polarity table is checked against the engine.** A table of strings written
in one file and consumed in another goes stale silently, and the failure mode
here is a new audit entry rendering grey and unitless in a client's report.
`audit.spec.ts` parses `calculate-borrowing-capacity/index.ts` — balanced-paren
argument extraction, because the actions arrive as template literals and
ternaries — and asserts both directions: every pair the engine emits is known,
and every pair known here is still emitted. It found the 15 that exist.

87 tests across the four modules. The fixture they run on is shared with the
Phase 0 golden (`src/lib/reports/borrowingCapacity/__tests__/fixtures/`), so the
payload and the capture cannot drift apart.

## 7. The document (Phase 2)

`sections.pure.ts` decides the structure; `render.pure.ts` turns the payload
into HTML through the design system. Nothing else was added — every element on
the page is a design-system primitive, so the format has no stylesheet, no
colour and no geometry of its own.

**Structure is checkable before it is drawn.** `snapshotSpine` builds a
`borrowing-capacity` spine from the payload, and `validateSnapshotSpine`
reports a section with no title, a non-positive budget, a slot the archetype
does not permit, or a total outside its [4, 12] band. `renderBorrowingCapacityDocument`
throws on a bad spine rather than emitting a document — there is no fallback
renderer on this path, so an error whose message names the problem beats a PDF
a client opens.

**F3 and F4 stop being possible rather than being fixed.** They were both
consequences of drawing at hard-coded millimetre offsets. A table declares its
columns and the engine measures them; a test asserts the output contains no
`position:`, `left:` or `top:`.

**F5 likewise.** The body markup names no colour — asserted, with the one
permitted `style` attribute being the cover's background image.

**F6 is answered in words, not colour.** The audit table carries an **Effect**
column that reads "Reduces" or "Increases", under a sentence saying what that
means. Colour was carrying that meaning and carrying it wrong; words also
survive a monochrome printer and a reader who cannot separate red from green,
which on a document about someone's borrowing is not a small consideration. The
one table that still colours by sign is the capacity ledger, and a test asserts
the invariant that makes it safe there: every `adverse` line is also negative.

### What the first real render found

Rendered through WeasyPrint and read page by page — which is the only way most
of this surfaces.

1. **A direction bug in Phase 1's own module.** The audit page said a credit
   card *increases* borrowing capacity. `auditDirection` trusted the engine's
   `impact`, and for a liability row `impact` is the sign of a monthly repayment
   minus a balance (F13) — meaningless, and negative. Fixed: when the two sides
   are not comparable there is no movement to read, and the action's polarity
   answers on its own. A cost is adverse.
2. **A two-column grid tore across a page break.** `renderGrid12` lays out as a
   CSS table and a table cell cannot split, so the left column moved whole to
   the next page while the right column stayed. The assessment terms printed a
   page after the sidenote they were beside. The grid is gone from that section.
3. **Two contradictory rules in the shared stylesheet.** `table.data` carried
   `page-break-inside: avoid` *and* `thead { display: table-header-group }` —
   the second exists so a table can repeat its head when it breaks, which the
   first made impossible. Consequences: a table that did not fit moved whole and
   left a hole, and **a table longer than one page could not break at all**, so
   a client with thirty liabilities would lose rows off the bottom. Now tables
   break, rows do not split, and a caption never strands from its first row.
4. **Figures wrapped mid-number.** `-$10,600 pa` rendered as `-` on one line and
   `$10,600 pa` on the next: line-breaking treats the minus and the space before
   a period suffix as break opportunities. Numeric cells are now `nowrap`, and
   the space before `pa` is non-breaking.
5. **Five tables where one belonged.** One table per audit category repeated a
   six-column header five times in half a page, and each block broke
   independently. One table now, with the category in the item label.
6. **Repeating a period on every row.** A column of `$124,000 pa`, `$42,000 pa`
   … states the period forty times. `periodLabel` puts it in the header once and
   `formatAmount` leaves it off the cells — but only under a header that says
   it. The audit table mixes annual and monthly rows in one column, so there
   every value still carries its own.
7. **KPI labels that wrapped dropped their own values.** A two-line label pushes
   its value down while its neighbours stay put and the strip's baselines stop
   lining up. Labels are short now.
8. **`hem_benchmark` title-cased to "Hem Benchmark"**, which reads as a surname.
   `titleCase` knows the acronyms.
9. **The company name printed twice on the cover** — once as the masthead, once
   as "Prepared by". And the running head's eyebrow said `Section 01`, 150px
   above a chapter header saying `SECTION 01`.
10. **"over a 30 years loan term"** in the executive summary.

The full fixture renders **10 pages**, and the spine claims 10 — a test asserts
the claim, so the two can disagree loudly rather than silently.

### Deliberately not done here

- **No charts.** `charts.pure.ts` has the bullet, waterfall and donut this
  document wants — the utilisation bar, the capacity ledger, the income mix.
  They arrive in Phase 5 with the golden diff.
- **No brand snapshot.** The palette, the company block and the cover art are
  inputs. Phase 3 resolves them from a snapshot so a re-issued report reproduces
  the brand it was issued under.

## 8. The brand (Phase 3)

One input decides what the document looks like: a `ReportBrandSnapshot`.
`brand.pure.ts` turns it into the palette, the company block, the running-foot
masthead, the cover lockup and the confidentiality line;
`renderSnapshotFromBrand` is the entry point the render path uses.

**F1 is answered by construction.** The tenant is on the cover, in the running
foot of every page and on the closing page, from one resolution. There is no
branch where our name can appear — a test walks the whole document for "Naidu",
our tagline, and the first 120 characters of `NPC_HOUSE_COVER_ART` and
`NPC_HOUSE_MARK`.

The house cover art is deliberately unreachable. Its own doc comment in
`defaultAssets.generated.ts` says it must never be a white-label fallback: it is
not a photograph, it is a finished NPC cover with our company name, tagline and
monogram burned into the pixels. A tenant with no cover art gets the typographic
cover — a designed state, not a gap.

**F7 is closed for this format.** `#C9A55A` — the fallback cover's gold in
`BorrowingCapacityPDFReport.tsx`, one of three across the five implementations
and none of them the brand — now comes from `accentOnField`, the role the design
system contrast-checks for brand type on a dark ground. A test reads all four
generator files and fails on the literal. The same line also carried NPC's
tagline hard-coded under the tenant's name; that is gone too.

**A re-issued report reproduces the brand it was issued under.** That is the
reason a snapshot exists rather than a lookup: the same snapshot produces
byte-identical HTML, a changed one does not, and the fingerprint moves with it.

**Gaps are reported, not thrown.** `renderSnapshotFromBrand` returns
`{ html, gaps }`. A report with no ABN is a worse report, not an impossible one,
and refusing to render would turn a cosmetic gap into an outage. Phase 4 decides
where those lines are logged.

### What the tenant render found

The first tenant-branded render put a **22mm red block** on the cover. The
fixture mark was a 1×1 PNG, and it passed every check the asset policy had:
`data:` URI, allowed MIME, well-formed base64, under the byte cap. Nothing
looked at how big the picture was.

That is not a fixture problem. `logo_config` accepts whatever a tenant uploads,
and a favicon uploaded as a report mark prints at 22mm on the cover and 13mm on
paper. `assets.pure.ts` now reads the pixel dimensions out of the header — PNG
from its `IHDR`, JPEG by walking the marker chain past any EXIF or ICC block to
the first frame header — and rejects below a 96px floor with the measured size
in the reason, so the fallback chain walks on to the next mark the tenant did
upload. WebP returns "cannot measure" rather than a guess, and an unmeasurable
asset is accepted: refusing to print a logo whose header would not parse is
worse than printing one that might be small.

## 9. Phase map

| Phase | Delivers |
|---|---|
| **0** ✅ | This document, the golden capture, and the audit above |
| **1** ✅ | One payload contract — pure, typed, tested; units and direction carried on values (F2, F9, F10, F13, F14) |
| **2** ✅ | The document through the design system — structure, primitives, spine (F3, F4, F5, F6) |
| **3** ✅ | Driven from a brand snapshot; the cover stops being a raster (F1, F7) |
| 4 | The render path — route, auth, storage, signing; brand typefaces (F8). **F12 is decided here**: the audit trail and the explanation are computed on every assessment and discarded, so the render path has to either persist them or recompute them |
| 5 | Charts, golden diff against this capture, and deletion of D and the superseded packs |
