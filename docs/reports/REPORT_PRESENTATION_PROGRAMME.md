# The report presentation programme

Finalised 21 September 2026. Every number in this document was measured from
**one delivered PDF** — the Investment Compass issued for 9 Hollow Street,
Golden Square VIC 3555 on 21 Sep 2026, 39 pages, 529,181 bytes — by reading the
FILE with `pdfjs-dist` rather than the source that made it. That is the same
method `A_PREMIUM_DOCUMENT.md` used, and for the same reason: it is what turns
"the reports don't look right" into a number, and it is the only way to find a
defect the source cannot show you.

Where a finding is a count, the extraction is: 2,154 text items carrying
position, size and font; per-page operator lists counting path, fill, stroke and
image operations; the PDF's own embedded font table.

---

## 0 · The two rules this programme is built on

**Every property in Australia gets the same document.** Not the same *quality of
evidence* — that varies by what a jurisdiction publishes — but the same
structure, the same visual language, and an honest statement of its own
coverage. A Darwin property and a Sydney property come out of one machine.

**A fix lands at the layer that cascades.** The catalogue is 500 masters —
10 design families × 5 structural variants × 10 colourways — sharing ONE shell
(`investmentCompass/master.ts`), and those designs carry no subject matter, so
they serve all ten migrated report formats: Investment Compass, Borrowing
Capacity Snapshot, Portfolio Performance Review, Property Comparison Analysis,
10 Year Cash Flow, Client Details Form, Cash Flow Comparison, Report Q&A,
Commercial & Industrial Capacity and Market Intelligence. Beneath them sit one
Markdown implementation (`_shared/reports/markdown.pure.ts`), one directive
parser and router (`vizDirectives.pure.ts`, `vizFigures.pure.ts`) and one
geometry module (`narrativeGeometry.pure.ts`). **A change in any of those
reaches every format and every colourway.** A change inside one composer reaches
one composer. The programme is sequenced so that the cascading layers go first.

---

## 1 · What the delivered document actually does

### 1.1 The clean bills, stated first

These classes have been measured and are **not** defects, and they should not be
re-opened without new evidence:

- **No text falls outside the page box.** 0 of 2,154 items.
- **No overlapping baselines.** 0 collisions. The class that once printed the
  verdict heading through the KPI band is closed.
- **Page 4's assessment table is correct** — "SHARE OF GRADE" over four rows,
  Growth 64/47%, Location 89/30%, Yield 96/18%, Demand 68/5%, matching the
  stored record exactly and footing to the published composite of 77.
- **The display faces render.** The PDF embeds Cinzel, Playfair Display (4
  weights), Inter (5 weights), IBM Plex Mono (3 weights). Tabular/monospaced
  figures are available to financial tables, which REPORT_RULES §4 requires.

### 1.2 The finding that reframes the rest: the document draws no charts

`investment_reports.report_content` for this report holds **20 `{{kind: …}}`
chart directives** and 26 `{{` sequences in total. The delivered PDF contains
**zero charts**.

The evidence is the per-page operator list. The floor across the document is
**11 path constructions and 4 fills** — that is page furniture: the rules under
the running head and above the foot. **Fourteen of thirty-nine pages sit at
exactly that floor**, which is to say they are pure text. Every page above the
floor is above it because of *strokes*, which are table rules. There is not one
image XObject in the body; the only two in the file are the mark on the cover
and the closing page.

So the model composed twenty figures and the reader received none.

Worse, three of them printed **raw template markup to the client**:

```
p25   {{stat label="Crime data coverage" unit="" sub="Recorded-crime register …"
p26   {{stat label="Registered major public projects" unit="" sub="Within ~15 km …"
p30   {{stat label="Golden Square house median" unit="$" sub="Vic Valuer-General, 2025" 567500
```

`{{stat …}}` is written with `label=` rather than `kind:`, so the parser never
matches it, nothing strips it, and it reaches paper verbatim. This is the most
serious presentation defect in the document.

And where directives do parse, roughly half of them **encode a boolean as a
chart**:

```
{{bars: General Residential Zone (GRZ) 1 | title=Planning framework context}}
{{heatmap: 1,0 / 1,0 | rows=Zone,Overlays | cols=Checked,Not in layer}}
{{margin: Overlay check basis | spark=1,0}}
{{bars: GRZ zoning verified 1, Overlays mapped 0, Overlays checked list 1}}
```

A bar of height 1 meaning "verified" is a checkbox drawn as a chart. It is the
same family as the rule `withholdRatedAbsenceCharts` already enforces for
absences, one step earlier: a retrieval status is not a quantity.

The good directives are there and are also lost:

```
{{bars: Subject house $387,500, Golden Square house median $567,500}}
{{heatmap: 8.6,5.6 / 1.5,1.9 / 8.5,3.8 | rows=1-year,3-year,5-year
          | cols=Golden Square,Victoria}}
{{bars: Annual rainfall vs local normal 683.1mm vs 511.3mm, …}}
{{tiles: Healthcare 10 facilities sub="Within 5 km of the property"}}
```

A price-against-median comparison and a three-horizon growth comparison against
the state benchmark are exactly the figures a client reads a report for.

### 1.3 Structure and placement

**The document closes and then runs on for eight more pages.** Its own contents
page prints the defect:

```
16. Final Recommendation ......................... p.29
17. Appendix, Source Notes & Disclaimer .......... p.29
18. Planning controls and development registers .. p.30
19. Resale Liquidity & Exit Outlook .............. p.33
20. SWOT Analysis ................................ p.33
21. Monitoring & Review Plan ..................... p.36
```

A fifth of the document sits after the disclaimer, and two of those sections are
substantive analysis the recommendation eight pages earlier should have rested
on. **Cause:** two blind `reportContent += …` concatenations at the end of
assembly. The registry was never wrong — it declares `exitOutlook` 13, `swot`
15, `monitoring` 18, `recommendation` 19 and `provenance` **90**, last and
deliberately; every model-authored section is in its declared position.
**Closed this session** by `documentPlacement.pure.ts`; takes effect on the next
generation of each report.

**Two sections have nowhere to exist.** In the Compass registry:

```
infrastructure  ("Infrastructure and Growth Context")        → merged('locationCase')
supplyPipeline  ("Competitive Landscape and Supply Pipeline") → merged('marketPosition')
```

This is precisely the fault v4.0 fixed for Zoning, which had been a
`sourceHeading` of the Risk Dashboard so "a retrieved planning control had
nowhere to be explained and the reader got a row". The registry's own rule is
*a section with nothing behind it should be merged; a section with a register
behind it should not.*

### 1.4 Page-level defects, with measurements

| # | Page | Finding | Measurement |
|---|---|---|---|
| a | 25, 26, 30 | Raw `{{stat …}}` markup printed to the client | 3 occurrences |
| b | all | No chart drawn anywhere | 20 directives → 0 figures; 14/39 pages at the furniture floor |
| c | 5 | Titled "RISK REGISTER", contains no register — a restatement of the grade and a pointer back to p4 | **18% fill**, 20 items, 381 chars |
| d | 37 | Monitoring table: 5 columns crushed to 5–6 lines per cell, **one data row**, on a page four-fifths empty | **21% fill** |
| e | 3 | The Verdict page lists **one** strength and stops | 53% fill, ~260pt white below |
| f | 4 | `definitions('Opportunities', [{ term: 'Noted' … }])` — a placeholder word occupies the term column; only `{{opportunities.0}}` is ever drawn | 14pt "Opportunities" over 10pt "Noted" |
| g | 16 | Four bullet glyphs with no text beside them, plus a stray "1" | y=639, 623, 606, 575 at x=61 |
| h | 17–19 | Running head wraps: "Zoning, Planning and Development Considerations" (46 chars) exceeds the ~124pt right-aligned marker, orphaning **"Considerations" alone at 6.2pt on three pages** | every other chapter fits one line |
| i | 34 | `osm_amenity_register` — a snake_case table name printed in client prose | 1 occurrence |
| j | 19, 21, 26 | U+2011 non-breaking hyphen falls back to a substituted face mid-word | 3 characters, 3 pages |
| k | 1 | Cover verdict block `BUY · A · 77` set at **11pt** against a 41pt address | — |
| l | 4 | "Priced below suburb median — potential for value appreciation" under *Opportunities Noted* | **Closed this session** |

### 1.5 The Zoning, Planning and Development section

Three pages (16–18) say, in substance: it is GRZ; no overlays are mapped; we
cannot tell you minimum lot size, maximum building height or floor space ratio;
obtain a planning certificate. The "At a glance" **Strength is an absence** —
*"No mapped overlays at the property coordinate"* — and the Verdict is
*"Desktop planning check only."*

Page 22 carries the sentence that costs the most:

> "No infrastructure project or development instrument was retrieved for this
> location from the registers this platform reads."

The report already proves the material exists: page 22 quotes the **Golden
Square Structure Plan** ("substantially dominated by detached / separated
dwellings, with 88.6 percent…"). The model found that by search. No register
retrieved it, so nothing can be tabulated, dated, sourced or scored from it —
and under the standing rule *a web search is not a retrieval*, it should not be
relied on at all.

---

## 2 · National coverage, measured

| Register | Jurisdictions | Verdict |
|---|---|---|
| `amenity_register` | ACT, NSW, NT, QLD, SA, TAS, VIC, WA | ✅ national |
| `urban_centre_register` | ACT, NSW, NT, QLD, SA, TAS, VIC, WA (102 SUAs) | ✅ national |
| `market_sales_medians` — medians | all 8 + an `AU` floor | ✅ national |
| `market_sales_medians` — **sales counts** | NSW, QLD, SA, VIC | ❌ **Demand cannot score in ACT, NT, TAS, WA** |
| Planning constraint layers | NSW, VIC, QLD, TAS | ❌ **nothing in SA, WA, NT, ACT** |
| Recorded crime | NSW, QLD, SA, NT | ❌ 4 of 8 |
| GTFS transport | 4 networks, 185,177 stops; VIC declared-but-unloaded | ❌ partial |

The platform already solves "national" correctly five times — geocoding,
sales medians, amenities, commute and street imagery all run **a national floor
refined by per-jurisdiction providers, with coverage travelling with the
answer**. Planning and development is the one area that does not, which is why a
Bendigo property gets three pages of absence and a Perth property would get
worse.

---

## 3 · The workstreams

Each item states its acceptance test, because an item without one is an
intention.

### W1 · The visual layer — cascades to all ten formats

**W1.1 · Close the directive vocabulary.**
No unrecognised directive may reach paper. `{{stat …}}` must either parse or be
stripped.
*Accept:* a spec renders every directive kind the generator's prompt can emit,
through the real read path, and asserts no `{{` survives in the output; plus a
scan of the delivered corpus for `{{`.

**W1.2 · Make the template path draw figures.**
The primitives exist — `renderHeatmap`, `renderWaterfall`, gauge, donut,
timeline, pictograph, `fitLines`. The WeasyPrint/template route is not invoking
them. Where a kind genuinely cannot be drawn, tabulate it through
`vizDirectiveTables.pure.ts` — *a promise of a figure is a figure*, never
dropped behind the sentence that introduced it.
*Accept:* the operator-list probe over a regenerated document shows image or
path counts materially above the 11/4 furniture floor on the pages carrying
directives, and no directive is silently lost between `report_content` and the
page.

**W1.3 · Refuse the boolean chart at the producer.**
A series whose every value is 0 or 1, or whose axis is "Checked / Not in layer",
is a retrieval status, not a quantity. Render it as a status row.
*Accept:* a unit test over the real directives from this document; the four
named above become status rows and the price/growth/rainfall/amenity ones are
untouched.

**W1.4 · One chart standard.**
Apply the `dataviz` method through the colourway tokens, honouring REPORT_RULES
§2 (7:1 under 10pt; never a saturated chromatic accent at that size) and §3 (no
shadow, no gradient text, no glass — hierarchy by rule, weight, ground and
space).
*Accept:* a contrast validator over the rendered palette at each size band; a
golden render per family showing charts are byte-identical across a family's ten
colourways except for token values, which is the catalogue's existing guarantee
for geometry.

### W2 · Structure and placement

**W2.1 · Section placement by declared order** — **done**
(`documentPlacement.pure.ts`, 11 specs). Composed blocks land at their registry
order; the document closes on its disclaimer.

**W2.2 · Un-merge `infrastructure` and `supplyPipeline` for the Compass.**
Give each a declared section, order and word budget. **This is the precondition
for W3**: a national register with nowhere to be explained is a paragraph inside
Location.
*Accept:* `sectionsForTier('compass')` returns both; the contents page lists
them; `documentPlacement` seats them at their declared order.

**W2.3 · Rebuild page 5 and page 37.**
p5 either carries a real risk register or is removed and its dashboard given the
room; p37's five-column, one-row table is restructured.
*Accept:* no content page below a declared fill floor (see W2.4).

**W2.4 · A page-fill floor.**
No content page below ~45% fill; short tails fold back under the existing
`NARRATIVE_PACKING` rules, which already cut a paragraph at a sentence, repeat a
table head, float a figure and refuse a stub last page.
*Accept:* the fill probe over a regenerated document reports no content page
under the floor, with front matter and deliberate dividers excluded by name.

### W3 · Evidence — national by construction

The rule: **every property in Australia gets a development reading; the grain is
the publisher's; the scorer prices the grain; coverage travels with the answer.**
This is `openDataSalesEvidence`'s existing rule — an LGA point scores 55, a
postcode 80, a suburb 100 — applied to development evidence.

**W3.1 · The national floor: ABS Building Approvals by LGA.**
Monthly, free, authoritative, **every local government area in Australia**;
dwelling counts and dollar value. One source, national coverage, no key. It is
the direct analogue of the Queensland DA walk that produced 1,410 dwellings and
$1.18bn, and `registerWalk` / `summariseDaRows` already exist to consume it.
*Accept:* a development reading for a property in each of the eight
jurisdictions, each naming its grain and period.

**W3.2 · National named projects: Infrastructure Australia Priority List.**
Nationally significant projects carrying the publisher's own status word — an
approval never read as funding, funding never as a start on site.
*Accept:* page 22's sentence is replaced by named, dated, sourced entries, or by
a coverage statement that names the register asked.

**W3.3 · National forward demand: ABS population projections by SA2.**
Replaces "no forward projection" everywhere rather than in one state.

**W3.4 · Per-jurisdiction refinement behind a declared order.**
`DEVELOPMENT_PROVIDERS` / `PLANNING_PROVIDERS`, mirroring `AMENITY_PROVIDERS`
and `GEOCODER_PROVIDERS`. Extend the existing NSW/VIC/QLD/TAS constraint layers
to **SA, WA, NT and ACT**, and add each jurisdiction's amendments and
major-project registers as refinements *above* the floor — never as the only
answer.

**W3.5 · Close the Demand scoring gap.**
Sales counts for ACT, NT, TAS and WA, so Demand can score nationally rather than
in four states. Today `scoreTransactionVolume` is the only primary demand
measure this deployment is entitled to, and it needs four counted periods.

**W3.6 · Coverage travels, with a jurisdiction dimension.**
A Western Australian property must read *"no state planning register is loaded
for Western Australia"*, never *"no overlays"*. The five absences already
exist — `not_served`, `not_integrated`, `licence_restricted`, `none_at_point`,
`unavailable` — and must be stated on every reading, full or empty.
*Accept:* a test asserting that for each of the eight jurisdictions the planning
and development readings carry an explicit coverage statement, and that no
absence is rated.

### W4 · Typography, brand and copy hygiene

**W4.1 · Running head fitting.** A marker that does not fit gets a short form
that is a **prefix of the full label** (the existing `shortLabel` rule). Tested
against the longest chapter label across **all ten formats**, not the Compass's.

**W4.2 · Contrast audit under REPORT_RULES §2.** Eyebrows, running heads and
page numbers render at 6–6.5pt in this document, where the floor is 7:1 and no
saturated accent. `--brand` on ivory is ≈2.3:1. Derive one darkened gold; the
codebase already contains eight because this was solved ad hoc.

**W4.3 · Page 4** — drop the "Noted" placeholder term; draw all opportunities,
not index 0.

**W4.4 · Page 3** — one strength on a half-empty page.

**W4.5 · Cover** — the verdict block at 11pt against a 41pt address.

**W4.6 · Debris** — four empty bullets and a stray "1" on page 16.

**W4.7 · No database vocabulary in a client document.** `osm_amenity_register`
is printed in prose on page 34. The AML module already forbids underscore-cased
identifiers in rendered fields and has a test for it; port the rule.

**W4.8 · Glyph coverage.** U+2011 falls back to a substituted face on three
pages. Either supply the glyph in the primary face or normalise it at the write
boundary.

**W4.9 · Correct the stale skill note.** `REPORT_RULES.md` §4 states "Cinzel is
not installed yet". The delivered PDF embeds `FWDZFX+Cinzel`. Left uncorrected,
designers will keep avoiding a face that is available.

---

## 4 · Sequence, and why

```
W1.1 ─┬─> W1.2 ──> W1.3 ──> W1.4          the cascade foundation
      │
W2.2 ─┴─> W3.1 ──> W3.2/3.3 ──> W3.4/3.5  evidence, national
      │
W2.3/2.4, W4.*                            presentation, parallel
```

**W1.1 first**, because raw template markup is reaching clients today and it is
the cheapest defect in the document to close. **W1.2 next**, because twenty
figures per report are being composed and discarded, and it is the single
largest gain in the programme — it cascades to all ten formats at once.

**W2.2 before any of W3**, because a national register with nowhere to be
explained produces a better paragraph inside Location, not a section.

**W3.1 before the rest of W3**, because the national floor is what makes the
section honest for all eight jurisdictions on day one; the per-jurisdiction
refinements then raise precision without changing the document's shape.

W2.3, W2.4 and W4 are independent and can run alongside.

---

## 5 · Already closed in this programme

- **Seed v18** applied and verified live: 50 library entries carry "Share of
  grade", 0 carry "Five dimensions, weighted"; 4 active masters refreshed.
- **Section placement** — `documentPlacement.pure.ts`, 11 specs.
- **The forbidden valuation** — "Priced below suburb median" removed from both
  call sites with a code-scanning spec, under `MARKET_FIGURES_IN_THE_REPORT.md`
  rule 6.
- **The migration-drift gate** — made to run, made to fire, and made to stop
  reporting phantoms (14 findings → 8, every removal verified as a phantom).

## 6 · Decisions this plan does not take

- Whether the 21 `market_sources` rows should be seeded — a decision about live
  rows, recorded in `20260921060000`'s header.
- Whether the nine pre-19-Sep reports are regenerated. They are scored on three
  dimensions and would each gain 5–9 points; the owner has said no.
- Whether Risk can ever score. It needs a construction year, held on 0 of 1,230
  stored reports, and `propertyRiskSchema.pure.ts` forbids manufacturing it. Four
  of five remains the honest ceiling.
