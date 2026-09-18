# What a score means, before any anchor moves

**S5/S6 §6.** The instruction's first requirement, in its own order: *"Define
what weak, adequate, good, strong and exceptional look like for each dimension
before choosing anchors."* This document is that definition, plus a reading of
the anchors that ship today against it, plus the specific external benchmark
each disputed anchor needs before it may be moved.

Prepared 18 September 2026. **No anchor is changed by this document.** §6 also
says: *"If an anchor change cannot be justified, retain the existing mapping and
explain."*

---

## 1. The band vocabulary

Five bands, defined once, in investment terms rather than statistical ones.
They describe **the evidence about the property**, never a probability, a
return or a recommendation.

| band | range | what it asserts |
| --- | ---: | --- |
| **exceptional** | 90–100 | Among the strongest readings this measure produces anywhere in the country. Rare by construction; a scale on which many properties are exceptional is not measuring. |
| **strong** | 75–89 | Supportable fundamentals on this measure — materially better than the market's middle, on evidence that would survive scrutiny. |
| **good** | 60–74 | Better than the middle, without the margin that makes it a reason on its own. |
| **adequate** | 45–59 | The market's middle. Not a criticism: most properties are ordinary on most measures, and a scale that calls ordinary "poor" is as wrong as one that calls it "strong". |
| **weak** | 0–44 | Materially below the market's middle on this measure. |

**What 75–80 does NOT mean**, stated because it is the number a client will
read and the misreading is predictable: it is **not** a 75–80% probability of
anything, **not** a guaranteed or expected return, and **not** a statement that
the property suits this buyer. Suitability is a separate reading
(`financeSuitability`) and is deliberately outside the score.

Grade thresholds are unchanged and are not this programme's to move:
`[85 A+] [75 A] [65 B+] [55 B] [50 C+] [40 C] [30 D] [0 F]`.

## 2. Per dimension: the criterion, then what ships

For each dimension, what each band should mean **in the measure's own units**,
then the measurement the shipped anchors actually place at the 45 / 60 / 75 / 90
boundaries, then the verdict.

### 2.1 Growth (0.40) — five-year CAGR as the primary component

| band | criterion, in the measure's units |
| --- | --- |
| exceptional | ≥ 12% p.a. sustained over five years — a market that has re-rated |
| strong | 7–10% p.a. — materially ahead of long-run national dwelling growth |
| good | 5–7% p.a. — at or a little above the long-run rate |
| adequate | 3–5% p.a. — real growth, below the long-run rate |
| weak | < 2% p.a., or negative |

**What ships** (`LONG_TERM_ANCHORS`): 2% → 30, 4% → 48, 6% → 65, 8% → 79,
10% → 89, 13% → 96.

**Verdict: agrees, no change.** 8% p.a. → 79 sits in *strong*; 6% → 65 sits in
*good*; 4% → 48 sits in *adequate*. The slope discriminates across the range a
real series occupies. Nothing here compresses.

The two zero-centred components are also correct and are recorded so a later
reader does not mistake them for placeholders: `TRAJECTORY_ANCHORS` puts a
three-year rate equal to the five-year rate at 50, and `RELATIVE_ANCHORS` puts
performance equal to the wider market at 50. A property growing exactly in line
with its market **is** adequate on those measures, and 50 is the honest answer.

### 2.2 Location (0.25) — walkability, CBD access, schools

| band | criterion |
| --- | --- |
| exceptional | inner-ring amenity, under ~20 minutes to the employment centre, many schools in range |
| strong | genuinely walkable, a commute most buyers would accept, schools in range |
| good | services within walking distance, a workable commute |
| adequate | car-dependent but serviced, a long but real commute |
| weak | no walkable services, or no practical commute to any employment centre |

**What ships** — walkability (`WALK_ANCHORS`, weight 0.35): 80 → 42, 88 → 50,
93 → 60, 95 → 70, 99 → 90. CBD access (`COMMUTE_ANCHORS`, weight **0.40**):
20 min → 88, 30 → 74, 45 → 53, 60 → 35, 110 → 0. Schools (`SCHOOL_ANCHORS`,
weight 0.25): 3 → 58, 5 → 78, 8 → 93.

**Verdict: two disputes, both recorded in `SCORE_COMPRESSION_INVESTIGATION.md`.**

- **Walkability is anchored on the platform's own corpus median (94.5), by its
  own header.** A published walk score of 95 — the top of the practical range —
  earns 70, which is *good*, not *strong*. That is the §3.5 rule violation and
  it needs an external distribution of Australian walk scores before it moves.
- **CBD access is a metropolitan framing carried at the largest weight.** The
  criterion above deliberately says *"employment centre"*, not *"capital-city
  CBD"*, because that is the question the measure is trying to answer. A
  regional property with a 90-minute drive to a capital it has no relationship
  with is not *weak* on location; it is being measured against the wrong centre.
  Schools and walkability read correctly.

### 2.3 Yield (0.15) — gross rental yield on the purchase price

| band | criterion |
| --- | --- |
| exceptional | ≥ 7.5% gross — a yield play, usually with its own risks |
| strong | 5.5–6.5% |
| good | 4.5–5.5% |
| adequate | 3.5–4.5% |
| weak | < 3% — the property is being bought for something other than income |

**What ships** (`GROSS_YIELD_ANCHORS`): 3.5% → 33, 4.36% → 50, 5% → 62,
5.5% → 72, 6.5% → 87, 7.5% → 95.

**Verdict: the slope agrees; the CENTRE is disputed.** 6.5% → 87 and 5.5% → 72
sit close to the criterion. But the 50-point is placed at **the platform's own
corpus median of 4.36%**, by the module's own header — the §3.5 violation. If
the market's median gross yield is materially below 4.36%, every ordinary
property is scored as below-average on Yield by construction. The curve does not
need reshaping; the question is only where its centre belongs, and that needs an
external benchmark.

### 2.4 Demand (0.15) — vacancy, days on market, discount, clearance, absorption, population

| band | criterion (vacancy / days on market) |
| --- | --- |
| exceptional | vacancy ≤ 1% / selling inside ~15 days |
| strong | vacancy 1–1.5% / ~20–25 days |
| good | vacancy 1.5–2.5% / ~30 days |
| adequate | vacancy 2.5–3.5% / ~40–45 days |
| weak | vacancy > 5% / > 90 days |

**What ships**: vacancy 1% → 90, 2% → 68, 3% → 50, 5% → 20. Days on market
20 → 88, 30 → 70, 45 → 52, 90 → 20. Clearance 60% → 50, 70% → 70. Population
1.5% → 55, 2.5% → 75.

**Verdict: agrees, no change — and it is the dimension that already does this
correctly.** Every one of these anchors cites an **external** reference in its
own comment: *"Australian medians typically sit near 30-35 days"*, *"60% is the
conventional balanced line"*, *"The national rate is ~1.5%"*. That is exactly
what §6 asks for, and it is why Demand is not in dispute while Yield and
walkability are.

### 2.5 Property Risk (0.05) — not scoreable in this deployment

No criterion table, because no reading is produced. `riskModelD` requires
observations spanning at least two independent categories; an established
house's schema offers two, one of them is `building`, and nothing in this
deployment can answer a building question. Site hazard and planning constraints
are now retrieved at parcel grain and read `held_but_unscoreable` — evidence on
the page, zero points — because what is outstanding is a published **scale**,
not the evidence.

**Verdict: no calibration possible or appropriate.** Risk is disclosed as
unassessed and its 0.05 renormalises across the other four. Under the
publication policy that is a four-of-five qualified assessment covering 95% of
the matrix, which is an honest description of what was done.

## 3. The two anchor changes this work would make, and why neither is made here

| anchor | current | what a change needs first |
| --- | --- | --- |
| `GROSS_YIELD_ANCHORS` 50-point | 4.36% (the platform's corpus median) | A published Australian gross rental yield distribution, with its **geography** (national / capital-city / regional), **dwelling type** (house vs unit — they differ by more than a point), **period**, and its own sample limitations. The anchor moves to that distribution's median, and the rest of the curve re-fits around it without changing shape. |
| `WALK_ANCHORS` mid-range | corpus median 94.5 near the output middle | A published distribution of Australian walk scores for residential addresses, same four qualifications. If the published scale genuinely saturates nationally — not only in this book — the current stretch is defensible and stays. |

Both are held because §6 forbids the shortcut: *"the platform's own sample
median must not define 'average' or 'strong'"*, and a benchmark invented to
close the argument would be that same defect wearing a citation.

**And the ordering matters more than either.** `SCORE_COMPRESSION_INVESTIGATION.md`
§4 establishes that the dominant cause of the clustering is Growth never
arriving, which turns a 0.25-weight dimension into 56% of the answer. A
calibration fitted while that is true would be fitting the absence of Growth
into the anchors — the worst outcome available here, because it would look like
it worked and would then be wrong for every report that has Growth.

So: **the data defect is corrected and re-measured first, the benchmarks are
sourced second, and the anchors move third or not at all.**

## 4. What is explicitly not proposed

Per §6, none of the following is offered, considered, or implemented anywhere
in this programme: a blanket multiplier, an automatic bonus of any size, a
minimum score floor, an arbitrary curve, a target proportion of A grades, or a
second scoring pass applied after the weighted result. Calibration here means
moving a measurement-to-score mapping in one place — the anchor tables —
against a benchmark that is named, and nothing else.

Dimension weights and component weights stay fixed throughout any comparison,
so that a measured difference is attributable to the anchor and not to the
weighting.
