# Property Risk — the recommended method

**S5/S6 §2.** One recommended method, its implementation, its validation
evidence and its limitations, and the specific approval needed to activate it.

Prepared 18 September 2026 against branch `claude/adoring-hopper-g02tdt`.
Everything numeric below was read from production or produced by execution on
that date; nothing is estimated.

---

## 1. The finding, in one paragraph

Property Risk is **not blocked by a methodology limit.** It is blocked by one
missing class of evidence, and the arithmetic that makes it the only blocker is
in the schema rather than in an opinion. Two earlier statements in the record
were wrong and are corrected in code by this change: that a scored risk reading
requires a government publisher to issue a 0–100 scale, and that four scored
dimensions is the accepted final outcome. Neither is true. What is true is that
an established house's risk schema offers exactly two independent categories,
one of them is `building`, and **nothing in this deployment can answer a
`building` question about any property.**

---

## 2. The arithmetic that decides it

`riskModelD.pure.ts` requires observations spanning at least
`MINIMUM_INDEPENDENT_CATEGORIES` (**2**) before they may compose a Risk score.
`propertyRiskSchema.pure.ts` gives `established_house` three of its own
questions:

| question | category | held? |
| --- | --- | --- |
| `site_hazard_exposure` | `site` | retrieved at a coordinate |
| `planning_constraints` | `site` | retrieved at a coordinate |
| `condition_and_maintenance` | `building` | **not held, anywhere** |

`area_crime` and `area_socioeconomic` are also applicable and are
`owned_by_another_dimension` — Location's — so scoring them here would count
one signal twice.

Hazard and planning are therefore **one category**, however well they are
retrieved. **Every route to a fifth scored dimension runs through
`condition_and_maintenance`.** That is not a preference; it is the only
arrangement of this schema that reaches two.

The grouping stays, and its stated reason is corrected. It read *"if the
state's portal answers, both answer"*. The probe disproves that: on
18 September 2026 NSW's Principal Planning Layers answered **with** an
intersection while its Hazard and Protection services answered with none, from
three endpoints that fail independently. The grouping is right for a different
reason — both readings describe **the same site**, so they are two facts about
one thing rather than two independent observations. Common subject is the test,
not common availability.

---

## 3. The recommended method — a recorded condition record

**`supabase/functions/_shared/reports/risk/conditionRecord.pure.ts`**, version
`1.0.0`. Implemented, tested, and **not activated**.

A `building`-category observation derived from a **submitted, sourced,
verified condition document**: a building inspection report, a strata report, a
building certificate or a vendor's statement.

### 3.1 Why this evidence class and not another

Because it is the one class of property-level condition evidence whose
**negative is admissible**, and that is the whole argument.

A register absence cannot become a reading for two reasons that survive the
correction of the "published scale" premise:

- the retrieval is an **identify at a single coordinate**, so a layer that
  misses the point may still cross the lot — an address-point query is never
  clearance for a parcel, and the probe record carries that caveat verbatim; and
- a hazard the publisher has not mapped is not a hazard the parcel lacks.

A completed building inspection is the opposite case. A qualified person
examined a **recorded scope** and reported. "No major defect recorded" is then
a determination *about the dwelling, by somebody who looked* — not a silence in
a register. This is the same asymmetry `assessPepEvidence` already enforces
(a hit is a signal; a miss is not a clearance), applied to the one evidence
class where the miss is itself an observation.

### 3.2 The admissibility rules

`assessConditionRecord(record, asOf)` returns one of six named refusals, each a
different remedy:

| refusal | what it means | remedy |
| --- | --- | --- |
| `no_record` | nothing has been submitted | ask for the inspection report |
| `inadmissible_source` | not a document an issuer is accountable for | as above |
| `unattributed` | the document names no issuer | obtain the issued copy |
| `undated` | no usable date | obtain the issued copy |
| `scope_not_recorded` | it does not say what was examined | record the scope |
| `not_verified` | transcribed without the document | attach the document |
| `out_of_currency` | older than `CONDITION_MAX_AGE_MONTHS` (36) | re-inspect |

`INADMISSIBLE_SOURCES` **names** what is refused rather than leaving it absent —
a typed construction year, an agent's marketing copy, a model's inference from
a photograph, and any area statistic — so a reader can see each was considered.

### 3.3 The conversion basis

Declared, reasoned, versioned, and **uncalibrated**:

```
reference                85   a completed inspection over a recorded scope
                              that found no major defect and no safety hazard
deduct  safety_hazard    20
        major_defect     15
        unfunded_liability 12   (strata)
        minor_defect      4     capped in aggregate at 16
```

Only ever deducts. Nothing here ever adds points for something nobody found.
The ordering is by **what the finding obliges** — a safety hazard obliges
immediate work, a major defect obliges capital, a minor defect obliges
maintenance — rather than by observed cost, because this deployment holds no
maintenance-cost series to observe. That is the honest limit and §6 states it.

---

## 4. Why not a construction year — measured

`constructionAgeCandidate.pure.ts` is the candidate, built and tested so the
position rests on execution rather than on a decision not to try.

### 4.1 What the corpus holds, read 18 September 2026 over all 1,230 reports

| carrier | rows | note |
| --- | ---: | --- |
| `property_specs.year_built` — key present | 1,102 | **every one an explicit JSON null** |
| `property_specs.year_built` — with a value | **0** | |
| `property_specs.yearBuilt` / `buildYear` / `constructionYear` / `yearOfConstruction` | **0** | key absent entirely |
| `manual_overrides.constructionYear` | **32** | 19 distinct properties |
| …carrying any source or reason field | **0** | |

> The earlier record said `property_specs` carries `yearBuilt` on 0 and three
> other spellings on 0. That was true and **it never checked `year_built`**,
> which is present on 1,102 rows. The conclusion survives — the value is null on
> every one of them — but the measurement did not cover the spelling the
> platform actually writes, which is the class of defect
> `check-edge-column-names.mjs` exists for.

And the 32 values:

| value | rows | properties | what it is |
| --- | ---: | ---: | --- |
| `1941` | 3 | 1 | an observed build year — **262 Pallas Street** |
| `2025` | 3 | 3 | a completion expectation |
| `2026` | 25 | 17 | a completion expectation |
| `2031` | 1 | 1 | a completion expectation **in the future** |

### 4.2 The six demonstrations

| # | requirement | verdict |
| --- | --- | --- |
| 1 | what risk it measures, and evidence that it does | **partly met** — the mechanism is ordinary; no maintenance, defect, insurance or repair series is held here, so it cannot be checked |
| 2 | score mapping, category contribution, uncertainty | **not met** — a monotone decay avoids invented bands, but its 45-year half-life has nothing behind it |
| 3 | distinct, does not double-count | **met** — age is read by no other dimension |
| 4 | renovations, unknown, conflicting years, asset classes | **not met** — no renovation history is recorded anywhere; 31 of 32 values are completion expectations, one in the future |
| 5 | provenance and admissibility per validation property | **not met** — Pallas: typed, no source, no issuer, no date. Kellyville: absent |
| 6 | resulting scores, coverage and grades | **not met** — see below |

### 4.3 Demonstration 6, by execution

Run through the real engine (`constructionAgeCandidate.spec.ts`):

| | 262 Pallas Street | 18 Annabelle Crescent |
| --- | --- | --- |
| categories represented | `building`, `site` | `site` |
| eligible | **true** | false |
| Risk score | issued | **null** |
| dimensions | 5 of 5 | 4 of 5 |

Activating the indicator completes one validation property and not the other,
and the only thing separating them is an unsourced typed number that exists on
exactly one property in a corpus of 1,230. **A completion one property gets and
the other does not is not the S5 outcome**, and a fifth dimension that turns on
whether somebody once typed a year is not an assessment.

**Recommendation: do not activate.** `constructionAgeRecommendation()` derives
this from the verdicts rather than asserting it beside them, so changing the
answer means changing a verdict, which is a sentence somebody has to write.
The candidate is retained, unwired, so the position can be re-tested when
documented years with provenance exist. Two independent guards hold it: the id
appears in no asset class's schema, and it appears in no entry of the engine's
`QUESTION_CATEGORY` — both asserted against the engine's own maps rather than
against an intention.

---

## 5. The evidence path this needs

The method is implemented; **nothing can submit a record to it.** That is the
work this recommendation asks to authorise, and it is ordinary product work
rather than an acquisition:

1. a `property_condition_records` table — document kind, issuer, licence,
   issue and inspection dates, reference, scope, findings, verification state,
   recorded-by and recorded-at;
2. a submission surface on the property, taking the document and its findings;
3. a verification step that records whether the document itself is held and
   whether the issuer was checked;
4. the reading assembled through `assessConditionRecord` and carried onto the
   assessment beside the other four dimensions.

Until a record exists for a given property, **that property's Risk is not
assessable, and four scored dimensions is the correct outcome for that
property** — with a named, closeable, per-property reason, rather than a
platform-wide methodology limit. That is the substantive change this makes:
the blocker stops being "the platform cannot do Risk" and becomes "no
inspection report has been submitted for this property", which is a sentence an
operator can act on and most purchasers already hold the answer to.

---

## 6. Limitations, stated

- **The conversion is uncalibrated.** The reference and the four deductions are
  reasoned and versioned; they are not fitted to anything, because this
  deployment holds zero condition records. `RISK_METHODOLOGY_STATUS` remains
  `provisional / uncalibrated` and that label is **correct rather than
  pessimistic** — it should stay until records exist to calibrate against, and
  activating the method does not change it.
- **A vendor's statement is narrower than an inspection**, and the preference
  order says so; it is an order of scope, not of trust.
- **Currency is a parameter.** 36 months is the ordinary re-inspection interval
  a lender or insurer works to. It is declared, not derived.
- **Strata is served, houses are the common case.** `unfunded_liability` exists
  for strata reports; a house's record will usually carry the AS 4349.1
  severities alone.
- **The site half stays unscored.** Correcting the "published scale" premise
  does not by itself make hazard scoreable — the point-versus-parcel problem
  does that, and it is a defect of the *query* rather than of the evidence
  class. Measured from this sandbox's egress on 18 September 2026:
  Queensland's cadastre answers a parcel polygon (`2RP87802`, HTTP 200, 1.6 s
  at the Pallas coordinate); New South Wales' `NSW_Cadastre/9 (Lot)` declares
  `Query` and its metadata answers in 1.2 s while the query operation returned
  nothing within 40 s on two attempts. **Not tested from the production
  egress.** So the site half has a known first step and is not part of this
  recommendation.
- **Even with the parcel query done, the site half alone cannot make Risk
  score**, because it is one category. It would improve what the report can
  *state*, not what it can *score*.

---

## 7. What is being asked for

Two decisions, and they are separable.

**Approval A — build the evidence path.** Authorise §5: the table, the
submission surface, the verification step and the wiring. Nothing about it
changes a score; it makes a record possible. This is the one that unblocks
anything.

**Approval B — activate the conversion.** Set
`CONDITION_METHOD_ACTIVATION` from `null` to a decision, which turns admissible
records into `building` observations and lets Risk score where one exists.
`CONDITION_METHOD_ACTIVATION` is a constant rather than configuration, for the
same reason `SCORING_V2_ACTIVATION` is: activating a scoring basis is a
decision with a review behind it, and an environment variable is not that
decision. A test asserts it is `null`, so switching it on is a visible act.

B should follow A rather than accompany it, and the reason is the calibration
limit in §6: the first records the platform receives are also the first
evidence the deduction magnitudes have ever been seen against, and they should
be looked at before they move a grade.

Neither approval is assumed. Nothing in this change alters any score, any
grade, or any stored row.

---

## 8. What changed in code

| file | change |
| --- | --- |
| `_shared/reports/risk/conditionRecord.pure.ts` | **new** — the recommended method |
| `_shared/reports/risk/constructionAgeCandidate.pure.ts` | **new** — the candidate, unwired, not recommended |
| `_shared/reports/risk/propertyRiskSchema.pure.ts` | the "published scale" premise corrected; the `year_built` measurement corrected; the category-grouping reason corrected; `riskRemedyFor` no longer tells an operator to go and find a published scale |
| `src/lib/reports/__tests__/conditionRecord.spec.ts` | **new** — 20 tests |
| `src/lib/reports/__tests__/constructionAgeCandidate.spec.ts` | **new** — 15 tests, including demonstration 6 by execution |

No score, grade, stored row or client document changes. `scorePropertyRisk`
itself is untouched: its rules were right, and it is the evidence reaching it
that was not.
