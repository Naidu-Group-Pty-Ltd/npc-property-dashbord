# S5 — the Executive Briefing and the Snapshot, drawn for the first time

The last two of the five client reports come out of
`condense-investment-report`. Unlike the fork's pair they need **one model
call each** — the condensed prose — and everything that happens to that
answer afterwards does not: the recorded-facts block, the composed financial
chapters, the score breakdown, the SWOT, the verdict, the registry trim, the
declared-order assembly and five hygiene passes.

All of that lived inside the function's `index.ts`, so, exactly as with the
fork, it could not run outside a deployed Deno runtime and neither document
had ever been drawn and read. `condenseCompose.pure.ts` is that code, moved
verbatim with three changes and no fourth: the handler's `parentReport.*`
reads became inputs, `postProcessReportMarkdown` is imported statically
rather than dynamically, and `runQAValidation` stays in the handler, because
validating a document is reporting and not composing it.

`npx tsx scripts/reports/s5CondenseReports.mts` produces both tiers for both
subjects and draws each through the supported template path —
`compileTemplateHtmlForPdf`, then WeasyPrint on the six options the
production route sends.

---

## 1 · The one stand-in, and why it is a fair one

A model call cannot be made from this sandbox, and buying one would spend a
forwarded vendor credential on a verification run. The prose is therefore
stood in for by `scripts/reports/_condenseStandIn.mts`, which is **named on
every run** rather than left indistinguishable from a real answer.

It **copies the parent's own blocks whole**. Every sentence, table row and
figure it returns was written by the model that wrote the parent report,
about this property, and is already in the record. It composes nothing,
rewrites nothing and rounds nothing.

That is narrower than a real condensation — a model would rewrite, not
excerpt — and it is deliberately narrower in the one direction that matters:
**it cannot invent a figure**. The single failure that would make a rendered
document lie is off the table, so a number in the output that is not in the
parent is the COMPOSITION's, which is the thing under test.

The tier guides' hard rules bind it as they bind the model. It writes no
financial table and no score or SWOT section, because the composition
attaches those from the record. It writes only the tier's declared headings,
and **omits** one it has nothing to copy for rather than filling it with
"N/A" — which is the guides' own instruction, and what makes the registry
trim and `dropEmptySections` do real work on this run.

**Sections are found by shape, not by spelling.** The two subjects do not
agree on their own headings: Kellyville calls its risk table
`## Risk Dashboard` and Maryborough calls the same thing
`## Consolidated Risk Register`. Pinning one spelling produced a document for
one property and a hole for the other, and the hole read as a composition
defect.

**A section's prose is not always in its body.** `##` splits on every
heading, so a section whose first line is a `###` has a body of only what
sits above it. On Kellyville that is three paragraphs of Executive Verdict;
on Maryborough it is a lone `{{glance: …}}` directive, because every word of
its verdict is under `### Overall Investment Verdict`. The first run produced
a Briefing with no Executive Summary for one property and a full one for the
other, from one mapping. The children are the fallback, always.

---

## 2 · What came out

| | stand-in | composed | sections | characters | pages | PDF/UA-1 |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Kellyville · Executive Briefing | 21,327 | 26,220 | 17 | 26,220 | 20 | pass |
| Kellyville · Snapshot | 2,432 | 3,664 | 8 | 3,664 | 11 | pass |
| Maryborough · Executive Briefing | 18,869 | 23,580 | 17 | 23,580 | 18 | pass |
| Maryborough · Snapshot | 4,065 | 5,313 | 8 | 5,313 | 12 | pass |

Seven sections composed from the record on each Briefing
(`purchaseHolding`, `rentalYield`, `loan`, `sensitivity`, `tenYear`,
`scorecard`, `swot`) and three on each Snapshot (`verdict`, `scorecard`,
`financialSnapshot`). Hygiene removed nothing on any of the four — no
editorial labels, no placeholder rows, no empty sections, no empty stat
cards, no duplicate figures, no unrecorded score claims — which is what a
whole-block excerpt of a Compass-40 parent should give it.

**`Key Market Stats` is omitted from both Snapshots**, and correctly. The
tier asks for OBSERVED market statistics each with the source and date the
report cites, and neither parent carries such a table: both state census
medians (income, age, SEIFA) in prose and neither states a median sale
price, days on market, walk score or a sourced vacancy rate as a sourced
statistic. The guide's own rule is to omit the section rather than write a
placeholder. A model would have had the same material.

---

## 3 · Two defects the drawn pages found

Neither was visible in code, in a test, or in the markdown. Both were found
by rasterising every page and measuring how much of the text box carried
ink.

### A template page has no long edge to turn to

`renderMarkdown` sends a table wider than the portrait measure to
`renderPage('landscape-table', …)` and charges it `LANDSCAPE_BREAK_LINES`
— 38 — for the two page boundaries that page opens. That is right in the
FLOWING route, where the boundaries are real. In the template route a master
page is a fixed box, nothing defines `page-landscape-table`, and the
`<section>` is inert: the table draws portrait, inline, in the space it
always had.

So the charge bought a page break that never happened — and the flag's
default (`landscapeWideTables !== false`, i.e. ON unless denied) handed it to
a path that had never named it. Measured on the Briefing's ten-year
projection, 7 columns by 6 rows: charged **48.8 lines against a 41-line
continuation budget**, so it fitted in **no** bucket. It took a page of its
own at 23% full and stranded its own heading and standfirst on the page
before — `## 10-Year Cashflow, Equity & Growth Projection`, the words "The
recorded ten-year modelling, shown at years 1, 3, 5, 7 and 10", and **93%
white paper**. A promise of a table, with the table on the next sheet.

`markdownBlockContent.ts` passes `landscapeWideTables: false` on both its
`renderMarkdown` calls. The flowing route is untouched.

### The first cell of a row is not a second column head

`renderDataTable` marks it `<th scope="row">`, which is what makes a table
navigable in a tagged PDF, and it carries no class. `styleTags` selected on
the TAG alone, so the row's LABEL took the column head's rule: heading gold,
head weight, and none of the `vertical-align:top` every `td` beside it has.
On a risk register that is the risk's name set in gold, bold, floating in the
middle of a fifteen-line row whose other four cells begin at the top.

The shared print stylesheet already states the rule for this exact element —
"it must not look like the column head" (`reportDesign/css.pure.ts`) — and
the template path was the second implementation without it. `TagStyle` gains
an `attr` qualifier and the more specific rule sorts first, the same way
`figure.chart-compact` already beat `figure`.

### What the two fixes moved

| | before | after |
| --- | ---: | ---: |
| Kellyville · Briefing | 22 pages, worst body page **7%** | 20 pages, worst **46%** |
| Kellyville · Financial | 24 pages, worst body page **8%** | 21 pages, worst **41%** |
| Maryborough · Briefing | 19 pages, worst body page **23%** | 18 pages, worst **31%** |
| Maryborough · Financial | 22 pages, worst body page **23%** | 20 pages, worst **44%** |

Every page under 40% full is gone from all eight documents. What remains
under 72% is the archetype pages (cover, contents, the two dashboards, the
opening), the closing page, and last-narrative-page tails — a section that
ends two-thirds down its final sheet, which is typography rather than a
defect. `markdownBlockTable.spec.ts` pins both rules; checked against the
unfixed code, seven of its eight assertions fail.

---

## 3a · The suite, all ten

`s5CompassReports.mts`, `s5ForkReports.mts` and `s5CondenseReports.mts` all
draw through **one** step, `_s5Render.mts`. That matters for this stage in
particular: ten documents are being compared with each other — page counts,
body fill, PDF/UA-1, whether a defect in one is present in the others — and
that comparison is only sound if every document reached the paper the same
way. The Compass was drawn separately in S1; it is on the shared step now.

| | Kellyville | Maryborough |
| --- | ---: | ---: |
| Investment Compass | 36 pages | 22 pages |
| Financial Analysis | 21 | 20 |
| Due Diligence (Strategic) | 29 | 19 |
| Executive Briefing | 20 | 18 |
| Snapshot | 11 | 12 |

All ten validate as **PDF/UA-1** against veraPDF 1.30.2. All ten are clean of
raw `{{directives}}`, "N/A", "TBD", "not assessed", bare Markdown table
delimiters and stage labels. No body page in any of the ten falls below 40%
fill. What remains under 72% is the archetype pages (cover, contents, the two
dashboards, the opening), the closing page, tall risk-register rows that
cannot split, and last-narrative-page tails.

---

## 4 · Two findings NOT acted on, and why

### `runQAValidation` is called with the wrong tier

`condense-investment-report/index.ts` validates a Briefing and a Snapshot as
**`'compass-40'`**. The validator knows two tiers, `compass-40` and
`financial-analysis`, and neither is a condensed one — so every condensation
in production logs and returns a QA report that **cannot** pass:

* `page-band` — "Estimated 14 pages, below target min 30" on a 12-page tier;
* eleven `financial-exclusion` errors, on the financial chapters the
  composition **deliberately attaches**;
* four to six `missing-protected-section` errors naming Compass sections a
  condensed tier never declares.

Sixteen errors on a correct Briefing, eleven on a correct Snapshot, on every
run. It blocks nothing — the report is logged and returned either way — which
is exactly what makes it the class this programme keeps finding: a check that
always fails is no check, so it can never report a true one.

Not fixed here because the remedy is a decision about the validator's
vocabulary, not a call-site swap: either it learns two tiers (their section
lists, their page bands, and that the financial exclusion does not apply to a
Briefing), or the condense path stops calling it. Recorded for the owner.

### "Five dimensions, weighted" over a table of three

The assessment page's heading states a count the table under it contradicts
on **all eight** documents, and on the Compass too. The data side is correct
and owner-mandated: the 14 Sep rule is that no placeholder reaches a client
document, so an unscored dimension publishes nothing bindable and draws no
row (`reportBindingProjection.pure.ts` records the trade-off). What was not
done is the consequence — the heading was left stating five.

Both subjects score three of five (`location` and `risk` are unavailable on
each), so every document drawn in this stage carries it.

It is a literal in the master schema, so it reaches production only through a
re-seed: **54 rows** carry it — 50 `template_library_entries` and 4 active
`report_templates` (measured 17 Sep 2026). That is the third item riding on
the pending master re-seed decision, after `Weekly rent` → indicative and the
chip `radius`. Not acted on unilaterally.
