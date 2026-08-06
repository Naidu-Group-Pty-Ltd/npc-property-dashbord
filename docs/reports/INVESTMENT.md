# Investment Location & Property Fit — the contract

The largest format in the programme, the highest-volume one by an order of
magnitude — **1,182 rows in `investment_reports`, 5–18 a week, continuously** —
and the last to be read against production rather than against a fixture.

Everything below was measured against the live `investment_reports` table. Every
number is a count, not an estimate, and each one names something that was
silently wrong on every current report until this change.

---

## 1. The model draws, and nobody was listening

`generate-investment-report`'s prompt asks the model for a visual vocabulary and
enforces it hard — *"Every chapter MUST open with a `{{glance: …}}` strip"*,
*"Any list of 3+ ranked metrics MUST be rendered as `{{bars: …}}`"*. It obliges:

| kind | in the corpus | | kind | in the corpus |
| --- | ---: | --- | --- | ---: |
| `bars` | 718 | | `timeline` | 188 |
| `glance` | 660 | | `tiles` | 174 |
| `gauge` | 527 | | `margin` | 164 |
| `donut` | 431 | | `quadrant` | 105 |
| `wheel` | 346 | | `waterfall` | 8 |
| `heatmap` | 227 | | | |
| `pictograph` | 205 | | **total** | **3,753** |

**107 figures a report**, across 35 reports. `3,748` of the `3,761` lines that
carry a directive carry nothing else, so a whole-line rule covers 99.65% of them
and the 13 exceptions are a "how to read this report" legend where the model
*names* the kinds in prose.

The design system's Markdown renderer did not know the grammar, so every one of
them set as body copy. A client's page printed

```
{{bars: Bed/bath/car match to family demand 82, Layout flexibility 75 | title=Property fit | max=100}}
```

in the middle of a paragraph, about a hundred times a document.

The striking part is that **eleven of the twelve kinds already had a finished,
tested chart primitive** in `reportDesign/charts.pure.ts` — `renderBars`,
`renderGauge`, `renderDonut`, `renderScoreWheel`, `renderHeatmap`,
`renderPictograph`, `renderQuadrant`, `renderTiles`, `renderTimelineRibbon`,
`renderWaterfall`, `renderMarginSpark`. The vocabulary the model writes and the
vocabulary the design system draws are the same vocabulary. Nobody had connected
them.

Two modules do that now, and the split is deliberate:

- **`_shared/reports/vizDirectives.pure.ts`** parses to typed data and stops. It
  has no idea what a palette is.
- **`_shared/reports/vizFigures.pure.ts`** takes a parsed directive and a
  `ChartContext` and returns HTML.

`markdown.pure.ts` gains a `'figure'` block kind and one option,
`MarkdownOptions.renderDirective`, so it acquires no dependency on the chart
module — which needs a resolved palette and a column width that a Markdown
renderer has no business holding.

**A directive is never printed as source.** Omitting `renderDirective` removes
them anyway; a shortcode is an instruction to the renderer either way.
`MarkdownNotices.figuresDrawn` / `figuresDropped` count both outcomes, because a
silent drop looks exactly like a report the model chose not to illustrate.

### What the parser refuses, and why

98.7% of the corpus's directives parse. The residue is refused on purpose:

- `{{waterfall: Offer accepted +Contract, Settlement =Risk-managed}}` — a
  rhetorical waterfall whose "values" are words. There is nothing to plot and a
  chart primitive would draw a lie.
- `{{bars: Drive to Melton Station 8–12 min}}` — a range. 8 is not the figure
  and 10 is not in the source.
- `{{bars: Logistics & warehousing, Construction, Retail trade}}` — a list with
  no values at all.

`~` **is** accepted: `Tin Can Bay ~15 min, Rainbow Beach ~35 min` is how travel
times are written throughout, and refusing it loses the whole comparison.

### Tiles, and the one genuine ambiguity

The prompt asks for `{{tiles: Label value sub="…" int=0.7}}` and neither half is
delimited. `splitTileLabelValue` resolves it in three passes: a quoted tail
(`Cooloola Cove "Family coastal"`), a numeric tail (`Schools 4`, `Hawthorn
$1.42M`), and otherwise **the value starts at the last capitalised word**. That
last rule is right on every sampled string — `Economic & Mining Cycle` /
`Moderate–High`, `Tin Can Bay` / `Coastal leisure` — where "split at the last
word" gets three of seven wrong. With no capital after the first word there is
no signal, and the whole run becomes the label with no value: a thinner tile,
not a wrong one.

---

## 2. The generator stopped numbering its sections

| | reports | with numbered headings |
| --- | ---: | ---: |
| without `{{…}}` figures | 1,147 | 733 |
| **with them — every current report** | **35** | **0** |

`SECTION_CHARTS` keys the fourteen named infographics on the section number.
`PROSE_GROUPS` folds 36 numbered sections into four chapters by advancing on the
number. With no numbers:

- not one of the fourteen charts drawn from the structured jsonb columns reached
  the page, and
- the group index never advanced, so **all sixteen sections landed in "Location
  & Market"** — one chapter, three empty ones, and a contents page that named
  none of the model's own sections.

Both are fixed without touching the numbered path, which still serves
two-thirds of the archive:

- **`attachChartsByTitle`** maps the section titles the current generator writes
  — `Executive Verdict`, `Risk Dashboard`, `Population & Housing Demand`,
  `Financial Input Snapshot` — onto the named charts, each claimed at most once.
  `chartHasData` still gates every one, so a generous pattern costs a counted
  skip and nothing else.
- **A section becomes a chapter** when nothing is numbered. A report whose
  sections are already named and already in a deliberate order *is* its own
  chapter list. A keyword classifier was tried first and rejected: the financial
  variant opens with `Client Investment Decision Summary` and closes with
  `Financial Recommendation & Portfolio Fit`, so any monotonic keyword scan puts
  the entire document in the last chapter.

**The model's own figure wins.** `Executive Verdict` carries
`{{gauge: 61 | Location & Property Fit}}` *and* earns `score-gauge`, which draws
61 out of 100 from the score column — the same needle at the same value on two
consecutive pages, seen on the first render. `score-gauge` and `score-wheel` are
suppressed when the section already carries a `{{gauge}}` or `{{wheel}}`, and
only those two, because only those two plot numbers the model was handed.

---

## 3. The tables

### The score breakdown had never been read

Every one of the 985 scored reports stores a dimension as an **object**:

```json
"locationScore": {
  "score": 58, "weight": 56, "hasData": true, "excluded": false,
  "details": "Excellent walkability (90+). Limited CBD access (>60 min)."
}
```

`toScore` called `num()` on that, got `null` five times out of five, and
`chartHasData('score-wheel')` — which needs three — was false on every report
ever generated. The score wheel is the one drawing in this document that comes
from the scoring engine rather than the model's prose, and it had never been on
a page.

It now reads the object, and `weight`, `details` and `excluded` come with it. An
**excluded** dimension is `null`, never a zero: the engine is saying it had no
data, and plotting it would put a fabricated point on the wheel.
`scoreBreakdownTable` prints the five dimensions with their weights and the
engine's own one-line reason, and keeps an excluded row saying "Not scored" —
four rows where the wheel has five reads as a table cut for space.

### The spec table printed neither dimension

| field | populated in `property_specs` | in `financial_calculations.propertySpecs` |
| --- | ---: | ---: |
| land size | **0** | 110 |
| building size | **0** | 109, as `buildSizeSqm` |
| bedrooms | 651 | 0 |
| property type | 1,054 | 34 |

`property_specs` exists on all 1,182 rows with exactly the snake_case keys
`toSpecs` reads, which is why nothing ever looked wrong — it is mostly nulls.
`toSpecs` now takes the finance run as a fallback. Note `buildSizeSqm`: not
`building_size_sqm`, not `buildingSizeSqm`, both of which were already accepted
and neither of which exists on any row.

The table also stopped repeating the tiles above it. `propertyTiles` draws
bedrooms, bathrooms, parking, land, building, year, zoning and type; the table
drew all eight again on the next page. It now carries the address and the
council — the two the tiles have no room for — and the whole opening chapter
fits one page.

### The KPI strip broke its own values

`table-layout: fixed` divides the strip evenly, so six cells across the 174mm
measure is about 28mm each. At `h2 + 2` and `line-height: 1` a value that wrapped
printed its second line's ascenders through the first line's descenders. Two
changes: the leading is 1.08, and a strip of five or more cells
(`KPI_DENSE_FROM`) sets its figures a step smaller. Read off a render before:
`3.74 / %` and `Hous / e`.

### The sources chapter counted its own headings

`sources_content` opens `## SOURCES & REFERENCES` / `### Citations:` on 1,114
rows and carries `### Additional Sources:` on 777. All three are longer than the
eight-character floor, so all three were counted and printed: a chapter of 19
URLs was captioned "21 cited" and its table's first two rows were the headings
above it. **Those three strings are the only non-URL lines in the column.**

---

## 4. Page economy, and the budget

A chart drawn at `CHART_WIDTH.compact` — a gauge, a donut, a score wheel, a
pictograph — is 460 units wide. Stretched across the measure at `width: 100%`
that is 113mm of a 253mm text block for a single number, and the corpus averages
fifteen gauges a report. `chartFigure` now takes a `ChartFigureWidth`; `compact`
prints at 60.5% (`CHART_WIDTH.compact / CHART_WIDTH.wide`) and **the caller must
narrow its `ChartContext.widthMm` by the same fraction**, or every label inside
the drawing is set at the wrong point size.

Figures are charged to the page budget for the first time. `proseLines` passes a
`planningChartContext` — grey, never printed — because a chart's height is a
function of its data and its column width and not at all of its colours, so the
planner measures the figure the render will actually draw rather than a per-kind
constant that goes stale.

`MAX_DOCUMENT_LINES` rose from 2,000 to 3,200 for that reason. 2,000 lines is 53
pages; the Compass document a client was sent last month is **61**, so the old
ceiling was already cutting sections off the end of the longest reports before a
single chart existed. 3,200 is 84 pages, under the archetype's own 92.

---

## 5. What the fixture had to change

`fixtures.ts` agreed with the normaliser and disagreed with the database, which
is the failure this whole document is about arriving one level down. Three
shapes were corrected to what production holds, and each correction turned a
passing test into a failing one:

- `breakdown` values are objects, not numbers;
- `property_specs` land and building size are `null`, and the real dimensions sit
  in `financial_calculations.propertySpecs`;
- `sources_content` opens with its three headings.

`currentFormat()` is new: the same structured columns, with prose in the shape
the generator writes **today** — sixteen named sections, no numbering, a
directive under each. It is what `render.spec.ts` writes to
`reports/html/investment-compass.html`, because the artefact anyone looks at
should be the document a client receives this week.

Its directives never repeat, for the reason the prose already didn't: cycling
seven of them over sixteen sections put the identical gauge on two pages and
fired `duplicate-block` — the critique rubric's only `high` finding — five times
on the fixture alone, which makes the strongest check in the harness useless for
the document it is checking.

---

## 6. Verification

```
npx vitest run src/lib/reports src/lib/reportDesign src/lib/brandDesign
npx tsx scripts/reports/renderAll.mts --only investment-compass
```

The render leaves page images under `reports/pages/investment-compass`. The
rubric is a floor; the pages are the evidence. As of this change the document
carries no `high` findings, and the following were confirmed by looking at them:

- every one of the twelve kinds draws (`vizFigures.spec.ts` asserts each);
- no `{{` survives into the HTML on any path, with or without a renderer;
- land 612 m² and building 198 m² print on the spec page for the first time;
- the score wheel prints with its five weighted dimensions and the engine's
  reasons beside it;
- the KPI strip sets `House`, `3.74%` and `−$6.7k` each on one line.

The sparse-page findings that remain are the chapter-per-section page break and
a fixture with two paragraphs a section, and they belong to the page-economy
work, not to this change.
