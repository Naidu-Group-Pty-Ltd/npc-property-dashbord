# Why the scores cluster near 60

**S5/S6 §5.** Eight hypotheses, each tested rather than assumed, against real
production records and by executing the scorers. Prepared 18 September 2026 on
`claude/adoring-hopper-g02tdt`.

The instruction that shapes this document: *"Treat these as hypotheses to test.
Do not assume every existing penalty or conservative benchmark is a defect.
Correct implementation and data defects first. Measure their effect separately
from any subsequent calibration change."* So each hypothesis below carries a
verdict, and the verdicts are not all "defect" — three are, one is a defect
already fixed, and four are the method working as intended.

---

## 1. What was actually observed

Seven production report rows are held as verification fixtures. Their stored
`investment_score` records read:

| property | score | grade | dimensions scored |
| --- | ---: | --- | ---: |
| 1/27D Mitchell Street (×4 — one property, four report rows) | **62** | B | 3 of 5 |
| 23 MACKAY Street, Moranbah QLD 4744 | **58** | B | 3 of 5 |
| 48 Redfern Street, Cowra NSW 2794 | withheld | — | 1 of 5 |

Two distinct properties, two scores, both in the high 50s / low 60s, both on
three dimensions. (The Mitchell Street repeat is the fork/regeneration pattern
§6 warns about — deduplicating by property gives **two** observations, not
five, and any calibration set has to group them the same way.)

That is a small sample and it is not presented as a distribution. What makes it
diagnostic is that **the mechanism producing both numbers is derivable, and the
derivation reproduces them to the point**.

## 2. The dominant mechanism, derived and then checked

With Growth and Demand unmeasured, the surviving nominal weights are Location
0.25, Yield 0.15 and Risk 0.05, summing to 0.45. Renormalised:

| dimension | nominal | effective when growth + demand are absent |
| --- | ---: | ---: |
| location | 0.25 | **0.5556** |
| yield | 0.15 | 0.3333 |
| risk | 0.05 | 0.1111 |

**A dimension worth a quarter of the matrix becomes 56% of the answer.** And
Location is centred by construction — §3.2 below measures its median at 52
across 224 realistic input combinations, with 62.5% of them landing between 40
and 70.

Put the two together and the composite is pinned:

```
0.5556 × (a Location centred near 52)
  + 0.3333 × Yield
  + 0.1111 × Risk
```

Checked against the two real records, using their own stored component scores:

| property | location | yield | risk | derived | stored |
| --- | ---: | ---: | ---: | ---: | ---: |
| Mitchell Street | 58 | 65 | 75 | 62.2 → **62** | **62** |
| Moranbah | 39 | 80 | 83 | 57.6 → **58** | **58** |

Both to the point. Moranbah is the instructive one: an **exceptional** yield of
6%+ and a strong risk reading still produce 58, because Location at 39 carries
56% of the weight.

The same arithmetic over the measured Location grid gives p25 **47**, median
**54**, p75 **61** — a 14-point interquartile range for the entire spread of
realistic Australian properties. That is the compression, and it is structural
rather than a matter of where any single anchor sits.

## 3. The eight hypotheses

### 3.1 Lost or mis-mapped evidence — **CONFIRMED, and it is the largest single cause**

Growth carries 0.40 of the matrix, and on every record measured it is
unmeasured. That is not a calibration problem; it is the input never arriving.

The code path is correct and wired: `generate-investment-report` reads
`market_sales_medians` through `readSalesRegister` for the trusted geography's
LGA, postcode, suburb or state, and reports its own failure precisely —
*"the register holds no rows for &lt;grain&gt; &lt;area&gt; (load it with
market-sales-ingest)"*. So the remaining question is operational rather than a
defect in this repository: **has `market-sales-ingest` populated the register
for the states these properties sit in?** That needs a production read this
session does not have, and it is the first thing to check, because nothing else
in this document moves the score as far.

Magnitude, computed rather than asserted — the same property with Location 52,
Yield 50, Demand 55 and Risk 75, scored across all five dimensions:

| Growth score | five-dimension composite |
| ---: | ---: |
| 30 | 45 |
| 50 | 53 |
| 65 | 59 |
| 80 | 65 |

The spread is 20 points wide against the 14-point interquartile range the
three-dimension shape produces. **Restoring Growth does not merely add a
dimension; it restores most of the scale's ability to discriminate**, because
the 0.40-weight dimension is the one that actually varies between properties.

### 3.2 Wrong units, periods, geographies or direction — **PARTLY CONFIRMED (geography)**

No unit or direction error was found. Growth anchors are in per cent per annum
and read the right way; yield is per cent gross; commute is minutes; schools a
count. Direction is correct throughout (higher growth scores higher, longer
commute scores lower).

The **geography** half is a real finding. `COMMUTE_ANCHORS` measures minutes to
the capital-city CBD, carries `cbdAccess: 0.40` — the largest of Location's
three weights — and reaches 0 at 110 minutes. Measured, holding everything else
fixed:

```
same property, walk 72, 6 schools within 3 km
  commute  25 min  -> location 66   (cbdAccess 81)
  commute 150 min  -> location 33   (cbdAccess  0)
```

A 33-point swing on one input. Because Location is 56% of the composite when
Growth is absent, **cbdAccess alone is 22% of the entire investment score**,
and it is measured against a geography that describes a metropolitan commuter
property. A regional or mining-town investment is not a failed metropolitan one
— it is a different market with a different thesis — and scoring it against the
distance to a capital city it has no relationship with is the cross-market
comparison §3.7 asks about, landed inside Location.

This is a genuine finding and it is **not** a licence to soften the anchor: the
correct treatment is for the commute component to be measured against the
relevant employment centre, or to carry less weight where no metropolitan
relationship exists, and either is a calibration question for §6 with a
benchmark behind it — not a number to move here.

### 3.3 Defaults or unintended deductions — **CONFIRMED IN V1, ALREADY FIXED IN V2**

The stored V1 records carry `growthScore: 50` and `demandScore: 50` with
`hasData: false, excluded: true`. A **placeholder 50 for a dimension nobody
measured**, sitting on the record beside the real ones. In those rows it
carries `weight: 0` so it did not reach the composite — but it is on the record,
and any reader that averages the breakdown is pulled to the middle by it.

V2 does not do this: an unmeasured dimension scores `null`, carries effective
weight 0, and is named in `unavailable`. `scoringScenarios.spec.ts` and the new
`scorePublicationPolicy.spec.ts` both pin it. **No change needed; recorded
because the stored corpus still contains these 50s and any backtest reading
historical rows must not treat them as measurements.**

### 3.4 Double-penalising one weakness — **CONFIRMED IN V1, ALREADY FIXED IN V2**

The Mitchell Street record's risk detail reads *"Moderate LVR (70-80%). High
negative cash flow ($200-300/week)"*. Both are facts about **the buyer's
financing decision**, not the property, and both were deductions against
Property Risk — one financing choice counted twice, against a dimension it does
not belong to.

V2 separates them structurally: `financeSuitability` and `holdingCashFlow` sit
beside the score rather than inside it, and `scoringV2Production.spec.ts`
asserts by execution that changing LVR from 60 to 95 and weekly cash flow from
+120 to −900 leaves the grade, the total and the whole breakdown identical.
**No change needed.**

### 3.5 Benchmarks from a selected sample treated as market-representative — **CONFIRMED, twice, in the code's own words**

§6 states the rule: *"the platform's own sample median must not define 'average'
or 'strong'."* Two anchor sets are calibrated on exactly that.

**Yield.** `GROSS_YIELD_ANCHORS`' own header: *"Calibrated to the corpus rather
than to intuition: the measured median gross yield across the stored reports is
**4.36%**, p75 **5.49%**"* — and the 50-point anchor is placed at 4.36%.

**Location walkability.** `WALK_ANCHORS`' own header: *"The anchors put the
corpus median (94.5) near the middle of the OUTPUT range."*

In both cases the reasoning given is sound on its own terms — an input scale
that puts two thirds of a corpus in one band carries no information, and
stretching the anchors where the data lives is the right instinct. What is
wrong is **which** distribution was used. NPC's stored reports are not a sample
of the Australian residential market; they are the properties NPC was asked to
write about, which is a selected book weighted toward the stock this business
sources. Anchoring the middle of the output scale to the middle of that book
**forces the typical NPC property to score 50 by construction**, whatever it is
actually like — which is a compression mechanism in the most literal sense.

Measured, the Yield anchors discriminate perfectly well *once you accept where
the centre sits*: 2.84% → 21, 4.36% → 50, 6.07% → 81, 8.67% → 99. The curve is
fine. **The question is only whether 4.36% is the market's middle or this
book's middle**, and that is answerable only against an external published
benchmark. §6 requires the benchmark to carry its geography, dwelling type,
period and sample limitations, so **no anchor moves here** — sourcing that
benchmark is the first task of the calibration work, and the same applies to
the walk-score distribution.

### 3.6 Anchors requiring exceptional outcomes — **NOT CONFIRMED for Growth and Yield; CONFIRMED for walkability**

Growth's `LONG_TERM_ANCHORS` read 6% p.a. → 65 and 8% p.a. → 79. Against
long-run Australian dwelling price growth those are reasonable, arguably
generous, and certainly not a scale that demands exceptional outcomes for a
middling score. Yield, as measured above, reaches 81 at 6.07% and 99 at 8.67%.
Neither is compressed.

Walkability is different: a published walk score of **95 — the top of the
practical range — scores 70**, and 88 scores 50. That is the §3.5 anchoring
expressed as a ceiling, and it is the same finding rather than a second one.

Two anchor sets place a perfectly ordinary reading at exactly 50 —
`TRAJECTORY_ANCHORS` (three-year rate equal to five-year rate → 50) and
`RELATIVE_ANCHORS` (matching the wider market → 50). Those are **correct**: a
property growing exactly in line with its market genuinely is average on that
measure, and 50 is the honest answer. Recorded so a later reader does not
mistake them for placeholders.

### 3.7 Inappropriate cross-type, cross-market or cross-method comparison — **CONFIRMED (same finding as §3.2)**

The commute-to-capital-CBD component is the instance, and it is described
there rather than twice. No cross-dwelling-type defect was found: the evidence
contract carries `dwellingType` and `dwellingTypeMatched`, growth confidence
discounts an unmatched type, and the sales register's grain is priced
explicitly (an LGA point scores 55 on the geography factor, a postcode 80, a
suburb 100).

### 3.8 A genuine fundamentals-versus-suitability distinction — **CONFIRMED, and already implemented**

Some of what looked like harshness is the product correctly declining to score
the buyer's position into the property. `financeSuitability` (leverage, serviceability)
and `holdingCashFlow` are separate readings beside the composite. This is the
distinction the hypothesis names, it is real, and it is why the V1 records'
risk scores read high while their verdicts read cautious. **No change.**

---

## 4. What follows, in order

The instruction is explicit that implementation and data defects are corrected
first and measured separately from calibration. That ordering is not a formality
here — it changes what the calibration work is even looking at.

1. **Establish whether `market_sales_medians` is populated for the states in
   the corpus** (§3.1). This is a production read, not a code change. If it is
   empty or stale, loading it is the single largest correction available and
   every measurement below has to be retaken afterwards, because a
   three-dimension shape and a five-dimension shape are different scales.
2. **Then, and only then, measure the distribution again.** A calibration
   fitted to the three-dimension shape would be fitting the absence of Growth.
3. **Source external benchmarks** for gross yield and for the walk-score
   distribution (§3.5), with geography, dwelling type, period and sample
   limitations recorded. Until those exist, the anchors stay where they are and
   this document says why — which is §6's own instruction: *"If an anchor change
   cannot be justified, retain the existing mapping and explain."*
4. **Treat the commute component as a calibration question** (§3.2), framed as
   "which employment centre, and how much weight where none is relevant" rather
   than "make the penalty smaller".

Nothing in §3.3, §3.4, §3.6's trajectory/relative anchors or §3.8 needs a
change. Recording that is part of the finding: **four of the eight hypotheses
describe the method working**, and treating every conservative reading as a
defect is how a calibration becomes a thumb on the scale.

## 5. What this document does not claim

- **It is not a distribution.** Seven fixture rows, two distinct properties. The
  mechanism is derived and checked against them; the prevalence is not measured
  and needs the production corpus.
- **No anchor was moved.** Every number above is a reading of the code as it
  ships.
- **The external benchmarks are not asserted.** §3.5 establishes that the
  current anchors rest on the platform's own sample and that this breaks the
  stated rule. It deliberately does not supply a replacement figure, because a
  benchmark invented to close an argument is the defect it is complaining about.
