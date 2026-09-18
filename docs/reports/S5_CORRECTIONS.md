# The five S5 corrections

*Module: [`_shared/reports/investment/strategyPositions.pure.ts`](../../supabase/functions/_shared/reports/investment/strategyPositions.pure.ts)
and [`market/marketFactBlocks.pure.ts`](../../supabase/functions/_shared/reports/market/marketFactBlocks.pure.ts).
Spec: `src/lib/reports/__tests__/s5Corrections.spec.ts` — one `describe` per
correction, each test named after the sentence it retires.*

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
contribution"* — name no dimension, no score, no nominal points, no evidence,
no calculator and no grade treatment. A reader cannot tell whether "soft" is 13
out of 100 or 45, nor that the dimension carries 21 of the score's 100 points,
nor that two of five dimensions were not scored at all.

**Every one of those facts is in `investment_score.breakdown`, and no surface
read it.** 18 Annabelle Crescent, read 18 September 2026:

| dimension | score | nominal | delivered | evidence |
| --- | ---: | ---: | ---: | --- |
| Capital growth | 56/100 | 57 | 31.9 | five-year 6.2% p.a.; three-year 4.4%; twelve-month 6.3%; 3 of 3 periods rose; −1.4 points against NSW |
| Rental yield | 23/100 | 21 | 4.8 | 2.97% gross on $1,490,000 |
| Demand | 13/100 | 21 | 2.7 | −0.4% annual population growth, Kellyville – East |
| Property risk | — | — (excluded) | — | no property-specific risk measurement is available |
| Location | — | — (excluded) | — | no location input met the verification standard |

31.9 + 4.8 + 2.7 = **39.4**, and the stored total is **40**. The whole score is
reconstructible from the breakdown, so the four lists add nothing a qualified
reading does not say better — and they are no longer drawn in any quadrant.
`composeScoreDimensionTable` draws the table above instead, names the
calculation owner, states the coverage ("Partial score: 3 of 5 dimensions",
70% of the nominal points) and says explicitly that **an excluded dimension is
not a low score**.

*One authorised exception.* The approved allocation permits the Compass "one
authorised gross-yield reference within the grade rationale, if required". The
yield row carries 21 of the 100 nominal points and dropping it would misstate
the score, so it stays — and a test asserts the Compass contains **exactly
one** gross-yield figure and that it falls inside the grade-rationale table.

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

Every correction above is **implemented and tested**, and **visually verified**
in the two review PDFs. None is **released**: no report has been generated with
this code, so the interaction between these composed sections and the
model-authored prose around them is unverified, as is the page flow through the
template renderer. See [`S5_EXECUTION_ROUTE.md`](./S5_EXECUTION_ROUTE.md) for
why, and what unblocks it.
