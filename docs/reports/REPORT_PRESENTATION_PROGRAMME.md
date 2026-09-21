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

### 1.2 The finding that reframes the rest: the charts draw, and half of them are not measurements

**A correction to the first version of this plan, kept rather than quietly
rewritten.** It stated that the delivered PDF contains *zero charts*, on the
evidence of a per-page operator list showing no image XObject in the body. That
reading was wrong and the probe was counting the wrong thing:
`chartFigure()` emits an SVG, and **WeasyPrint draws a data-URI SVG as native
vector paths** — there is no image to count. Re-measured by FILL COLOUR, the
brand gold `rgb(142,108,21)` appears in the path fills of the chart pages and
in none of the text-only ones. The figures are on the page. The rule this cost
is the one §7 of `INVESTMENT_REPORT_RESUME.md` already charges for: *an
instrument that can fail the way its subject fails is not an instrument*.

What is true, and is worse, is what those figures SAY. Driven through the real
parser, the twelve quantitative directives in `report_content` divide like
this:

| | |
| --- | --- |
| Measure something and draw correctly | **4** (two price-vs-median pairs, two growth heatmaps) |
| Plot nothing but flags | **5** |
| Have no series the parser can read | **1** |
| Draw the wrong numbers, convincingly | **2** |

**Five plot nothing but 0 and 1.** `{{bars: Zone GRZ … 1, Overlays checked &
none mapped at coordinate 1, Land use table & certificate not yet read 1 |
unit=index}}` draws three identical full-length bars.
`{{bars: GRZ zoning verified 1, Overlays mapped 0, Overlays checked list 1}}`
draws `Overlays mapped` at zero height beside two full ones — which a reader
takes as *no overlays*, when the register says overlays were CHECKED and none
were mapped at the coordinate. That is a retrieval result stated as a count of
zero: `rentalEvidence`'s rule — **absent is never zero** — committed in ink.
`{{margin: Overlay check basis | spark=1,0}}` is the same thing at the smallest
size the document draws.

**And two draw the wrong numbers while looking entirely correct**, which is the
finding that reframes the rest:

```
{{bars: Healthcare 10 within 5 km, Shopping centres 10 within 5 km,
       Parks & recreation 9 within 5 km, Restaurants & cafés 10 within 5 km
       | title=Local amenity counts within 5 km | unit=facilities}}
```

The grammar is `Label Value` and the model wrote a sentence. The parser takes
the last number, so every item plots **5** — the RADIUS — and the counts 10,
10, 9 and 10 are stranded in the labels, which are left reading
`Healthcare 10 within`. Four identical bars, under a title promising amenity
counts, on a record whose own enrichment measured four different ones. The
climate chart is the same cut: `Annual rainfall vs local normal 683.1mm vs
511.3mm` plots **511.3**, the long-run normal, and discards the 683.1 the title
exists to compare it against.

Three of the document's `{{` sequences also printed **raw template markup to
the client**:

```
p25   {{stat label="Crime data coverage" unit="" sub="Recorded-crime register …"
p26   {{stat label="Registered major public projects" unit="" sub="Within ~15 km …"
p30   {{stat label="Golden Square house median" unit="$" sub="Vic Valuer-General, 2025" 567500
```

`stat` is a FENCE kind opened with the DIRECTIVE delimiter, so it matches
neither parser, nothing strips it, and it reaches paper verbatim. Closed by
W1.1.

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

**W1.2 · ~~Make the template path draw figures.~~ WITHDRAWN — the premise was
wrong.** The figures already draw. Measured by fill colour rather than by image
count, the chart pages carry brand-gold path fills and the text pages carry
none; of the twelve quantitative directives, eleven reach the page and one is
dropped by the renderer for having no series. Nothing here needs building. The
finding it was standing in front of is W1.3.

**W1.3 · A chart is a measurement, or it is not drawn as one.** ✅ **DONE**
Two rules, in `chartQuantity.pure.ts`, on the read path beside
`withholdRatedAbsenceCharts`. **A flag set is not a quantity** — withheld
whole, with nothing worded in its place, and only where the directive itself
confesses: every plotted value a flag AND either a unit that is not a unit
(`index`, `Zone code`, `Descriptor`) or a retrieval state on an axis
(`Checked`, `Not in layer`). A genuine count that happens to read 1 and 0 under
`unit=facilities` is drawn exactly as it is today. **A value cut out of a
sentence is not this item's value** — the label and the display are re-joined
into the phrase the model wrote and set as the table it always was, split at
its first number, so `| Healthcare | 10 within 5 km |`. The tell is exact: a
label ending in a connective is a sentence the parser cut, and it must also
still carry a number, so `3-bedroom houses` and `Minimum lot size 450 m²` are
untouched.
*Accepted:* 29 specs, every fixture verbatim from the delivered document.
Measured over its twelve quantitative directives — **withheld 6 · tabulated 2 ·
kept 4**, the four kept being the two price comparisons and the two growth
heatmaps, byte-identical.

**W1.4 · One chart standard.**
Apply the `dataviz` method through the colourway tokens, honouring REPORT_RULES
§2 (7:1 under 10pt; never a saturated chromatic accent at that size) and §3 (no
shadow, no gradient text, no glass — hierarchy by rule, weight, ground and
space).
*Accept:* a contrast validator over the rendered palette at each size band; a
golden render per family showing charts are byte-identical across a family's ten
colourways except for token values, which is the catalogue's existing guarantee
for geometry.

### W1.5 · Vocabulary, and what a drawing may say — **done**

Four more read off the same PDF, each closed where it is produced.

**A heading written twice around its own content is one heading.** Five
sub-headings printed twice — every risk in the register — each announced,
summed up, and announced again before its detail list.
`mergeAdjacentDuplicateHeadings` merges rather than choosing, because the two
bodies differ and keeping either alone deletes half the section.

**A database key is never the name of a publisher.** `vic_vpsr_suburb` in the
column headed *Where it is published*, beside a row that names Vicmap Planning
correctly. `PROVIDER_LABEL[p] ?? p` under a comment reading "never the enum";
the two archived suburb series were never added, and they are the readings
that answer for **Victoria and South Australia**. The map is total now, so the
compiler refuses the next one.

**`transactionVolume` is a field name.** The same defect one module over, on
the page that explains what each dimension rested on. Named, and the fallback
drops a label it cannot supply rather than printing the key.

**A paragraph is never a column.** The Monitoring & Review Plan's fifth column
runs to 190 characters against 16–65 for the other four, so in a fifth of the
measure the header set as `What to re-Where it isHow often itAs read for this`.
It is one block per dependency now.

**A heatmap's title fits the grid it belongs to.** `House price growth · Golden
Square vs Victoria (Valuer-Genera` — cut mid-word, because `w` is computed from
the labels and the title was never measured. Fitted, with the header band
growing rather than the type shrinking.

### W1.6 · Where a figure may come FROM — **done**

The page read reached pages 19–22 and stopped being about presentation.

**The document contradicts itself on crime.** Page 20 states a per-100,000
violent-crime rate compared against the Greater Bendigo benchmark, attributes
property-crime rates to **Crime Statistics Agency Victoria**, quotes a
"moderate" exposure reading and a count of **522 crimes**. Pages 24, 25 and 26
say four times that no recorded-crime register is integrated and that *no crime
counts, rates or safety scores are held for the Golden Square area in this
report*. The register section says the figures on page 20 do not exist.

**And on rainfall.** Pages 8 and 28 state **511.3 mm** from the SILO grid cell
with its 1991–2020 window named; page 19 states *"about 420–430 mm"* and names
no source. Twenty per cent apart, one property, one document.

Both have one cause. The crime and climate instructions are scoped to the
TABLE and the OUTPUT — *"do NOT print a crime table, a safety score, a rating
or an estimated rate"*, *"discuss only the measured figures above"* — and a
model that searches obeys both and still writes the paragraph, because neither
says where a figure may come **from**. `planningFactBlocks` closed this for
planning in one clause, which is why the planning section of the same document
is sound. The clause is now stated once in `registerAuthority.pure.ts` and
imported by both blocks, on the held branch as well as the absent one, because
page 20 mixed an unheld rate into a comparison rather than inventing a table.

**And the same document restates one fact forty-five times.** Counted over its
29 body pages: `GRZ` / *General Residential Zone* **45**, *Vicmap Planning*
**26**, *a planning certificate / Section 32* **24**, *no mapped control*
**15**, the layer's currency date **5**. The cause is structural and correct —
the planning block is pinned into every section call, because trimming it once
made the model invent controls — so `planningFactBlocks` gains rule 9, the one
rule there about PLACEMENT rather than content, scoped to the provenance
apparatus and never to the caveat.

Also closed on the same pages: `[Market Evidence table]` and
`[Zoning & Planning table, 6]` printed raw (the literal list missed both — the
first is a fifth heading, the second carries `, 6` inside the bracket), and a
tile reading `HEALTHCARE 10 FACILITIES` over nothing at all.

### Still open from the page-by-page read

**Page 5 — WITHDRAWN, it was already closed.** I read the delivered page as a
live defect: the *Risk Register* divider carries the verdict headline and the
graded line verbatim from the Executive Verdict two pages earlier and nothing
else, 558 characters stopping 600pt from the foot. The master pairs a risk
register with a `!(risks && risks[0] && risks[0].risk)` callout that renders
the absence, and `evalConditional` used to REJECT an expression naming an
unbound name — so on a record carrying no score object the author's positive
and negated conditionals were both false and the fallback was dead. That was
found and fixed on `main` on 19 Sep under a comment naming this exact page on
three delivered reports; the 21 Sep document predates the deploy. Verified by
executing the pair against `{}`, `{risks: []}`, `{risks: [{}]}` and a real
risk: the callout draws on all three absences and the register draws on the
one presence.

This is §5's lesson paid again — **a document is evidence about the build that
made it, not about the tree you are reading** — and it is why every other
finding in this programme was traced to the line that produces it before
anything was changed.

### W1.8 · The chart guard could read three forms in twelve — **partly done**

**A growth heatmap printed `0` for Victoria's ten-year CAGR.** I recorded this
as needing a producer change, on the reasoning that *"the `0` is in the
directive the model wrote, so nothing at presentation can tell it from a real
zero"*. **That was wrong, and a guard for exactly this already existed.**

`suppressUnevidencedMarketSeries` removes a market-worded directive carrying
any figure the market evidence table does not state — the guarantee behind
`CHART_IS_A_CLAIM`'s *"a series … may contain only values from the table
above"*. It re-parses the directive grammar privately: a `spark=` / `values=` /
`data=` / `series=` option, or a bare head that is entirely numeric. Measured
by execution over all twelve production forms, one real figure beside one the
table does not hold:

| form | judged |
| --- | --- |
| `bars` (`spark=`) | yes |
| `wheel` (numeric head) | yes |
| `margin` (`spark=`) | yes |
| `heatmap` (grid head) | **no** — now yes |
| `bars` (head pairs), `donut`, `tiles`, `waterfall` | no |
| `gauge`, `pictograph`, `quadrant`, `timeline` | no |

**Nine of twelve were unread**, including `bars` with head pairs — the first
example in the grammar's own documentation and the commonest form in the
corpus. The guard was written against the 18 Annabelle Crescent defect, which
used `spark=`, and it catches precisely that shape.

A grid head is `8.6,3.9 / 2.0,1.0`; the head-is-a-series test is
`/^[\s\d.,-]+$/`, the `/` fails it, so the head is taken for a **title** and no
value is read at all. That is closed, and `describingWords` now recognises a
grid head as a series for the same reason — one string read as a value list in
one place and a title in another is how two readings of one grammar come to
disagree.

**The other eight are deliberately left open**, and
`marketSeriesCoverage.spec.ts` pins the list by execution rather than leaving
it in this document, because a blind spot written into a document is one
nobody re-reads. Two reasons for stopping. A grid is unambiguously a set of
**magnitudes in the table's own units**, while a `gauge`'s max, a
`pictograph`'s total and a `quadrant`'s axis positions are a **scale** —
judging a position against a table of medians would remove a sound chart. And
removal is destructive: extending to the label-carrying kinds means judging
values whose units this module cannot confirm, and the exposure can only be
measured against the directive corpus in `report_content`, which this session
may not query. That is a decision to take with the measurement, not an
argument to win without it.

The lesson is §5's again, from the other direction: **the absence of the shape
you expected is not the absence of the thing.** Twice in one sitting — the
amenity blocks that existed inline, and the chart guard that existed and could
not see.

**The document cites listing sites and third-party tools as evidence.** Page 21
attributes a suburb zoning breakdown to **Landchecker** and a "5-minute drive
from Bendigo CBD" to **Ray White Bendigo and Domain**; page 19 attributes flood
behaviour to an **SES Local Flood Guide** and "excellent air quality" to
unnamed "suburb-level environmental profiling". W1.6 closes crime and climate,
and then census, regional and macro — every prompt block that had no clause at
all.

**A correction to what that first pass claimed.** Market positioning was listed
as lacking the clause and it does not: `marketFactBlocks` already carries it in
both branches in its own voice, and `planningFactBlocks` states it as part of
the sentence giving its rules precedence over the prompt. Both are deliberately
left alone and a spec asserts it — rewriting a rule that works, to make it look
like its neighbours, is a change with no reader behind it. What page 21 cites
Landchecker and Ray White/Domain for is a suburb zoning breakdown and a drive
time: **locality** claims, not market figures, which is why the market block's
rule never reached them.

**Amenity and transport are what remain.** Closed in W1.7 below — and the
scoping sentence that stood here was wrong, which is worth keeping rather than
overwriting. It read: *"neither has a prompt-block module of its own — the
amenity counts and the single recorded stop reach the prompt through the
location enrichment rather than through a composed block with rules attached
… it needs a block, not a clause."* Both blocks existed, inline in
`propertyPrompt`, with rules attached to each. I had grepped for a `*Blocks`
module and concluded from its absence that there was no block, which is the
same mistake as judging a column against `types.ts`: **the absence of the shape
you expected is not the absence of the thing.** What was actually wrong was
worse than a missing block and invisible from the outside.

### W1.7 · Four of six field names were written by nothing — **done**

Read against what `location-intelligence-service` publishes rather than against
what the blocks asked for:

| the block read | published as | what fired |
| --- | --- | --- |
| `transport.stationDistance` | `transport.distanceToStation` | never |
| `transport.transportTypes` | *nothing publishes it* | never |
| `transport.commuteToCbd` | `commute.durationMinutes` + destination | never |
| `lifestyle.supermarkets` | *no supermarket lookup is taken* | never |
| `lifestyle.nearestSupermarket` | *the same* | never |
| `lifestyle.nearestShoppingCenter` | `lifestyle.nearestShopping` | rendered `—` |

`commuteToCbd` had **exactly one occurrence in the repository**: the line that
reads it. So the commute — measured, with a named destination and the
`ownCentre` flag that `A_PREMIUM_DOCUMENT.md` §20 exists for — has never
reached the prose on any report. `PLACES_CATEGORIES` holds six and no
supermarket lookup is among them, so that row was a labelled promise of a
figure the platform cannot produce — law 2, committed in the fix for law 2.

**And one is worse than a silent field.**
`projectTransportForLocationIntelligence` returned `nearestStation: 'N/A'`
where no stop was found, and the block guarded on `if (t.nearestStation)`.
`'N/A'` is truthy. So every property outside a loaded GTFS network — every
Victorian, Western Australian, South Australian, Tasmanian and ACT property,
which is most of this deployment — printed `Nearest public transport stop on
record: **N/A**`, and because `parts.length` was then 1 the block's own
fallback **suppressed** its prohibition on naming a station, stating a distance
or calling the area car-dependent. The prohibition was skipped in exactly the
case it was written for. `placesAvailability.pure.ts` established that rule and
corrected the sibling branch; this is the branch that actually runs.

That is the mechanism behind page 21 citing **Landchecker** and **Ray White
Bendigo and Domain**. The readings were measured, stored and stamped with their
own provenance; the blocks in front of them read almost none of it and named no
publisher at all, so a model asked to evidence a count supplied a source.

`amenityFactBlocks.pure.ts` composes both from the fields the record publishes,
under six rules: a count **names the register that produced it** from
`stages.amenitySources`; a publisher common to every row is **stated once below
the table** rather than as a column repeating one value; **no stop found is a
fact about the FEEDS**, in the register's own terms with the loaded networks
named; **a commute names where it was measured to** and says plainly when that
is not this property's own centre; **absent is never zero and never `'N/A'`**;
and both carry `webSearchIsNotARetrieval`.

Three things the gates caught, each worth recording:

- `oneDateFormatter.spec.ts` failed the first draft for carrying its own month
  table and its own ISO regex. Correct — that is the defect `AU_LOCALE` and
  `auDate.pure.ts` were each written to close, committed a third time.
  `stampDate` delegates to `formatIsoDate`.
- The first `TRANSPORT_VERDICT_SENTENCE` carried a `sourceUnavailable` key the
  projection never produces and had **no sentence for `stops_nearby`**, the
  ordinary case. An entry that can never fire and a case that has none are the
  same mistake read from two ends; the map is `Record<TransportVerdict, string>`
  and therefore total.
- `transportGtfs.spec.ts` held a test named *"reports no distance rather than
  zero when nothing was found"* which pinned `distanceToStation` to null and
  `nearestStation` to the sentinel **one line below**. The test asserted the
  violation of its own name.

`compassDocumentContract.spec.ts` asserted these absences by grepping the
prompt's source. They move to `amenityFactBlocks.spec.ts`, where they are
executed against the shape the service publishes — which is precisely why the
old inline blocks could carry four dead field names while that file passed.

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

**W2.4 · ~~A page-fill floor.~~ WITHDRAWN — there is no packing defect, and
the two measurements that said otherwise were both mine.**

The first fill probe counted CHARACTERS and reported 14 of 39 pages under
45%. That measures text, not ink: a page carrying a chart is not under-filled,
and the metric topped out near 59% on a full page, so the "floor" was a
property of the instrument. **It is §7's rule again — an instrument that can
fail the way its subject fails is not an instrument** — and it is the second
time in this programme that a probe counted the wrong thing.

The second was a grep. `PackOptions` has nine page-filling switches —
`keepWithNext`, `splitTables`, `splitAtBoundary`, `floatFigures`,
`absorbTail`, `balanceTail`, `splitParagraphs`, `splitLists`, `reserveLines` —
and searching for them outside `markdownPaging.pure.ts` returns nothing, which
reads exactly like the unmounted-component defect this repository has found
three times. **They are all passed**, inside `packNarrativeGeometry`, in the
file the search excluded, and `markdownBlockContent.ts` is the renderer's call
site. Every filling behaviour is on.

Measured properly — the vertical extent of every glyph AND every path
construction, banded at 6pt, over the content box — the body pages (6–35) sit
at **58–80% inked, reaching 69–89% of the box**, which is what typeset prose
looks like. Three body pages stop short:

| Page | Reaches | Why |
| --- | --- | --- |
| 16 | 69% | the `General Residential Zone (GRZ) 1` single bar, and a sidenote that floated past it |
| 25 | 64% | the `{{stat …` markup and the doubled `Crime & personal safety` heading |
| 36 | 69% | the five-column Monitoring table |

**All three are already closed by W1.1, W1.3, the duplicate-heading merge and
the Monitoring rewrite.** Page 5's 28% is the Risk Register divider whose
withheld-register callout was fixed on `main` on 19 Sep; pages 4, 37 and the
cover are master-fixed and correctly sparse.

So the under-filled pages were a SYMPTOM of the content defects, not an
independent packing failure, and a fill floor would have been a rule invented
to fix something that was not broken. What is worth keeping is the
instrument — ink extent rather than character count — for the next
regeneration.

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

**W4.1 · Running head fitting — NOT A DEFECT, and the gate is honest now.**

Measured rather than assumed, which is the only reason I can say it. The
running head is two text blocks — `documentLabel` in 66% of the measure and
the part marker in the other 34% — with the rule struck beneath at a
**two-line** reserve. Neither is fitted or truncated, so a third line would
print through the rule.

The longest things that can land there, collected across all ten formats:

| slot | longest |
| --- | --- |
| part marker | **31** characters (`How each property is performing`) |
| document label, nine formats | **32** characters (`Commercial & Industrial Capacity`) |
| document label, the Compass | a BINDING — `{{report.documentTitle}} · {{property.address}}` |

That binding is the one that matters: `documentTitle` runs to 20 characters
(`Due Diligence Report`) and `property_address` to **84** across the 1,187
stored rows, so a client's running head can reach **~107 characters**.

**The fixture was measuring 63.** `SAMPLE_REPORT_DATA`'s address is 42
characters, so the geometric gate had never laid out a head longer than
`Investment Compass · 14 Marlborough Street, Leichhardt NSW 2040`. That is
`WHAT_THE_PAGE_ACTUALLY_DRAWS.md` §2 again: *a fixture shorter than the
product turns a real measurement into a statement about the fixture.*

Re-run with the worst case substituted — **all 710 renders clean**. So the
running head fits, on every family, at the longest address in the corpus. This
is a **closed blind spot rather than a repaired document**, and the honest
fixture stays, so the next change to the head, the type scale or the measure
is judged against the real thing.

Two rules follow. The substitution lives in the HARNESS, not in
`SAMPLE_REPORT_DATA` — that is the BINDING fixture the catalogue specs assert
rendered output against, and its job is to resolve every bound path, while the
geometric measure needs the worst case and composes one (the same split the
body-size composition above already makes). And `LONGEST_ADDRESS` is named
**once**: it was a bare `const … = 84` inside `cover()` AND again in
`investmentPropertyRows.spec.ts` — two copies of one measurement, which is how
the two disagree the next time the corpus is re-measured. The harness asserts
its sample address is exactly that long, which is what caught the first draft
of that string at 82.

**W4.2 · Contrast audit under REPORT_RULES §2.** Eyebrows, running heads and
page numbers render at 6–6.5pt in this document, where the floor is 7:1 and no
saturated accent. `--brand` on ivory is ≈2.3:1. Derive one darkened gold; the
codebase already contains eight because this was solved ad hoc.

**W4.3 · Page 4** — drop the "Noted" placeholder term; draw all opportunities,
not index 0.

**W4.4 · Page 3 — WITHDRAWN. One strength on the page is the RECORD, not a
binding.** I wrote it up as *"one strength on a half-empty page"*, implying the
binding should draw more. It should not, and the master already says so with a
measurement: across the 985 scored reports `investment_score.strengths` holds
at least one on **745** and at least two on **47**; `weaknesses` one on 874 and
two on **15**. A second row *"printed a marker with nothing beside it on 95%
and 98% of reports respectively"*, which is why `strengthsWatch` draws one
each. There is no second strength to draw. Whether the page should carry
something else is a design question rather than a defect — and §9's rule
applies: a fill floor invented for a page that is correctly sparse is a rule
with no reader behind it.

### W4.3 · Two placeholder words, and seed **v19** — **done**

`Noted` appeared in two slots that name things, on the 50 Investment Compass
masters, and a sweep of every literal `term:`, `rating:`, `confidence:`,
`value:` and `status:` across all eleven format files found no other — the
rest are real labels (`Location`, `Yield`, `Risk`, `Suburb`, `Value and
equity`, `Cash contributed`). These two were the class.

**The risk register's rating.** The record holds a bare risk STRING and no
severity, and the exposure vocabulary is `Low | Moderate | High | Not
assessed`. `Noted` was a fifth word in a four-word vocabulary, in the column
that states the EXPOSURE, and absent from `RATING_PALETTE` too. It reads
`Not assessed` now. `confidence: 'Indicative'` is deliberately KEPT — it is in
`CONFIDENCE_PALETTE` and is an honest qualifier for an unverified one-liner.

**The Opportunities list's term.** Every sibling definition list on that page
carries a real term naming what the row is about; the record gives an
opportunity as one unlabelled string, so any term there is invented. The
heading already said "Opportunities", so the 160pt term column carried a word
that repeated nothing. It is a `callout` now — the container that page already
uses for one unqualified statement.

**The release is a v19, and that was checked rather than assumed.** The
generator's own header says to check whether the previous release is applied
before editing: `20261209000000` and `20261209010000` are both in the applied
list (1,012 migrations, latest `20261211000000`), so this is a new release
rather than an edit. Editing an applied v18 in place is precisely the failure
the `@effect` probe exists to catch.

**Two masters GAIN a block, and the first draft of the header denied it.** I
wrote "no page gains or loses one", then measured: parsed both seed files,
compared all 2,172 schemas, and found `"type":"definition-list"` **−32**
against `"type":"callout"` **+34**. **Analyst Folio** and **Monograph** gain
one each (333→334, 320→321) while keeping all seven of their definition
lists. They never carried the Opportunities block — it is OPTIONAL, and
`ifItFits` keeps one only while `y + height + SLACK <= contentBottom`. The
definition list declared ~75pt, the callout declares 72, and on those two
variants three points are the difference. A block they had been dropping
silently now fits. `SLACK` is untouched at 36.

**What was verified, and how:**

| claim | evidence |
| --- | --- |
| only Compass masters move | 34 schemas changed, all Compass; changed lines are exactly 50 distinct family names plus 2 header lines |
| the other 493 are byte-identical | parsed and compared all 2,172 schemas in both files |
| `Noted` is gone | `"rating":"Noted"` 50→0, `"rating":"Not assessed"` 0→50, `"term":"Noted"` 32→0 |
| the geometry holds | `templates:compass:qa` — *"no block overflows its page, and none prints over another, in any of the 710 renders"* |
| the refresh is the same mechanism | the v19 refresh diffs **identical** to v18's once release identifiers are normalised |

**And a contract test was renegotiated, correctly.**
`investmentPropertyRows.spec.ts` counted `>Not assessed</td>` over the WHOLE
document and required zero — a document-wide selector for a scorecard-shaped
rule. The rule it protects is that a withheld scorecard dimension draws **no
row**, which its own third assertion already states
(`not.toMatch(/>Growth<\/td>|>Demand<\/td>/)`); a row that is not drawn has no
cell to hold a placeholder. The risk register is the opposite case — the row
cannot be omitted, because the risk is real — so it now asserts that every
"Not assessed" sits in the exposure column. Verified by probe: both
occurrences are the risk rating cell, muted `#ADA18E`, with an empty bar cell
beside them.

### W4.11 · An absence may not be rated — on a COLOUR either — **done**

The rule `PLANNING_CONTROLS_IN_THE_REPORT.md` §9 closed as a statement, and
`withholdRatedAbsenceCharts` closed for a chart, committed a third time in the
one place neither could look: the colour of a word.

`severityFromRating` returns `null` for a rating it does not recognise —
deliberately, under its own comment, *"so the bar is omitted rather than drawn
at a length that states a severity nobody assessed."* The colour derived from
that severity is used **twice**: for the bar, and for the rating WORD's own
text colour in the row's third cell. `severityColour(null, …)` returned
**`caution`**.

So the bar was correctly withheld and the word was printed in the caution
colour anyway — **`NOT ASSESSED` set in the same amber as `MODERATE`**, and
`Noted`, which is what the Compass master passes, in the same amber again. One
function guarded the absence and the next one below it undid the guard.

Two things make it certain rather than arguable. **The chip display already had
it right** — `ratingChipHtml` falls back to `Neutral` for an unknown rating —
so the two displays of one register disagreed, which is this programme's
recurring tell. And the fix needs no new colour: `mutedColor` was already
resolved eight lines above and simply not passed.

It is a renderer change, so it reaches every stored report on its next render
and needs no seed. The spec renders the bars display at each of
`RISK_EXPOSURE_LEVELS` and asserts `Not assessed` is the only level that scores
nothing, that it prints muted, that it still prints the WORD (an absence is a
reading), and that every other level keeps its bar. Its colours are the real
`resolveReportPalette({})` rather than four literals.

### Verified as INK, not only as a schema

Everything above this line was verified in the source, the seed and the
geometry gate. The rendered document was then read, and three things confirmed
on the page rather than inferred from it:

**The risk register now says the platform's own word.** From the PDF:

```
RISK                RATING          CONFIDENCE    WHY IT MATTERS
Interest rate       Not assessed    Indicative    High LVR (80%) increases ...
sensitivity
```

**The running head fits at the corpus maximum, using exactly its reserve.**

```
Investment Compass · Apartment 1204A, 'Waterline    Residences',    Why This Location Matters
145-149 Marine Parade, Kingscliff, NSW 2487
```

Two lines against a two-line reserve, nothing clipped, the whole 84-character
address present. The confirming run at that exact length: *"no block overflows
its page, and none prints over another, in any of the 710 renders."* Worth
recording that the reserve is **exactly consumed** at the maximum — there is no
headroom, so a longer address or a wider document label would be the first
thing to overflow it.

**And the Opportunities callout had never been rendered by anything.** The
geometry gate could not see it: its PDF is written once per family reference
and overwritten per tier, so the artefact on disk is whichever tier rendered
LAST, and that tier's page set excludes the page this block sits on. So a
block that CHANGED TYPE in v19 was verified in the seed (34 schemas carry
`"title":"Opportunity"`, 0 carry `"term":"Noted"`) and in the geometry, and
not once as ink. `opportunityCallout.spec.ts` closes that: it renders every
Compass master against a record that holds an opportunity and asserts the text
appears, against one that holds none and asserts nothing is drawn — the 98%
case, since `opportunities` is empty on all but **19 of the 985 scored
reports** — and that no master anywhere reintroduces `Noted` or any other word
outside the four-level exposure vocabulary.

### W4.10 · The field accent was judged at the wrong size — **done**

**And the `#D5A220` residual was wrong in the opposite direction.** It was
recorded as *"a raw hex at 8pt, from a master binding rather than the
palette"*. It is neither raw nor a defect: it is exactly
`ensureContrast('#AD831A', field, 7)` — the colourway path's own correctly
corrected value, at **7.00:1**. Chasing it found the real fault next door.

`accentOnField` is derived in **three** places, and the odd one out is the one
serving a tenant's own brand colour:

| path | floor |
| --- | --- |
| `templateColourways.pure.ts` — the 500 seeded masters | `PRINT_SMALL_TYPE_CONTRAST` = 7 |
| `designSystem.ts` — the 43 voice templates | `PRINT_SMALL_TYPE_CONTRAST` = 7 |
| `brandResolve.pure.ts` — a tenant brand hex, and every route that resolves a palette rather than reading a stored one | `CONTRAST_FLOOR.display` = **4.5** |

`roles.pure.ts` declared `display` for it too — **directly under a docstring
reading "the cover eyebrow and rule"**. §2 puts an eyebrow in the `< 10pt`
band at 7:1 and names this exact case: *"It fails at the 8.5pt eyebrow that is
the brand's own signature."* `.eyebrow` is set at `type.caption`, which is
**8.5pt**. The role's own comment described the case that made its floor
wrong — and it was the only FIELD role out of step, since `onFieldInk` is
`body` and `mutedInk` and `accentOnPaper` are `micro`.

Measured over the catalogue's hundred approved accents resolved through
`brandResolve`: **89 of 100 sat between 4.5 and 4.7:1** on the field, while the
identical element on paper sits at 7.83 through `accentOnPaper`. One element,
one size, two floors.

Three things bound it. **The 500 masters never changed** — they store a value
already derived at 7, which is why the delivered document's own eyebrow was
fine and why this reached no seeded report. **The default is byte-identical**:
`PRINT_BRAND.onField` is `#D9A520` at 7.26:1, so it already cleared the
stricter floor and passes through uncorrected, asserted as the pass-through
rather than as a literal. And **no accent changes hue** — `ensureContrast`
walks lightness only, asserted over all 100 at a stated 2.5° tolerance rather
than promised.

**W4.5 · Cover** — the verdict block at 11pt against a 41pt address.

**W4.6 · Debris** — the four empty bullets are **done**; the stray "1" is
**unattributed and deliberately not fixed**.

A list marker is drawn from the list STYLE rather than from the item's
content, so an item holding nothing still prints its dot and still takes its
line — which reads as a list whose entries failed to load. Driven through the
real read path, every one survived to the end: `stripPlaceholderRows` judges
table rows, `stripEmptyStatCards` judges stat cards, `dropEmptySections` judges
headings, and an item inside a list is none of those. `stripEmptyListItems`
sits directly above `dropEmptySections`, so a section it empties is collected
by the rule that already exists for that.

It is not the prose scrub §8 forbids for a stronger reason than the footnote
rule could give: **there is no prose** — no word, no figure, no claim, no
source — so there is nothing for it to change. Three bounds: an empty parent
with indented children is KEPT (removing it would strand them), a task list has
content after its marker, and code is a quotation — the partition is
`printableGlyphs.pure.ts`'s, imported rather than re-implemented.

**The stray "1" I could not attribute.** The obvious candidate was residue from
a withheld chart, since page 16's `{{bars: General Residential Zone (GRZ) 1
…}}` is one of the flag charts W1.3 withholds. Executed against the real read
path, it is not: both flag bars are withheld whole with no residue at all, and
the `{{margin:}}` beside them loses its `spark=` and keeps its note. So the
digit comes from somewhere in the model's prose that I cannot name, and a rule
for a lone digit would be invented rather than derived — which is what the
footnote work took two attempts to learn. Recorded, not guessed at.

**W4.7 · No database vocabulary in a client document.** `osm_amenity_register`
is printed in prose on page 34. The AML module already forbids underscore-cased
identifiers in rendered fields and has a test for it; port the rule.

**W4.8 · Glyph coverage.** ✅ **DONE** — and the premise is measured rather
than inferred from the PDF. `fontTools` over all nine faces
`weasyprint-service/fonts/` ships, 21 Sep 2026:

| code point | Cinzel (2) | Playfair (4) | IBM Plex Mono (3) |
| --- | --- | --- | --- |
| `U+2011` non-breaking hyphen | absent | absent | absent |
| `U+2010` hyphen | absent | **present** | absent |
| `U+2013` en dash | present | present | present |
| `U+2014` em dash | present | present | present |
| `U+002D` hyphen-minus | present | present | present |

**Nine of nine lack `U+2011`; five of nine lack `U+2010`.** So a non-breaking
hyphen anywhere in a heading, a display line or a figure run is drawn by
whatever fontconfig reaches for — one hyphen in a different typeface from the
words either side of it. The body face is Debian's `fonts-inter` rather than
this repository's, and does not need measuring: the three families above set
every heading, every display line and every figure in the document.

`printableGlyphs.pure.ts` sets five dashes as ones the faces hold, LAST in
`presentStoredMarkdown` because it is the only pass there that works on
characters — running it earlier would mean every other pass read a document
one character different from the one the generator wrote.

**It is not the prose scrub §8 forbids**, for two reasons that are checked
rather than argued. It **changes no word**: `U+2011` and `U+002D` are the same
character to a reader, and what differs is a line-breaking instruction already
lost, because a glyph the face does not hold is not set by that face. A spec
folds both sides onto the drawable dash and asserts they are identical, and a
second asserts the length is unchanged because every substitution is one
character for one. And it is a **closed set of five**, every one a dash,
listed in one module: nothing about meaning, claim, figure or source is
examined, so there is no sentence it can change and no rule it can be extended
into. The en dash and em dash are deliberately excluded — every face holds
both, this product's prose uses them constantly, and flattening them is what
`documentText.pure.ts`'s `asciiPunctuation` does for the different purpose of
extracting text out of somebody else's PDF.

**Code is a quotation and is never edited.** `IBMPlexMono` is exactly the
family missing `U+2010` as well, so the substitution would matter most inside
a code span — and a code span is somebody else's bytes. An undrawable dash
there is left as written and counted, so it can be reported rather than
repaired. The partition that decides this is asserted to reproduce its input
byte-for-byte over thirteen shapes, including an unclosed fence and a backtick
inside a fence.

**W4.9 · The stale skill note.** ✅ **DONE**, and it was stale three ways, not
one — in the file `CLAUDE.md` names as the thing to read before touching any
PDF generator, which a designer reads and specifies type from.

| §4 said | the image holds |
| --- | --- |
| *"**Cinzel is not installed yet**"* | Cinzel, with a Dockerfile that FAILS THE BUILD without it |
| ships *"Cormorant Garamond, Fraunces"* | neither — no Debian binary package exists, and both were removed from the type stacks entirely |
| *"**Cinzel Bold** and Playfair Display **Medium** are the display faces"* | Cinzel Regular/SemiBold and Playfair Regular/Italic/SemiBold/Bold — **neither of those two weights** |

The third is the one that would have cost something. Those two files are the
`public/fonts/` SCREEN copies; asking the print container for Cinzel 700 gets a
synthetic bold of an inscriptional roman that never had one, and
`typography.pure.ts`'s whole weight table exists to stop exactly that.

**And the file it documents had the same defect.** `PRINT_STACK.cover`'s own
comment read *"Cinzel is the brand's cover face and ships Bold only, which is
why it is confined to the two places set large and short"* — forty lines below
the table that had REMOVED Bold and shipped Regular and SemiBold in its place,
with the reasoning written out. Two statements of one fact, disagreeing, in one
file. The reason now given is the one that was always true and does not depend
on what the image happens to hold: at body sizes an all-caps roman is
unreadable.

Four statements of one fact, then — Dockerfile, weight table, stack comment,
skill file. `reportTypography.spec.ts` already read the first; it reads all
four now.

**Two of the four new gates were vacuous when first written, and running them
against the original text is the only reason I know.** The "not installed"
check matched `[^.\n]{0,40}` and the doc wraps prose, so
`**Cinzel is not\ninstalled yet.**` carries a newline in the middle of the
claim and the regex stepped over it. The (family, weight) check excused any
mention within 200 characters of `public/fonts` — and the offending sentence
was *"Cinzel Bold and Playfair Display Medium (`public/fonts/`) are the display
faces"*, so the excuse sat inside the defect. Both are fixed, both now name
`Cinzel Bold` and `Cormorant Garamond` when run against the original, and the
excuse is now scoped to the **sentence** rather than a window — which also
forced the doc to put its qualification beside its claim rather than in the
next sentence.

---

## 4 · Sequence, and why

```
W1.1 ──> W1.3 ──> W1.4                   the cascade foundation
      (W1.2 withdrawn: the figures already draw)
      │
W2.2 ─┴─> W3.1 ──> W3.2/3.3 ──> W3.4/3.5  evidence, national
      │
W2.3/2.4, W4.*                            presentation, parallel
```

**W1.1 first**, because raw template markup is reaching clients today and it is
the cheapest defect in the document to close. **W1.3 next** — W1.2 was
withdrawn on measurement — because a chart that draws the wrong number is worse
than one that does not draw at all, and both rules land in the read path, which
cascades to every stored report and all ten formats at once.

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

## 5a · Two defects in THIS programme's own new code, found by re-reading it

Both were found by reading the modules shipped earlier today the way this
programme reads everybody else's: looking for a rule that cannot fire, a
fallback that swallows a real case, and a comment the code does not obey.
Neither was caught by its own spec, and in both cases the reason is the same
one this programme keeps recording.

**`provenanceSentence` reported the NEWEST register slice as the oldest.** It
formatted each slice's load date and then sorted the RESULTS — and
`'1 Oct 2026' < '18 Sep 2026'` lexically, so with slices loaded on different
days the newest won. The comment directly above it says *"One date: the
OLDEST slice drawn, because that is the claim the whole table can carry"*, so
the code contradicted its own stated intent, in the one direction that
**overstates** how current a reading is. It sorts ISO and formats afterwards
now. The spec could not see it because its fixture carried a **single** date —
a fixture simpler than production, which is §2's rule at the smallest scale.

**`printableGlyphs`' partition fallback failed OPEN.** When reconciliation
cannot locate a part it returns the whole document as one region, and that
region was marked **prose** — so the substitution would have run inside every
fence and code span in it, silently breaking the one bound the module's header
states as a rule: *"Code is a quotation and is never edited."* It returns the
document as CODE now, so an unreconcilable partition costs the repair and
never the text. The branch is defensive and, from the partition's own
construction, unreachable — but **a defence that fails open is worse than no
defence**, because the header then promises something the code does not do.
It is exported so the branch is exercised directly rather than reasoned about.

Both are pinned by specs verified non-vacuous by reverting the fix.

## 5b · Found on the way, and deliberately NOT fixed here

**Three drift checks exist and nothing runs them, and one of them is
currently failing.** Found while looking for other generated artefacts that
seed v19 might have left stale — the migration object index was one, and
`security` caught it in 50 seconds.

| check | wired into CI | state today |
| --- | --- | --- |
| `reportkit:tokens:check` | yes | pass |
| `reportkit:assets:check` | yes | pass |
| `market:registry:check` | yes | pass |
| `integrations:secrets:check` | yes | pass |
| `migrations:index:check` | yes | pass (after this branch regenerated it) |
| `brand:icons:check` | **no** | pass |
| `mobile:tokens:check` | **no** | pass |
| `mobile:api:check` | **no** | **FAIL** |

`mobile/api-surface.json` reports itself *"out of date with the security
registry"*, and it fails on the PR BASE as well as on this branch — so it
predates this work and is nobody's regression from it. `CLAUDE.md` says both
mobile artefacts "must never be hand-edited" and that "both have `:check`
drift modes", so the intent is plainly that they be checked; nothing checks
them.

That is the unmounted-component class applied to a CI gate: a check that
exists, works, and is wired to nothing — the same shape as `DimensionRail`,
`bd-chip` and `verdict.pricingUrl`.

**It is recorded rather than fixed, for one reason that decides it: the change
could not be verified.** Regenerating the artefact is one command, but it
feeds the Flutter workspace, no gate covers it, and this session has not read
that subsystem. An unverifiable change to a subsystem outside this programme
is the thing this programme exists to stop, so it goes in the list instead.

## 6 · Decisions this plan does not take

- Whether the 21 `market_sources` rows should be seeded — a decision about live
  rows, recorded in `20260921060000`'s header.
- Whether the nine pre-19-Sep reports are regenerated. They are scored on three
  dimensions and would each gain 5–9 points; the owner has said no.
- Whether Risk can ever score. It needs a construction year, held on 0 of 1,230
  stored reports, and `propertyRiskSchema.pure.ts` forbids manufacturing it. Four
  of five remains the honest ceiling.
