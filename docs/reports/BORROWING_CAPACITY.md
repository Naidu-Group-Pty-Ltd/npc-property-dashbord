# Borrowing Capacity Snapshot — the format's contract

The Snapshot is the document a client is handed when they ask *"how much can I
borrow?"*. It is the most-generated report in the product and the least
governed: five separate PDF implementations draw parts of it, no two agree on
the field names, and none of them has ever had a test.

This document is the **Phase 0 output** of the migration described in
[`DESIGN_SYSTEM.md`](./DESIGN_SYSTEM.md). Phase 0 changes no shipping code. Its
job is to record what the format does *today*, in numbers rather than
impressions, so that Phases 1–5 can be measured against something instead of
argued about.

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
which the product never produces. Three earlier drafts of this fixture invented
field names (`source` for `component`, `liability` for `type`, a percentage for
a 0–1 fraction) and each one produced a page of plausible-looking wrong output.
**Read the reader, not a summary of it.**

Captured today: 8 pages, 215 KB, jsPDF 4.2.1, fonts all base-14 Type 1.

---

## 4. Findings

Numbered so Phases 1–5 can cite them.

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

### F9 — The three implementations disagree on field names for the same data

For one income row:

| | A (`:602–605`) | B, C |
|---|---|---|
| label | `component` | `source` |
| shading | `shadingRate` as a **fraction** 0–1 | `shadingRate` as a **percent** |

For one liability, A reads `type` / `label`; B and C read `liability` /
`provider`. Any of the three renders the other's payload as a table of rows all
labelled "Income" or "Liability" with 100% shading — silently, because every
lookup is a fallback chain. This is not hypothetical; it is what three drafts of
the golden fixture produced.

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

## 6. Phase map

| Phase | Delivers |
|---|---|
| **0** ✅ | This document, the golden capture, and the audit above |
| 1 | One payload contract — pure, typed, tested; units carried on values (F2, F9, F10) |
| 2 | The document through the design system — stylesheet, primitives, spine (F3, F4, F5, F6) |
| 3 | Driven from a brand snapshot; the cover stops being a raster (F1, F7) |
| 4 | The render path — route, auth, storage, signing; brand typefaces (F8) |
| 5 | Charts, golden diff against this capture, and deletion of D and the superseded packs |
