# The S5 corrections

*Modules: [`_shared/reports/investment/strategyPositions.pure.ts`](../../supabase/functions/_shared/reports/investment/strategyPositions.pure.ts),
[`market/marketFactBlocks.pure.ts`](../../supabase/functions/_shared/reports/market/marketFactBlocks.pure.ts),
[`market/scoreAssessmentReading.pure.ts`](../../supabase/functions/_shared/reports/market/scoreAssessmentReading.pure.ts)
and [`risk/propertyRiskSchema.pure.ts`](../../supabase/functions/_shared/reports/risk/propertyRiskSchema.pure.ts).
Specs: `src/lib/reports/__tests__/s5Corrections.spec.ts` — one `describe` per
correction, each test named after the sentence it retires — and
`riskModelD.spec.ts` for § 3a.*

---

## 1 · The accepted CGR is not market evidence

**What was wrong.** The composer said *"The projection runs on the measured
rate rather than an assumed one: 6.2% a year"* whenever the accepted CGR and
the register's own figure agreed to within 0.05 points. They agree on **both**
subject properties. Agreement is not derivation: the accepted CGR is an input
recorded through the override workflow **before** the report is generated, and
the register figure is a measurement of what the market did. Nothing on either
record says the first was taken from the second, so the sentence invented a
provenance. The holding strategy compounded the error with *"Taken from …the
measured rate for this market"*.

**What it says now.** The two labels the owner set, side by side, always:

> **Accepted CGR assumption used by the financial model:** 6.2% a year,
> recorded through the override workflow before this report was generated and
> carried unchanged into the loan, the cash flow and the ten-year projection.
> **Historical market growth observed in the approved register:** 6.2% a year
> — NSW Department of Communities and Justice … They are separate facts from
> separate sources; nothing on this record states that the assumption was
> derived from the measurement, and the two agreeing does not make it so.

**The regression test.** `MARKET EVIDENCE CANNOT OVERWRITE THE ACCEPTED CGR,
THE CASH FLOW OR THE PROJECTIONS` sets the register to 6.2% and the accepted
assumption to 3.0%, then asserts the exit table compounds at **3.0%**
($1,727,318 at year five, $2,002,435 at year ten) and that the figures 6.2%
would have produced appear nowhere. Two more tests assert no composer mutates
the finance record, and that neither `generate-investment-report` nor
`fork-investment-report` assigns `capitalGrowth` from anything market-shaped.

---

## 2 · Transport — the radius, traced end to end

**What was wrong.** The composer printed *"117 public transport stops within
one kilometre"*. It read `location_intelligence.transport.stopsWithin1km`
directly, and that field's own documentation, in `transportReading.pure.ts`,
says:

> DEPRECATED NAME, KEPT FOR COMPATIBILITY. The value is the count within
> `radiusMetres`, which is 1,600 — not within one kilometre. … Nothing new
> should read it: ask `transportCountReading()`.

**The trace.** Provider → persistence → scoring → rendering, re-measured
against `transport_stops` at the verified coordinate (−33.7115485, 150.9586199)
on 18 September 2026:

| stage | value |
| --- | --- |
| provider | Transport for NSW Open Data (CC BY 4.0), GTFS `stops.txt`, feed `nsw_sydney` |
| feed loaded | 2026-09-07 05:22:15 UTC, 171,061 stops written |
| configured radius | `NEARBY_RADIUS_M = 1_600` |
| raw stop rows within 1,600 m | **239** |
| boarding **places** within 1,600 m (station + platforms = one) | **116** (the row stores **117**) |
| boarding **places** within **1,000 m** | **51** |
| nearest boardable stop | **105.9 m** (the row stores `distanceToStation: 0.1` km) |
| stored key | `stopsWithin1km: 117` — the 1,600 m count under a 1 km name |

So the sentence overstated the density **within its own stated radius by 2.3
times**: 117 against the 51 that are actually within a kilometre. The 116/117
difference is one place between this re-count and `groupToPlaces`; the product
states the row's own 117 and this document records the independent re-count
rather than quietly replacing it.

**What it says now**, stating the exact source, radius, unit, date and
measurement definition:

> **117 boarding places within 1.6 km straight-line.** Transport for NSW Open
> Data (CC BY 4.0). Counted from the operator's own published stop file:
> straight-line distance from this property's verified coordinate, with a
> station and its platforms counted as one place. The feed was last loaded on
> 2026-09-07; the count is as at that date. Nearest boarding place: Windsor Rd
> Before President Rd, 0.1 km straight-line. It does not establish mode,
> service frequency, walking distance or travel time — …

**Two supporting changes.** `loaded_at` now travels: the column always existed
and nothing selected it, so a reading stated its source and its radius and
never said *when* the data behind it was current. `StoredStop.loaded_at`,
`TransportReading.feedLoadedAt` and `StoredTransportBlock.feedLoadedAt` carry
it, and a row without one prints *"When the feed behind this count was loaded
is not recorded on this reading."*

**A register count of stations is never public transport access.** On
262 Pallas Street the stored block is
`{ source: 'osm_amenity_register', stationsWithin2km: 0, nearestStation: null }`
— one amenity category from a community-edited register, not an operator's stop
file, and no loaded timetable feed reaches Queensland outside the south-east.
The page says exactly that and draws no conclusion either way.

---

## 3 · Score language — every statement fully qualified

**What was wrong.** The four free-text lists on `investment_score` —
*"Measured demand in this market is soft"*, *"Measured capital growth in this
suburb is strong"*, *"Below average rental yield may require owner
contribution"* — name no dimension, no score, no weight, no evidence, no
calculator and no grade treatment. A reader cannot tell whether "soft" is 13
out of 100 or 45, nor that two of five dimensions were not scored at all.

**Every one of those facts is in `investment_score`, and no surface read it.**

### The correction to the correction

The first replacement table read the stored `breakdown[].weight` values
**57 / 21 / 21** as the dimensions' NOMINAL points and `coverage.weightCovered`
as a share of them. Both are the same mistake — **reading a renormalised figure
as a nominal one** — and together they hid the fact that the grade was capped.
It also produced arithmetic that did not foot: 31.9 + 4.8 + 2.7 = 39.4 against
a stored total of 40.

The engine renormalises. `COMPOSITE_WEIGHTS` is growth .40, location .25, yield
.15, demand .15, risk .05; where a dimension is not scored its weight is
redistributed across the ones that are, and it is the ADJUSTED weight the
stored integer records. 18 Annabelle Crescent, report `9bd41c05`, read
18 September 2026:

| dimension | score | original weight | adjusted weight | contribution | points delivered |
| --- | ---: | ---: | ---: | ---: | ---: |
| Capital growth | 56/100 | 40% | 57% | 32.00 | 22.40 |
| Location | — | 25% | — (not scored) | — | — |
| Rental yield | 23/100 | 15% | 21% | 4.93 | 3.45 |
| Demand | 13/100 | 15% | 21% | 2.79 | 1.95 |
| Property risk | — | 5% | — (not scored) | — | — |

* **Composite 40.** 32.00 + 4.93 + 2.79 = **39.71**, rounded **once**, on the
  sum. The 39.4 above is what rounding each part first gives, and the adjusted
  weights printed as whole percentages are themselves rounded — the engine
  multiplies by the exact fractions. The same reconstruction gives Pallas
  44.00 + 11.36 + 7.50 = **62.86 → 63** against the stated 63.
* **Grade the composite alone gives: C.**
* **Points delivered 27.80 of 100** (22.40 + 3.45 + 1.95), which supports
  **F** at most. That is the ceiling `gradeEligibility.pure.ts` applies:
  unmeasured weight discloses and caps, and never lifts.
* **Grade issued: F** — capped, which is the reading S1 reported and the table
  had lost.

`scoreAssessmentReading.pure.ts` reconstructs all eight readings from the
stored score and `composeScoreDimensionTable` draws them, with the evidence as
a labelled list rather than a seventh column (the growth cell on this record is
600 characters, and a print column cannot carry it).

### What the record does not retain, and is therefore never guessed

Two figures the engine computes are not persisted:

* **`evidenceCoverage`** — Σ(nominal weight × that dimension's OWN methodology
  coverage). It is the **57%** S1 reported, and it is *not*
  `coverage.weightCovered` (0.70), which counts a dimension scored on 15% of
  its inputs as a whole dimension. The per-dimension coverage is not on the
  row, so the reading names it as not retained and states the coarser figure
  beside that admission rather than in place of it.
* **the growth eligibility ceiling** — the A/A+ gates read growth confidence
  and growth's own weight coverage, neither stored. The nominal ceiling is
  reconstructible and is what the table states; where the two differ the
  stricter binds, so the issued grade may be lower and never higher.

`PersistedAssessment` is the forward-only shape that closes both. No stored row
is rewritten.

### All five dimensions, always

The card reads **"Partial score: 3 of 5 dimensions"**. Two dimensions are
unscored and they are unscored for different reasons.

**Location is a defect, already fixed and not yet released.** The engine's own
sentence — *"No location inputs could be measured for this property"* — is
false about every record in this deployment. All nine stored reports that carry
an RF-7.2B acquisition stamp record `places: complete` and `commute: measured`,
six amenity categories answered by the register, a matched address and a
subject key; and all nine carry **no `walkScore`, no `commute` and no
`schools.schoolsWithin3km`**. The readings were taken. The Client-Safe Gate
removes exactly those three paths, the generator persisted the gated object,
the acquisition stamp survived the removal untouched, and `assessEnrichmentReuse`
then re-served the stripped copy on every resume — so Location scored on an
enrichment with nothing left in it to verify, and the remedy the report printed
("regenerate the report") reproduced the same result. Commit `c0c7575` closes
both halves: the generator keeps `measuredLocationIntelligence` back from the
gate, and the reuse guard refuses an object whose stages ran but whose readings
are gone. **It is on this branch and not on `main`**, which is why the
17 September records still read 3 of 5.

**Risk is a recorded platform position, not a defect.** See § 3a.

*One authorised exception.* The approved allocation permits the Compass "one
authorised gross-yield reference within the grade rationale, if required". The
yield row carries 15 of the 100 nominal points and dropping it would misstate
the score, so it stays — and a test asserts the Compass contains **exactly
one** gross-yield figure and that it falls inside the grade-rationale table.

---

## 3a · Why Risk is still not scored, and the one decision that is not ours

`propertyRiskSchema.pure.ts` declared every property-risk question `not_held`
on evidence measured 8 September 2026. Two of those declarations have since
gone stale, and correcting them does **not** make Risk scoreable — which is the
finding worth recording.

**What changed.** The planning programme closed the retrieval gap.
`planning-data-service` reads the jurisdiction's own layers at the verified
coordinate; NSW answers the LEP, the zone, heritage, bushfire, flood, landslide
and acid sulfate soils, each with the clause that creates it and its own
currency date. Report `9bd41c05` carries a real reading — `R2 — Low Density
Residential`, NSW Principal Planning Layers, CC BY 4.0, effective 2026-08-07,
retrieved 2026-09-17T08:58:23.845Z. So `site_hazard_exposure` and
`planning_constraints` **are** held at parcel grain.

**Why that is still not an answer.** A retrieved control is a fact; a 0-100
safety score is a rating, and no publisher issues one. Turning "Zone R2, no
overlay returned at this point" into `site_hazard_exposure: 78` invents the
scale — which is `PLANNING_CONTROLS_IN_THE_REPORT.md` § 9's defect exactly
("an absence may not be RATED"), committed under a different heading. The two
questions therefore move to a new `EvidenceAvailability` of
**`held_but_unscoreable`**: named on the page as evidence, contributing nothing
to a score, and off the acquisition backlog because what is outstanding is a
published scale rather than a dataset. `unscoreableHoldings()` is that second
list, and `answerableCount()` stays **0** for all four asset classes — a
capability nothing delivers may not be declared.

**And a scale alone would not be enough.** Hazard and planning are ONE
independent category (`site`) in `riskModelD.pure.ts`, and
`MINIMUM_INDEPENDENT_CATEGORIES` is 2. That grouping is deliberate and stays:
two readings that are present or absent together — if the state's portal
answers, both answer; if it does not, neither does — are one retrieval, not two
independent observations. The only other category an established house's schema
offers is `building`, which needs a construction year or an inspection.
Measured 18 September 2026 over all **1,230** stored reports, `property_specs`
carries `yearBuilt` on **0**, `buildYear` on **0**, `constructionYear` on **0**
and `yearOfConstruction` on **0**.

**What the report says instead.** `riskRemedyFor()` derives the remedy from the
schema rather than restating it. The literal it replaces read *"Answered
property-risk questions from the per-class schema (hazard, planning, condition,
strata)"* on every record — naming hazard and planning as outstanding when both
are retrieved, and naming strata on a house that is never asked about an owners
corporation. A remedy that misdescribes the platform's own holdings sends
somebody to buy what it already reads.

**The decision, which is the owner's.** Reaching five scored dimensions needs
one of:

1. a **building-condition signal** at property grain (construction year is the
   cheapest — it is a cadastral/valuation attribute, not an inspection), which
   opens the `building` category and makes Risk scoreable for houses and units
   alike; or
2. a **published scale** for the site controls, plus a second category anyway;
   or
3. a deliberate change to `MINIMUM_INDEPENDENT_CATEGORIES`, which would let one
   site observation become the whole Risk dimension — the renormalisation
   `riskModelD.pure.ts` exists to prevent.

Nothing here takes that decision. Until one is taken, the honest maximum is
**four of five scored**, with Risk present on every page carrying its original
5% weight, its reason and what would close it.

---

## 4 · An evidence window is not a holding requirement

**What was wrong.** *"A horizon at least as long as the evidence: 5 years"*,
listed under *What holding this asset requires*. That turns the length of a
published series into an instruction to a person, and no report here holds the
circumstances that could support one.

**What it says now.** *"Awareness that the growth evidence covers 5 years, and
no longer"* — framed as a risk and monitoring consideration about the
**evidence**, closing with *"This report does not establish how long anybody
should hold the asset, and nothing here should be read as saying so."*

---

## 5 · A sales count is not liquidity, and an absence reassures nobody

**What was wrong.** Three things. The exit section called 162 settled sales
*"the depth of the buyer pool an exit would be tested against"* — a liquidity
claim a settled-sales count cannot support. The suitability profile raised a
requirement from it, *"Tolerance for however long an exit takes in a market of
this depth"*. And the heading was *"Resale liquidity — measured"* over a
figure that measures no such thing.

**What it says now.** The heading is *"What the market recorded"*; the section
opens by stating that neither half answers *how easily this sells*; and the
entry reads:

> **162 dwellings settled in the latest published quarter.** … a count of
> completed transactions at the geography and dwelling split named — not at
> this street, and not a measure of liquidity. **Days on market, time to sell
> and buyer depth were not measured for this market**: no publisher in the
> approved register issues them at this geography, and nothing here estimates
> them.

No requirement is raised from it. Where the register answers nothing at all,
the section says *"Nothing is estimated in their place, and their absence is
not evidence that the market is thin, deep, slow or fast."*

**A property fact is not a market record.** The lot size sat inside that list,
which also meant a record with no market rows still printed "What the market
recorded" over one line about the land. It is now stated separately as a
property fact, and the empty-register branch can actually fire.

**Engineering diagnostics leave the client document.** The market block printed:

> **Asked and could not answer.** Domain: Operation not permitted on project —
> no API package is attached to the Domain project this key belongs to

A vendor's internal refusal string, a statement about an API package and the
existence of a key — none of which means anything to a reader, and the last of
which should not be shown to one. The fact a reader needs is that a source was
asked and did not answer, so that is all the page states; the reason stays on
the structured evidence record, where an operator reads it, and a test asserts
both halves.

---

## What this does not close

Every correction above is **implemented and tested**, and the grade-rationale
block has been **read as rendered Markdown**. None is **released**: no report
has been generated with this code, so the interaction between these composed
sections and the model-authored prose around them is unverified, as is the page
flow through the template renderer. See
[`S5_EXECUTION_ROUTE.md`](./S5_EXECUTION_ROUTE.md) for why, and what unblocks
it.

Two further things stay open and are named rather than absorbed:

* **Location scores four of five only once this branch is released.** The cause
  is closed in `c0c7575` and `main` does not carry it, so every report
  generated today still stores a gated enrichment and still reads 3 of 5. The
  repair reaches a stored report when it is next generated; no migration
  touches a row.
* **The fifth dimension needs an acquisition or a decision** — § 3a states the
  three options and takes none of them.
