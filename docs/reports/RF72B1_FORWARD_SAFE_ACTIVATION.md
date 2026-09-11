# RF-7.2B.1 — Forward-Safe Data Activation

**Scope: the Investment Property Report only. Forward-only. No historical report is
rewritten, re-narrated or re-rendered.**

RF-7.2B built the Client-Safe Gate, the safe fact projection, the visibility policy
and the safe narrative bundle — and wired **none** of them. A report generated the day
that merged received exactly what it had received before. That distinction is what this
phase closes, and it is the reason several of the proofs below are source-level
assertions against the real Edge Functions rather than unit tests of pure modules: a
unit test cannot tell you whether production calls the thing it is testing, and "the
gate exists" was precisely the claim that turned out not to mean what it sounded like.

---

## 0. Status — infrastructure vs production path

These are answered separately on purpose, because collapsing them is what went wrong last time.

| | Infrastructure exists | Production path activated |
| --- | --- | --- |
| Client-Safe Gate | YES (RF-7.2B) | **YES** — `generate-investment-report` and `regenerate-report-qualitative` |
| Generated demographics blocked | YES | **YES** |
| Trusted ABS POA admitted | YES | **YES** |
| Unsafe Location trio + transport score blocked | YES | **YES** |
| Hardcoded / LLM cash rate blocked | YES | **YES** |
| Current RBA cash-rate target ingested | **NEW** | **CODE YES / DATA PENDING A LOAD** (§4) |
| Report-time market-fact snapshot | **NEW** | **YES** |
| Market-claim reconciliation | YES (RF-7.2B) | **YES** — disclosed, never blocking |
| Visibility policy as Viewer/PDF authority | YES | **NO** — RF-7.2C |
| Chart-null policy in production charts | YES | **NO** — RF-7.2C |
| Rent-basis production capture | contract only | **NO** (§9) |

**Ready for RF-7.2C: YES for data integrity; the Viewer/PDF adoption is RF-7.2C's own work.**

---

## 1. The live generation path, as traced

Callers of `generate-investment-report`, all verified:

- **Browser** — `InvestmentReportGenerator` (×3), `ClientPropertyInvestmentReport`,
  `ReportGenerationProgress`, `InvestmentReportModal`, `ErrorLogs`,
  `useChunkedRegeneration`.
- **Server** — `resume-investment-reports` (the watchdog), `auto-report-sync`,
  `auto-report-webhook`, `generate-bulk-reports`, `ai-dashboard-agent`.

Where each fact enters:

| Concern | Where |
| --- | --- |
| Enhanced-data fan-out | phase-1 parallel block, seven services |
| Demographics → prompt | `demographicsStatBlocks(enhancedData)` |
| `economics.cashRate` → prompt | `macroEconomicBlock(enhancedData)` |
| `location_intelligence` → prompt | inline `${enhancedData.locationIntelligence?…}` in the base prompts |
| Prompt built | four base prompts — suburb / postcode / statewide / property — selected by `reportScope` |
| `report_content` stored | early, progressive and final writes |

**The finding that shaped the design: there are two narrative paths, not one.**
`regenerate-report-qualitative` is a second, fully-featured copy — its own fan-out, its
own `buildEnhancedDataContext`, its own prompt. Gating only the main generator would
have left an unguarded route to the model carrying every disowned fact. It also
hard-coded the header `**DEMOGRAPHIC DATA (ABS Census):**` regardless of what the
payload actually was; that label now comes from the payload's own source.

**Two things checked and found NOT to be defects**, recorded so nobody re-investigates:
the resume path's `existingEnhancedFields` is write-path only (a guard against
overwriting persisted values) and never merges into `enhancedData`, so there is no
prompt bypass; and no `XX` or bracket placeholder appears in any stored report body
since 2026-08-01.

---

## 2. Where the gate sits, and why there

`activateSafeGenerationInputs` is called **once per run, on the object**, after the
enhanced-data fan-out and before the first prompt is composed. Gating the object rather
than each prompt is what makes it structural: a fact that is not on `enhancedData`
cannot reach a prompt that interpolates `enhancedData`, whichever of the five prompts
it is and however it is written later.

It is deliberately placed **after** the scoring calls. `investmentScoreEngine` reads
`walkScore`, `commute.durationMinutes` and `schools.schoolsWithin3km`; sanitising before
it would silently move every new report's score. That is the scoring programme's
territory, with its own forward-only closeout, so it is a **named carry-forward** rather
than a change taken quietly under this mandate — per the mandate's own instruction to
stop and report rather than broaden scope.

Placement therefore yields: **scoring on its existing inputs; narrative and stored
snapshot on gated facts.**

### What is withheld

`walkScore` · `transport.qualityScore` · `commute` · `schools.schoolsWithin3km`, plus
demographics that are not a recognised ABS postal-area retrieval, plus a cash-rate
target the gate refuses.

Two judgement calls, stated rather than buried:

- **The whole `commute` block goes, not just its duration.** The measured defect was
  destination routing and the live service has since fixed it — but a resumed run, a
  stored blob and a fresh call are the same shape, so nothing at this boundary can tell
  a repaired value from a legacy one. Blocking all of them cannot under-block; admitting
  the shape can. The cost is a loss of detail, not of accuracy.
- **Only the schools COUNT is disowned.** `nearestSchool` and `distanceToSchool` already
  pass through `reconcileNearestSchool` / `reconcileSchoolDistances`; removing a working
  reconciliation would be widening the phase.

### Trust is asymmetric

A source must be **recognised** to pass. The live payload stamps
`ABS Census 2021 (POA 3338)`; the generated corpus stamped `ABS Census 2021 estimates`
and several variants. `isCensusProjectionSource` is exported **beside its producer** in
`absCensusProjection.pure.ts`, because a recogniser written separately from the thing it
recognises is how the two come to disagree.

---

## 3. Two defects this phase found in itself

Both were found by proofs, not by review, and both are pinned by tests.

**A skeleton table asking the model to invent a Walk Score.** The suburb prompt carried
a hand-written table with literal `XX` cells for Walk Score, CBD commute and "access
scores" — no `enhancedData` interpolation at all, so the gate could never have reached
it. Found by a source-level assertion; the rows are gone and the prompt now forbids
stating any of them.

**The gate's refusal did not reach the prompt.** `macroEconomicBlock` renders
`economics.cashRateTarget` straight off the payload. Recording the refusal in the fact
list while leaving the value in place printed a "current" cash-rate row, with an
effective date, from an LLM-sourced series. Found by the forward cohort — which is
exactly why the cohort runs against the **sanitised** object, as production does, rather
than against the inputs. The activation now removes a refused target from the payload,
so the block fails closed onto the monthly average under its own label.

---

## 4. The RBA decision, and what it rests on

**Decision: the Investment Property Report's primary macroeconomic fact is the CURRENT
RBA cash-rate target with its effective date.** `FIRMMCRT` is retained solely as
explicitly-labelled monthly-average trend context.

The two are different facts, and the difference is measurable. `FIRMMCRT` is F1.1's
"Cash Rate Target; **monthly average**": in a month containing a Board change it averages
two targets and equals neither. The series carries 4.31, 3.96, 3.83 and 3.70 — and no
Board ever set any of them. The reading's own `lastMove` on the monthly series reports
"June 2026, from **4.31** to 4.35", which is the artefact in one line.

**Source: RBA Statistical Table F1 — Interest Rates and Yields, Money Market, Daily.**
Official, no LLM, no third party.

| | |
| --- | --- |
| `FIRMMCRTD` | "Cash Rate Target on date", daily |
| `FIRMMCCRT` | "Change in the Cash Rate Target", **as announced** |

The effective date is therefore read from the RBA's own announcement column, never
inferred by differencing values. Measured from the published file on 11 Sep 2026:

> **RBA Cash Rate Target: 4.35% — effective 6 May 2026**, in force as at 10 September 2026.
> Source: RBA statistical table F1, published 11-Sep-2026.

This also confirms RF-7.2B's correction: the hardcoded 4.35 is **accidentally correct
today**, having been wrong by 75bp over the bulk of the historical corpus.

**Fails closed, three ways** — no F1 loaded, no announced change in the window, or the
level column and the change column disagreeing. In every case `cashRateTargetOf` returns
null, the payload carries no target, and the prompt block states plainly that no current
rate is available and that the only figure present is a monthly average. It never
substitutes the average behind a "current" label.

**Preservation finding that shaped the storage.** `rba-data-service` reads a four-year
window capped at PostgREST's 1,000 rows, sized for "~400 rows for the 11 series". F1 is
daily — 3,972 dated rows. Stored whole it would have pushed every monthly and quarterly
observation out of that window and silently emptied the cash-rate, inflation and
lending-rate readings, with nothing reporting an error. So `RBA_PERSIST_POLICY` stores F1
at the grain of the fact: the announced-change dates plus the latest observation. **75
rows instead of ~7,900**, verified by execution; F1.1 is untouched at 433.

**Data status.** The code is complete and verified against the real published file. The
production load needs the updated `rba-tables-ingest` deployed (which happens on merge)
and then `node scripts/rba/load-rba-tables.mjs --table f1`. Until that runs, the reading
fails closed as designed — which is safe, and is why activation does not depend on it.

---

## 5. The report-time snapshot

`investment_reports.market_fact_snapshot` (jsonb, nullable, additive, **never
backfilled**). Per authoritative fact: value, status, source, dataset/series, geography
grain, geography identifier, reference period, as-of/publication date, the gate's
ruling, and the assurance version the snapshot was produced under.

The rule: **reopening a report must never re-read today's ABS or RBA tables and quietly
restate the document.** NULL means the report predates the snapshot — not that its
snapshot is empty.

Written on the early, progressive and final writes, so a run killed at the wall-clock
budget still leaves the provenance of what it had already put in front of a reader. A
qualitative regeneration refreshes it, because that path rewrites the prose from
freshly-fetched facts and the two must not describe different runs; reopening does not.

---

## 6. Market-claim reconciliation (§7)

`auditMarketClaims` runs post-generation beside the existing fact reconciliation. That
one asks whether the prose agrees with the record; this asks whether a figure it agrees
with has been given a label the source does not support — which is the half RF-7.2A
named as structural, since reconciling prose against injected facts proves faithfulness,
not truth.

Three faults, each named by the mandate: **grain** (a postal-area figure called a
suburb's), **period** (a 2021 Census figure called current), **source** (a monthly
average called the rate in force).

It **discloses and never blocks** — findings become `validation_flags`, because two
gates on one question is how one of them becomes wrong. It is deliberately narrow: it
matches a fact's own value in the prose and reads the words around it, rather than
parsing claims in general. A broad claim parser that is 80% right generates more noise
than signal, and a reviewer who learns to ignore these flags is worse off than one who
never had them. One finding per fact per kind, for the same reason.

---

## 7. Forward cohort (§13) and delta ledger (§14)

Nineteen scenarios exercised through the activation against the **sanitised** object,
composing the real prompt blocks: trusted geography + ABS match, unresolved geography,
no ABS match, metro, regional, rent present, rent absent, finance complete, finance
partial, zero cash flow, negative cash flow, historical-location blob present, hardcoded
economic blob present, LLM economic source present, generated demographics present,
empty payload, null payload, genuine zero amenity, target absent with monthly held.

**Result: 19 of 19 clean — no disowned identifier, no `undefined`, no `NaN`, no
technical null token reaches any prompt block.**

Every delta from legacy generation, classified:

| Classification | Where it occurs |
| --- | --- |
| Unsafe fact removed | the four Location fields, wherever a payload carried them |
| Authoritative fact substituted | cash rate: monthly average → in-force target with effective date |
| Grain corrected | demographics stated at postcode grain, with the POA on the snapshot |
| Period corrected | every figure carries its own reference period; the audit flags present-tense restatement |
| Source corrected | the cash-rate row names F1 vs F1.1 explicitly |
| Explicit unavailable state | demographics withheld with a reason; cash rate fails closed |
| Null suppressed | `bindingResolver`'s presence-before-formatting fix (already live from RF-7.2B) |
| Genuine zero preserved | a zero amenity count, and a zero cash rate, survive as zero |

**No unexplained delta.** The two behaviour changes a reader would notice are both
intended and both listed: the four Location facts no longer appear in the narrative, and
the cash rate is now stated as an in-force target rather than a month's average.

---

## 8. Rent basis (§9)

| | |
| --- | --- |
| Contract support | **YES** — `rentBasis` / `rentAsOf` on the Fact Contract |
| Production capture | **NO** |

The only `rent_basis` writers in the repository are the **commercial lease** forms
(`LeaseFormModal`, `RentRollTable`) — a different feature with a different meaning.
Nothing in the Investment Report's intake captures a residential rent basis.

Per the mandate, no intake was changed and no basis is guessed: historical basis stays
unknown, and the existing frontend is untouched. Adding capture needs a frontend change
and is therefore **put to the owner rather than taken**: the smallest
backwards-compatible version is an optional basis selector beside the weekly-rent field
in `InvestmentReportGenerator` / `ManualDataOverrideModal`, defaulting to unset, with
the contract's existing `normaliseRentBasis` accepting it. Not built here.

---

## 9. Preservation

Unchanged and verified: report creation, all eleven callers, chunked generation, the
resume watchdog, regeneration, versions, fork/derived reports, templates, **template
selection** (`reportTemplateSelection.pure.ts` carries no reference to this phase's
machinery), branding, images, download, share, Q&A, comparisons, automation/bulk and
every frontend route. No visual redesign. No Viewer or PDF migration. No other report
family.

- Edge Function type-check: **339 errors, baseline 339 — no new errors.**
- `src/lib/reports`: **3,933 passing, 0 failing.**
- The activation never mutates its input, so nothing it touches can rewrite a stored row.
- The migration is `ADD COLUMN IF NOT EXISTS` only — no UPDATE, no INSERT, no DROP.

---

## 10. Carry-forwards — named, not taken

1. **The investment score still reads the disowned Location fields.** Deliberate: the
   gate runs after scoring so this phase cannot move scores. Belongs to the scoring
   programme's forward-only closeout.
2. **`|| 'XX'` placeholders remain on investment-score rows** in the prompt
   (`totalScore`, the five breakdown scores). Pre-existing, outside this phase's fact
   set, and untouched rather than quietly fixed.
3. **F1 is not yet loaded in production.** Code complete and verified against the
   published file; the load runs after deployment. Fails closed until then.
4. **Visibility policy and chart-null policy are still not the Viewer/PDF authority.**
   RF-7.2C.
