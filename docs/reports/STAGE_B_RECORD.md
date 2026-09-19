# Stage B — the five formats, produced and read

19 September 2026. Branch `claude/reporting-engine-audit-4850hs`, PR #2700.
Stage A's record is [`STAGE_A_RECORD.md`](./STAGE_A_RECORD.md).

Stage B asked for **all five complete revised formats, every page inspected.**
This is what was produced, how, and what reading the pages found.

---

## 1. What was produced, and what it is

Every document below came out of the **real delivery journey** — the report
page, the editor, the template picker, the Publishing & Export panel, the
finalisation and the send — driven in a real Chromium against the running
application, with the final PDF drawn by **WeasyPrint 69.0**, the version
`weasyprint-service/requirements.txt` pins. No credential, no network, no side
effect outside the process.

| tier | document | subject | record |
|---|---|---|---|
| `compass` | Investment Compass | 48 Redfern Street, Cowra | `09f8569e` |
| `financial` | Financial Analysis | 48 Redfern Street, Cowra | `8b0c7c8d` (a fork of `09f8569e`) |
| `strategic` | Due Diligence Report | 48 Redfern Street, Cowra | `bd1b75a7` (a fork of `09f8569e`) |
| `briefing` | Executive Briefing | 1/27D Mitchell Street | `89b451f6` |
| `snapshot` | Snapshot Report | 1/27D Mitchell Street | `8c6edc56` |

**Three of the five are the same property.** The Cowra record has 42 `financial`
and 42 `strategic` children in the retained set and **no** `briefing` or
`snapshot` child, so those two tiers are read on the record that has them. Both
are named rather than left to be assumed.

**These are stored records rendered through the real composition and render
path. They are not fresh generations** — Stage A's §1 says why, and it has not
changed: acquisition runs in deployed edge functions and this branch is
unmerged.

---

## 2. What the journey and the measurement say

| tier | journey | pages | fonts embedded | measurement |
|---|---|---:|---|---|
| Compass | **33/33** | 31 | 11/11 | **PASS**, no issues |
| Financial Analysis | **33/33** | 21 | 12/12 | **PASS**, no issues |
| Due Diligence | **33/33** | 24 | 12/12 | **PASS**, no issues |
| Executive Briefing | **33/33** | 11 | 6/6 | **PASS**, no issues |
| Snapshot | **33/33** | 11 | 5/5 | **PASS**, no issues |

No illegible text, no off-page run, no overlapping run, no mojibake, no blank
page, no hole, no client-facing sentinel, correct page numbering on every
numbered page.

**That is not evidence of completion, and is not offered as any.** §1 of the
standard says so in terms: passing clipping and overlap checks is not
sufficient. What follows is from reading the pages.

---

## 3. What reading the pages found

### 3.1 A figure in a summary strip, on 83 of 89 stored reports — FIXED

Page 4 of the Cowra Compass drew, at display size:

```
INDICATIVE LOCAL GROWTH
3.52%
Annual house price growth, Cowra (latest published)
```

`3.52` appears **exactly once in the whole record** — inside the model's own
prose, as the `::: stat` fence that draws it — and `data_sources.marketData` is
`null`. The words *"(latest published)"* assert a provenance nothing holds.

The directive contract could not see it. `assessChartEvidence` walks lines
beginning `{{`, and a stat card is one of the five `:::` fences
`renderMarkdown` draws. §2 asks for the contract to hold over *"charts, tables,
prose, captions, summary strips and recommendations"*, and a stat card is a
summary strip.

Measured across the 89 retained reports: **85 stat fences, 3 distinct**, and
the growth one is in **83** of them, because it rides the parent's content into
every fork.

| fence | value | record | verdict |
|---|---:|---|---|
| Indicative local growth · *Annual house price growth, Cowra (latest published)* | 3.52 | `marketData: null` | **refused** — `market_not_held` |
| Mining share of workforce · *ABS Census 2021, POA* | 41.2 | demographics + employment answered | kept |
| 10-year population change · *SA2 Moranbah · 2015–2025* | 9.7 | demographics answered | kept |

The rule is the record, not the words: the same module keeps Moranbah's two
figures because that record's producers answered, and refuses Cowra's because
its market producer did not. **Judging a fence is not scrubbing prose** — a
fence is a structure with a kind, a label, a unit, a subtitle and one value,
which is exactly the property that makes a directive judgeable. Removal takes
the whole block, never half a fence, and the prose either side is untouched:
re-rendered, page 4 keeps *"free-standing houses on generous blocks"* and
*"Property fit"* and no longer carries the figure. 31 pages, VISUAL PASS.

The prose half moved with it: `claimSupportRules` rule 2 forbade a proportion
of sales and said nothing about a growth rate, a median, a yield or a vacancy
rate. It names them now, and names the stat card.

### 3.2 A rating spelled out of ten, and a distance nobody measured — FIXED

Two more, found the same way and measured the same way.

**Page 15 drew `7.5 / 8.0 / 6.5`** — *Relative positioning within regional
residential markets*, rating a property, a town and a region, on a record that
issued no grade. §2 names that chart by its numbers. It survived because
`declaresRatingScale` read `max=100` and nothing else, so a scorecard spelled
`unit=/10` was a "measurement". Every declared unit in the 89 retained reports
is one of `%` (94), `km` (87), `/10` (43), `m²` (2) and one each of `min`,
`relative`, `incidents`, `score`, `$` — and **all 43 of the `/10` directives
are that one chart**. A measured series does not announce that it is out of ten
either, so the tell is widened by exactly that form. The `max` is deliberately
NOT read: a proximity chart legitimately declares `max=3`, and condemning it
for the shape of its axis would take a real measurement off the page.

One thing the widening forced: **the scale decides, not the digits.**
`ratingValues` rounds, so `7.5` reads as `8` — and a child carrying a recorded
score of 8 would have "supported" it by a coincidence of digits. The engine
records 0–100; nothing it records is *7.5 out of 10*, so an off-100 scale is
unsupportable outright.

**Pages 10 and 12 drew distances nobody measured.** *Proximity of 48 Redfern
Street to key Cowra amenities* — 1.6 km, ~0.7 km, ~2.0 km — and *Indicative
reach*, set as a five-row **table** of the same figures.
`location_intelligence` on that row is NULL, and the prose says where they came
from: *"Approximately 1.6 km from Cowra's CBD **as indicated by recent sale
listings**"*. §2 is explicit that a search snippet is not a verified source and
that an unsupported dataset must not become a table of unsupported numbers.

`readEvidenceInventory` has computed `location` since it was written and
**nothing had ever read it**. Measured: 88 directives declare a distance or
travel-time unit, **86** on a record whose location producer did not answer.
The two that stand are Muswellbrook's *"road distance to key centres"* and
*"Everyday errands – typical travel times"*, on a record where it answered.

An earlier test asserted the opposite — *"a measurement in kilometres is never
withheld, the record is not what is wrong with it"*. Reading the delivered
document is what changed the evidence, and the test now pins the current rule
with that reasoning recorded in it.

**The whole contract, executed across 91 stored reports:** 411
`unrecorded_rating`, 178 `population_not_held`, 86 `distance_not_measured`, 85
`market_not_held`, 1 `series_withheld` — 43 distinct refusals. Every visual §2
names by its numbers is in that list. Re-rendered, the Compass is 31 pages,
33/33 journey checks, VISUAL PASS, and carries none of `3.52`, `7.5`,
`Core CBD & shops` or `Indicative reach`.

### 3.3 The editorial changes have not reached a document — EXPECTED, AND VISIBLE

Page 4 still runs `Part 03 · Report` in the running head and still carries the
heading *"The report"*. Both were fixed in Stage A. They have not reached the
page because **the seeded catalogue has not been regenerated** — §5.5 of the
Stage A record — and this render is the proof of that caveat rather than a
counter-example to it.

### 3.4 Three findings recorded and deliberately not fixed here

**A tier's companion note is published, drawn by one renderer, and bound by no
master.** `TIER_CONTENT.financial.companionNote` reads *"The location case, the
planning controls mapped over the land and the risk register are set out in the
Investment Compass for this property."* `reportBindingProjection` publishes it
as `report.companionNote` and `render-investment-report-pdf` draws it — but the
delivered PDF comes through the **template** route, and **no master binds it**:
zero occurrences across `scripts/template-library/` and zero in the seeded
catalogue. So the tier that is told to point elsewhere never does.

It matters because of what pages 4 and 5 of the Financial Analysis carry: the
Compass's *Location verdict* and *Property fit* prose, verbatim, listing-portal
citations included. `sectionsForTier('financial')` declares eighteen sections
and none of them is a location section, so the routing is faithful to the
parent — the Compass's **Executive Verdict** section contains those
sub-headings, and the fork maps that section onto *Client Investment Decision
Summary*. Re-cutting the fork's summary routing is a content decision with its
own corpus measurement to make, so it is named here rather than changed at the
end of a session.

**The Due Diligence report has no planning, zoning or title section, and no
due diligence checklist.** Its contents lists ten content sections;
`sectionsForTier('strategic')` declares twenty-one. Missing, among others:
*Planning, Zoning and Title Due Diligence*, *Infrastructure and Growth
Context*, *Climate, Environmental, Insurance, Crime and Safety Risk*, *Due
Diligence Checklist*, *Monitoring & Review Plan* and *Final Recommendation* —
on the tier whose stated purpose is *"what must be verified before contract"*.

This is the Stage A root cause reaching its furthest point. The fork can only
route what the parent wrote, and the parent Compass was generated on 11 Sep
with no planning section at all, because the planning register was never asked.
`tierAssembly` does track what it could not place (`unplaced`), so the
machinery is not blind; the content simply was not there to place. The register
answering (Stage A) is what fills it, and this is the clearest single reason
the acceptance journey has to be a fresh generation rather than a replay.

**A timeline asserts horizons for infrastructure nobody retrieved.** Pages 10
and 14 draw *Cowra infrastructure pipeline* and *Amenity & access pipeline* over
`EXISTING / 0-2Y / 3-5Y / 5Y+`. Measured: **95 timeline directives across the
corpus and 0 on a record with a planning producer.** A rule gated on that
producer would therefore refuse 100% of them, with no positive case anywhere to
test it against — which is the "fires on two-thirds of a corpus" hazard the
evidence module warns about, and would read as a ban on a primitive rather than
a judgement. The real control is upstream and already built: once the planning
fetch answers (Stage A), `publishedProjectRules` gives the model dated stages
from a publisher's own pages, and `planningFactBlocks` governs what may be said.
So: measured, and deliberately not made a rule.

**An absence is still rated in the stored risk register.** Page 21 reads
*"Environmental hazards beyond flood/bushfire · Low–Moderate · No specific data
has been provided on industrial uses, contamination or major noise sources"*.
That is the §9 defect the planning doc records by name. The rule is live —
`RISK_EXPOSURE_LEVELS` carries `Not assessed` and the section registry spells
out that a register asked and returning nothing has measured the SEARCH, not the
area — so this document predates it and the regeneration is what fixes it.

### 3.5 What still stands in the stored documents

Every §2 claim traced in Stage A §5.2 is visible on these pages, exactly as
that record says: *"detached, renovated 3-bedroom residential home"*,
*"Bedrooms: 3"*, *"Bathrooms: 1"*, *"Well-presented renovated home"*. All are
closed at the producer and none is rewritten here, because a corrected revision
is a generation.

Two more, recorded rather than fixed, because both need the regeneration:

- **A listing portal is cited for a planning fact.** Page 4 states *"no
  bushfire, flood or heritage overlays on public mapping"*, sourced to
  `[Property.com.au, 119, 120, 137 and 139 Redfern Street profiles]` — four
  OTHER addresses. `planningFactBlocks` rule 4 already forbids writing that no
  overlay applies, and the acquisition ledger and the rebuilt chapter are what
  replace it.
- **The methodology page contradicts page 8.** Page 27 states that *"where
  population, SEIFA or detailed demographic figures are not measured … the
  report avoids quoting numbers"*, while page 8 quotes 12,721 residents and an
  SA2 of 9,150–9,273. One document, both claims.
- **A provenance nobody can check.** Page 27's source notes say local amenity
  references are *"based on Cowra Shire Council facility maps, NSW Department of
  Education school listings and Google Maps location searches"*.
  `location_intelligence` is NULL: no such search was made by this report. The
  crime and cash-rate notes on the same page are correct and checkable (BOCSAR
  by postcode and month, RBA tables), which is what makes the amenity note
  read as equally sourced. The acquisition ledger is what replaces it.
- **The parking count is asserted and then doubted.** Page 3 prints
  *"Configuration · 1 car"*; page 6 says *"1 off-street space recorded in some
  data sources, on-site parking layout should be confirmed at inspection as
  online listings differ slightly"*, and the glance strip carries
  *"⚠ Off-street parking to be confirmed on inspection"*. `property_specs`
  holds `parking: 1`. One record, three confidences.

### 3.6 An interest-only label over a principal-and-interest loan — FIXED

The Financial Analysis prints the loan on one table. On `8b0c7c8d` it read:

| Item | Value |
|---|---|
| Loan type | Interest only |
| Interest-only period | 2 years, then principal and interest |
| Monthly repayment (first year) | $2,806 |
| Annual repayments (first year) | $33,677 |

and the **"Loan structure" row did not print at all.**

$2,806 is not an interest-only repayment on $444,000 at 6.5%. Executed:
`buildLoanLedger` for the record's own stated product and term gives
`firstMonthlyPayment` **2,405.00** and a year-one debt service of **28,860**.
The gap is **$401 a month, $4,817 a year**, on the page a client reads the
loan from.

**The stored figure is the thirty-year principal-and-interest schedule, to
the cent.** Measured on all three independent parents in the retained set —
the only three there are, since the other 89 rows are forks of them:

| record | loan | stored monthly | stated product's schedule | P&I schedule | agreement with P&I |
|---|---|---|---|---|---|
| `09f8569e` Cowra | $444,000 @ 6.5% | 2,806.38 | 2,405.00 | 2,806.38 | $0.0000 |
| `c21ed1fa` | $440,000 @ 6.5% | 2,781.10 | 2,383.33 | 2,781.10 | $0.0007 |
| `c6ed90e6` | $391,200 @ 6.5% | 2,472.65 | 2,119.00 | 2,472.65 | $0.0001 |

That is **QA-04 exactly** — the interest-only label as a display override no
arithmetic ever read — and it was **fixed at the writer and never at the
reader.** `financial-calculator-service` has published `monthlyPayment =
ledger.firstMonthlyPayment`, `annualPayment` and `structure` since the ledger
was wired into it on **15 Sep 2026** (`e6dd0a959`), so the live writer is
correct and every one of these rows predates it. `financialChapters` prints
`structure` in the row directly under "Loan type" *precisely so this reads as
one reconciled fact* — its own comment says so. And **`structure` is absent on
92 of 92 stored reports holding a loan block**, so on every one of them that
row does not print and the reader is left with the contradiction the row
exists to reconcile.

Not a historical artefact: 88 of those 92 are forks made on **18 and 19
September**, and the fork carries its parent's finance block forward
unrepaired.

**The fix is a sentence derived on READ, from the figures and never from the
label.** `describeStoredLoanStructure` runs the record's own terms through the
one ledger and asks which schedule the stored repayment belongs to:

- it matches the product the record names → the row simply predates the field,
  and `describeLoanStructure` prints as it always would;
- it matches principal and interest from month one → **both are stated and
  neither is corrected**, because the loan offer settles which is right and
  this module has never seen it;
- it matches neither → **nothing is derived**. That is `healFinanceIdentity`'s
  rule and the same reasoning: a repair that cannot say which figure is sound
  is just a third opinion.

The tolerance is **$1**, and it is measured rather than chosen: the three
records agree with their schedule by $0.0000–$0.0007 while the two candidate
schedules are $353–$401 apart, so no rounding and no near-miss can decide it.

It lands in `reconcileStoredFinancials`, the one read-path healer the fork,
the binding projection, the cash-flow projection and the fact contract all
already call — so it reaches every reader with **no migration and no stored
byte overwritten**, which the test asserts by comparing the input object
before and after. Executed on `8b0c7c8d`, the row now prints:

> **Loan structure** — Principal and interest over 30 years — the schedule
> these repayments were calculated on. The record separately states interest
> only for 2 years, which the repayment figures do not reflect.

with `$2,806`, `$33,677`, `Interest only` and `2 years` all exactly as stored.
**Nothing here changes a number**, which is what §5's preservation requires:
the projections, the sensitivity and the CGR are untouched, and what changes
is that the document no longer asserts two incompatible things in silence.

`StoredFinancialsReconciliation.loanStructureDerived` and the fact contract's
`integrity.readTimeHealing` carry the basis, so an audit reading can tell a
row that predated the field from one whose figures contradict its label. 9
specs.

---

## 4. What Stage B has not closed

1. **No fresh generation**, for the reason Stage A gives.
2. **The seed has not been regenerated**, so no master change is on a page yet.
3. **`briefing` and `snapshot` are read on a different property**, because the
   Cowra record has no child of either tier.
4. The findings in §3.4 and §3.5 are recorded and not fixed.
5. **The loan-type contradiction is disclosed, not resolved.** §3.6 makes the
   record say what it holds; which product the borrower actually has is a
   question for the loan offer, and no repair may answer it from here.
