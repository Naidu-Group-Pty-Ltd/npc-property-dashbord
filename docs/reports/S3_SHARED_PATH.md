# S3 — the treatment through the shared path, and what that found

The six-page review composed its figures in a script. This stage moves the
approved treatment into `reportBindingProjection.pure.ts` — the authority all
500 seeded masters and both render routes bind — and draws it for all five
report types from those bindings alone. Everything it found, it found by
drawing the page.

---

## 1 · The four readings are published, not composed

`assessmentReadings.pure.ts` separates what one label was carrying:

| reading | binding |
| --- | --- |
| Performance on the criteria that could be measured | `recommendation.measuredScore`, `measuredGrade`, `measuredLine` |
| Evidence coverage | `recommendation.coveragePercent`, `coverageLabel`, `criteriaMeasuredLine` |
| The grade issued, after any cap | `recommendation.grade`, `gradeCapped`, `capExplanation` |
| Whether the evidence supports an overall conclusion | `recommendation.supportsConclusion`, `conclusionLine` |
| The caveat that belongs beside a weight column | `recommendation.weightRoundingNote` |

Three rules. **Nothing is derived that the record does not hold** — every field
is null where its input is missing, and a null publishes no binding, so a master
drops the line rather than printing a hole. **The cap's figure is the engine's
own sentence**, read from `gradeCapReasons`, never re-derived. And
**`supportsConclusion` is true only where a grade issued AND the evidence did
not cap it** — a capped grade is a statement about what was not measured
wearing the shape of a statement about the property, which is the reason the
activation record requires Growth. That rule decides what the document SAYS; it
changes no score, weight or threshold.

Verified on the stored row at every tier: all five bind all four readings.

## 2 · Three defects the shared path had, which the review script could not see

**D11 — `options.tier` reached the content policy and nothing else.**
`projectInvestmentReport(row, { tier: 'financial' })` on a stored Compass
answered `documentTitle: "Investment Compass"` while publishing all thirty
financial bindings. So a condense fork producing a Financial Analysis carried
the **parent's** title, standfirst and `report.tier` on every page while drawing
the child's content — the defect the identity block's own comment says was
closed, reopened by a second reading of the same question ten lines above it.
One resolved tier now; `assessmentReadings.spec.ts` pins it.

**D12 — the scorecard's fourth column bound the criterion's RATIONALE.**
For Yield that rationale IS the modelling ("2.97% gross yield on a $1,490,000
purchase price"), so a tier that withholds modelling drew a labelled blank
cell. Coverage is a fact about the METHOD rather than about the purchase, so
`assessment.N.measuredOn` is published on every tier — "Full method",
"15% of method" — read off `v2.dimensions[].coverage`.

**D12a — and the two lists key the same criterion differently.** `breakdown`
keys it `growthScore`; `v2.dimensions` keys it `growth`. The join is by name
after stripping the suffix, because pairing them by position would put a figure
against the wrong label the first time either list reorders.

**D13 — the Location sentence blamed the customer's evidence for our defect.**
`NOT_ASSESSED_REASON.location` read *"the available location information does
not meet the current verification standard"* for every cause, including the one
S2 traced: readings obtained in full and not carried into the saved assessment.
It is neutral about the cause now — *"no location readings reached this
assessment for the property"* — because a genuinely failed lookup presents
nothing too, and the client sentence may name neither. The operator `detail`
still distinguishes them, and `LOCATION_PRESENTED_UNVERIFIED` is the one case
where the standard really is the reason.

## 3 · Financial content, verified at its destination before it left the Compass

Measured through the projection on the same row:

| tier | financial bindings | assumptions | ten-year series |
| --- | ---: | ---: | ---: |
| compass | 3 | 0 | 0 |
| briefing | 3 | 0 | 0 |
| strategic | 3 | 0 | 0 |
| snapshot | 30 | 4 | 10 |
| financial | 30 | 4 | 10 |

The Compass's three are `purchasePrice`, `weeklyRent`, `annualRent` — facts
about the asset. The thirty are the analysis of a purchase, and they are
present in the Financial report: the rendered page shows the loan amount, the
weekly holding position and the year-ten equity projection drawn there and
absent from the Compass. **The modelling was verified at its destination
before it was removed from the Compass**, which is the order the owner's
correction requires.

## 4 · The harness is one implementation now

`_reviewKit.mts` carries the three passes both scripts need — measure on the
pinned engine, render on the production print contract, then prove the content
survived. Two things it learned:

- **Read the PDF in content order.** `pdftotext -layout` re-flows a page into
  visual columns and interleaves a table's cells, which reported 27 false
  losses. `-raw` follows the content stream.
- **A table row whose cells include a binding is conditional.** The renderer
  drops the whole row when the bound value resolves to nothing, and that takes
  the row's authored label with it. Counting that label as lost content would
  make the check fire on every correct tier separation. A row with no binding
  in it has no such excuse and is still judged.

## 5 · Still open

| | stage |
| --- | --- |
| The six review pages are a review artefact; their prose has not been moved into the masters. | S3 |
| Contents-page destinations, folios and bookmarks through the real Templates workflow. | S3 |
| The `image` block emits no `alt`, so a report declaring `pdf/ua-1` does not conform. Reproduced on every render here. | S3 |
| `_chips.html.ts` palettes read no token. | S3 |
| Report selection, editing, saving, reopening, previewing and exporting exercised end to end. | S5 |
| The ten-year outlook's wider source work. | S4 |
