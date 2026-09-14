# Narrative packing — the report body on a template's own page

**Status:** live on the Investment Compass path (RS-3c, 14 Sep 2026).
**Modules:** `supabase/functions/_shared/reports/narrativeGeometry.pure.ts`
(the charge model), `markdownPaging.pure.ts` (the packer),
`src/lib/reportTemplate/narrativePlan.ts` (the renderer's pre-pass),
`src/lib/reportTemplate/blocks/markdownBlockContent.ts` (the block's
resolution and memo), `scripts/verify/report-pdf/measureNarrativeMetrics.py`
(the instrument).

Read this before touching the markdown block's styles, the charge model, the
packer, `NARRATIVE_PAGES` in the master builder, or `FOOTER_RESERVE`.

## 1. What was wrong

The report body — `report_content`, the document the model writes — is carried
by a run of forty conditional pages, each holding one bucket of the same
source, each gated on `narrative.pages > n`. The block estimates every
Markdown block's height in lines and packs buckets to a budget. That estimate
was calibrated once, on one family's face at one size over one measure
(`MEASURED_CHARS_PER_LINE = 95`, `CALIBRATED_CONT_LINES = 46`), and then held
back 16% to survive the pages it still got wrong.

Measured through the real journey (Chromium → finalise → local WeasyPrint 69,
`scripts/verify/report-journey/run.mjs`) on the long reference report, every
narrative page of a Midnight render ran its text to y≈800–810pt, through the
running foot at 820, for sixteen consecutive pages. Three independent causes,
each sufficient on its own:

| cause | measured | effect |
| --- | --- | --- |
| figures charged at `MM_PER_LINE` (18.9pt a line, one family's leading) against a 14.7pt pitch | a gauge charged at 62% of its printed height | every figure page overflowed |
| compact figures had no stylesheet in the template path — `.chart-compact { width: 60.5% }` lives in the flowing route's CSS | a gauge drawn for 60% of the measure set across all of it, with the user agent's own `figure` indent | taller than charged, indented for no reason |
| the page bottom was the foot, not the master's `contentBottom` | budget 46 lines from y=114 reaches 791pt; the master sets 744 | 47pt past the line every other block on the page respects |

and two lesser ones: a one-line list item charged at 79% of its own height,
and a five-column risk row charged at seven lines that set at eleven.

## 2. The rule

**A block is charged what it will draw on the page it will print on.** The
geometry the block can read off its own props — the measure, the body size,
the leading, the face — and the styles the block itself emits are enough to
compute that, so they do:

- `MARKDOWN_TYPE` is the block's type scale (heading scales and margins, list
  indent, cell padding, figure margins, callout chrome), declared once and
  read by both `markdownBlock.html.ts` (to style) and the charge functions
  (to cost). The block cannot style a heading one way and charge it another.
- `FACE_ADVANCE_EM` is each face's average advance over ordinary prose, in
  ems, measured with the pinned engine over eighty lines at three sizes
  (Inter 0.49, Noto Serif 0.50, Lato 0.45, Roboto 0.46, Playfair 0.47, IBM
  Plex Mono 0.62). A face not in the table is charged at 0.52 — wider than any
  measured one — so an unknown family packs sparser rather than overflowing.
- `narrativeBottom` recovers the master's own content bottom from the block's
  right edge: `page.height − (page.width − x − width) − FOOTER_RESERVE`. The
  reserve is `NARRATIVE_FOOT_RESERVE_PT`, pinned to `blocks.ts`'s constant
  by a test.
- `NARRATIVE_HOLDBACK` (6%) covers what a character count cannot see — line
  breaking around long words and bold runs — about a line and a half over a
  full page.

Every charge formula was checked against the engine with the instrument,
which sets each probe with the block's exact inline styles and reads the
height WeasyPrint gives it. Paragraph, headings, list, table, figure and
callout agree within 0.4% of a line; the spec
`narrativeGeometry.spec.ts` carries the measured numbers and fails on any
charge that falls below what the engine drew.

Two findings from that instrument are worth keeping. **The box tree is in CSS
pixels** — the first run of the instrument divided pixel heights by a point
pitch and reported every charge 33% low, which is exactly the kind of error a
calibration can bake in unnoticed. And **a lone element's trailing margin
collapses through its container**, so a probe has to establish a formatting
context (`overflow: hidden`) or a heading measures without its own margin.

Tables are the one block whose cost is not a function of characters alone.
Auto layout gives each column its longest word, then shares the remainder by
how much each column has to say — so the "Why it matters" column of a
five-column risk register gets a third of the measure and its 300-character
cell wraps to eleven lines. `tableCharge` models exactly that (damped share
`TABLE_SHARE_EXPONENT = 0.8`, narrow-column wrap loss `TABLE_WRAP_LOSS =
1.12`), verified on the engine's own 10.51 lines a row.

## 3. Who decides the page count

A master carries the same source on forty pages; every instance packs the
whole source and draws its own bucket. The bucket boundaries depend on the
first page's box AND the continuation pages' box, which no single instance
can see — so the renderer computes ONE geometry per run from the template
(`planNarrative`), files it on the context under `NARRATIVE_GEOMETRY_KEY`
keyed by the block's source binding, and every instance packs with it. A
geometry that differed between two instances would print a line twice or
lose it between pages.

The same pre-pass writes each run's true page count over the projection's
`narrative.pages` before any page conditional is read. The projection's
number is a template-blind estimate (it cannot know Noto Serif over 459pt
from Inter over 509pt) and remains what every surface without a template
uses; the renderer's count is what the conditionals see, so a page the
geometry needs is drawn, a page it does not need is not, and the "Not the
whole report" notice fires on the count that is actually true. Both
renderers make the pass (`htmlRenderer.ts`, `pdfRenderer.ts`), and the
buckets are memoised on (source, geometry, palette), so the render that
counts is the render every instance draws from — forty instances used to
render the whole source forty times.

## 4. Filling the page

Once nothing overflowed, the pages ended 60–140pt short of the bottom: a
packer that only pushes leaves the room a block did not fit into empty. Four
rules in `packNarrativeGeometry`, each off by default so the legacy packer is
byte-identical:

- **A paragraph is cut at a sentence** (`splitParagraphBlock`): after
  sentence punctuation, with every inline tag opened in the head closed in
  it, and at least two lines on either side. Nothing is reworded; the parts
  concatenate to the original.
- **A table meets the boundary and splits there** when the room holds its
  head and some rows and the table has six or more — the head repeats, as a
  paper ledger's does. A shorter table is pushed whole rather than orphaned,
  unless it is TALL: a two-row register whose rows are paragraphs
  (`TALL_ROW_LINES`, a fifth of a page in all, `BOUNDARY_SPLIT_TALL_LINES`)
  splits with a head over each row, because a head over one ten-line row is a
  page's worth of reading rather than an orphan. Measured on the sparse
  report: pushed whole, that register left 47% of one page white and stood
  alone on the next. The room must hold the head and the first row, or the
  cut only puts two heads on the next page.
- **A figure floats** past the prose that follows it, up to the next
  heading, and opens the next page. At most two are carried; a figure taller
  than a page is never floated.
- **A tail of at most three lines is folded onto the page before it.** The
  master's bottom sits 76pt above the running foot on every family, so an
  overrun that small lands inside the reserve.

## 4a. The hole a dropped block leaves

A master lays a page out as a flow and the renderer positions every block
absolutely at the `y` the flow assigned, so a block that is dropped at render
time — its conditional false, or nothing to draw (`blockDrawsContent`) — used
to leave a hole exactly its size. The long reference report's Risk page drew
its heading at 103pt, nothing until 349pt, and the recommendation there: the
register between them is conditional on a risk the record does not carry.

`closeDroppedBlocks` (`src/lib/reportTemplate/closeDroppedBlocks.ts`) moves
the blocks under a dropped block, in its column, up to where it began, so the
gap before it becomes the gap before them. The masters carry no declared
height on a flowed block, so the rule is made safe by what it refuses rather
than by measurement: nothing moves when a drawn block sits in the band between
the dropped block's top and the first follower (a tile beside a dropped tile
keeps its row), only blocks contained in the dropped block's own column move
(a rail beside the column is never crossed), furniture never moves and never
counts, and in the editor nothing moves at all. A block above the dropped one
cannot be crossed either: a flow places each block below the tallest of the
row before it, so a block that ends inside the dropped block's band would
already have overlapped it.

## 4b. A chart label fits the drawing it belongs to

The same renders found four chart labels set past their drawing: a gauge
caption cut mid-word by the viewBox, a donut legend label printed into its
own percentage, a timeline marker's label set straight through its
neighbour's, and a pictograph title run under its count. There is no text
measurement in a pure module, so `fitLines` (`reportDesign/charts.pure.ts`)
wraps a label by word into the units it may use, from an average advance per
character that was read off the engine's own output (0.55 em at these sizes,
bold included; 0.72 em for tracked capitals), cuts what still does not fit
with an ellipsis, and every drawing grows for the lines it adds. The timeline's
stops sit where each gets the same measure — an end label anchored to the
edge, an interior one centred — because with the stops at 44 units the end
measures were 136 against the interior 208.

The template chart block also draws its axis, tick and legend ink from the
template's tokens (`chartInk`) rather than the flowing route's literal
`#1A1A1A` / `#666` / `#EAE3CB`, which on a dark family printed axis labels in
near-black on a near-black ground.

## 5. What the projection still owns

`projectReportNarrative` is unchanged: it publishes the source and a
template-blind estimate through the calibrated profile. `resolveNarrativeProfile`
now carries `geometryAware`, and only a format on a geometry-aware profile is
packed by geometry; Report Q&A and Market Intelligence keep the legacy
arithmetic they were measured under.

## 6. Verification

- `narrativeGeometry.spec.ts` — every charge against the engine's measured
  heights, the bottom rule, the face table, the reserve pin.
- `markdownPagingGeometry.spec.ts` — the four page-filling rules, the tall
  two-row table, and that each is off unless asked for.
- `closeDroppedBlocks.spec.ts` — the column reflow at both the pure and the
  renderer level: the hole closes, a row keeps its tiles, a rail is never
  crossed, the editor is untouched.
- `reportCharts.spec.ts` ("a label never runs past the drawing it belongs
  to") and `chartInk.spec.ts` — the fitted labels and the token ink.
- `narrativePlan.spec.ts` — one geometry per run, the count written over the
  estimate, every instance on the same buckets, the cut notice on the true
  count, and the compact figure at the compact width.
- The journey (`run.mjs --report … --template …`) plus
  `scripts/verify/report-pdf/measure.mjs` on the PDF it produces, which is
  where every number in this document was read. `measure.mjs`'s OVERLAP
  reading pairs text runs by bounding box and pairs a figure's alt text with
  the running foot on two pages of the long report — checked by
  `pdftotext -bbox`, no body line on either page reaches below 771pt.
