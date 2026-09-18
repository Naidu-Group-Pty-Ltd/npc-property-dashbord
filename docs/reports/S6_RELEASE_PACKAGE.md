# S6 — the release package

*Prepared 18 September 2026 on `claude/adoring-hopper-g02tdt` (PR
[#2692](https://github.com/Naidu-Group-Pty-Ltd/npc-property-dashbord/pull/2692),
draft). Release-candidate head **`861315972ab3f3f3d6a0a14bd92225f4ccade300`**;
its CI is read green in §6. **The stamp is re-checked against the PR's final
head before merge** — a release is claimed only against a head whose CI has been
read green, never one still running.*

Release stays behind the owner's approval gate. This document is the order of
operations and the rollback, so approving it is a decision about recorded facts
rather than a memory of the branch.

> **This document was rewritten on 18 September 2026.** The version it replaces
> described the five-dimension completion gate, the condition-record evidence
> path and one additive migration. **All three are out of this release** under
> S5/S6 §1 and §8. What replaced the gate is in §1 below; where the deferred
> work went is in §2.

---

## 1. What ships

| module | version | state |
| --- | --- | --- |
| `scorePublicationPolicy.pure.ts` | 1.0.0 (new) | when a score and grade may be published, and the score when fewer than five dimensions were assessed (§4, §7) |
| `proportionalWeighting.pure.ts` | new | the one implementation of §7's arithmetic and of what counts as a valid dimension score |
| `gradeEligibility.pure.ts` | **3.0.0** (was 2.0.0) | the delivered-points ceiling **removed**; the A/A+ coverage gate now reads evidence QUALITY over the assessed dimensions rather than a figure that mixes quality with dimension count |
| `scoringV2Production.pure.ts` | 1.1.0 | rebuilt onto `decidePublication`; `requiredDimensions` is `[]`; `SCORE_PUBLICATION_GATE` records the decision |
| `shadowScorer.pure.ts` | 2.1.0 (unchanged methodology) | composes with the shared leaf; publishes `evidenceQualityCoverage` beside `evidenceCoverage` |
| `parcelGeometry.pure.ts` | 1.0.0 | retained — parcel CANDIDATES, parcel-grain identify, the three-way sweep verdict; **no conversion** (`CONVERSIONS` frozen empty, test-asserted) |
| `riskEvidenceConnection.pure.ts` | 1.0.0 | retained — a partial register sweep reads `registers_incomplete`, never "nothing found" |
| `htmlRenderer.ts` (cover heading) | — | the PDF/UA `<h1>` is no longer painted; `overflow:hidden` on a zero-size absolute box does not suppress WeasyPrint's text run |
| `narrativeIndex.ts` / `toc.html.ts` | — | a contents tier is a level whose sections open **more than one page**; masthead `h1`s are descended past |
| `compassDocumentContract.pure.ts` | — | the omit-the-absence rule extended past prose into the strip, the cell and the chart, with the permitted form demonstrated |
| `condense-investment-report` (prompt) | — | the parent is labelled as pipeline input; the reader's single-document position and the permitted form are stated |
| `infrastructureEvidence.pure.ts` | rule 10 added | one designation, one row — identity confirmed (same publisher, same name) before anything merges; nothing merges across sources |

**The one behavioural change to issued grades**, and it is the point of the
release: an assessment on three or four validly scored dimensions now receives
a **qualified** score and grade, weighted proportionally over those dimensions'
original weights, instead of being withheld. Below three, nothing is published
and the report says briefly why.

No weight, anchor, threshold, cap, CGR figure, financial formula, loan treatment
or stored row changes anywhere in this set. The qualification travels on
`coverage.partialLabel` and the recommendation sentence — fields every surface
already reads — so **no frontend component is added or removed**.

## 2. What was deferred, and where it is

Under S5/S6 §1. Preserved in full on **`claude/deferred-condition-evidence-s5`**
(head `b98612546`); nothing in the release branch has to be undone to revive it.

`ConditionEvidencePanel`, the condition-entry dialog, `AssessmentCompletionCard`,
`conditionRecord.pure.ts` and its submission contract (both copies), the
`submitConditionRecord` / `getConditionRecords` edge operations, the generator
and scoring wiring, `assessmentCompletion.pure.ts`, the
`20261204000000_property_condition_records.sql` migration and its
isolated-cluster harness.

`docs/reports/RISK_METHOD_RECOMMENDATION.md` §0 records which half of that
recommendation stands and which is deferred.

## 3. Schema dependencies

**None.** There is no migration in this release. The only one this branch ever
carried left with the deferred work, so `apply-migration.yml` is not part of
this deploy.

## 4. Deploy order

1. **Owner marks PR #2692 ready and merges** (squash or merge per repo
   convention).
2. **Automatic — edge fleet deploy.** `deploy-supabase-functions.yml` runs on
   push to `main` for `supabase/functions/**`, and because `_shared/` changed it
   deploys **all 413 functions**, not the handful this PR names. That is the
   workflow's standing behaviour, stated so the deploy's size is expected rather
   than alarming.
3. **Frontend — published separately through Lovable.** Nothing in this release
   requires it: no component was added or removed, and the qualification reaches
   the existing surfaces through fields they already read. Publishing is
   therefore optional and can follow at any time.
4. **Nothing else.** No migration, no template re-seed, no render-container
   change, no secret, no cron.

## 5. Rollback

- **Code**: revert the merge commit on `main`; the same workflow redeploys the
  previous fleet. Nothing is entangled with data — the publication policy is
  entirely code-side and rewrites no stored row.
- **Historical results are untouched either way.** A score issued under the
  previous policy keeps its own stamp; the new policy applies to new generations
  and regenerations only. Reverting does not un-publish anything, because
  nothing was republished.
- **Frontend**: nothing to roll back — no component changed.

## 6. CI

The claim standard: checks are read on the **exact release-candidate head**
after the last push, and a check still running is reported as running, never as
passed.

**Read 18 September 2026 11:53 UTC on head
`861315972ab3f3f3d6a0a14bd92225f4ccade300`** — all six checks completed
`success`:

| check | conclusion |
| --- | --- |
| `verify` | success |
| `security` | success |
| `supply-chain` | success |
| `render-container` | success |
| `pdf-import-regression` | success |
| `pdf-import-release-gate` | success |

Local full suite on this head's parent set: **1,270 files / 23,576 tests
passed, 25 skipped, 0 failed**.

## 7. Verification standing

Separately, per output: **implemented / tested / visually verified / released.**

| stream | implemented | tested | visually verified | released |
| --- | --- | --- | --- | --- |
| Publication policy (§4, §7) | yes | 30 specs — all 32 availability subsets against the formula, validity, genuine zero, single rounding, monotonicity, adverse dimension | n/a (server-side) | no |
| Proportional weighting leaf (§7) | yes | pinned by the above + the engine's own suites | n/a | no |
| Delivered-points ceiling removed (§8) | yes | 3 specs incl. a source-level guard that the input cannot carry it | n/a | no |
| Growth-required rule removed (§8) | yes | 2 specs; B+ evidence ceiling asserted still binding | n/a | no |
| Evidence-quality vs count split (§8) | yes | doc-code pin + eligibility specs | n/a | no |
| Scope correction (§1) | yes | full suite green with the 18 paths removed | n/a | no |
| Site half retained (parcel candidates, sweep) | yes | 15 specs + live probe | n/a (no surface) | no |
| Compression investigation (§5) | n/a — analysis | measured by execution against real fixtures | n/a | n/a |
| Criteria framework (§6) | n/a — analysis | doc-code pin on the anchors it reads | n/a | n/a |
| Ownership matrix (§9) | n/a — analysis | generated from the registry by execution | n/a | n/a |
| Cover heading duplicate (§9) | yes | pinned by the renderer spec | **yes** — text layer measured on all five tiers; nothing at the origin | no |
| Contents tier rule (§9) | yes | 8 specs carrying all three measured narrative shapes | **yes** — strategic 1→12 rows, financial 1→11, Compass unchanged at 16 | no |
| Absence never drawn as a finding (§9) | yes | 4 specs | **yes** — 4 of 194 glance cells measured across the seven retained reports | no |
| The document never names its source (§9) | yes | 5 specs incl. a scan of every prompt line | **yes** — Briefing p4, and 4 occurrences on row `89b451f6` | no |
| Infrastructure identity before dedup (§9) | yes | 8 specs, 4 asserting what must NOT merge | n/a — no fixture carries `planningData`; found by execution | no |

**Genuinely remaining, and why — stated rather than implied:**

- **§9 content completion — partly done, and what is left is named.** All five
  tiers have now been rendered and read page by page
  ([`evidence/FIVE_TIER_PAGE_READ_2026-09-18.md`](./evidence/FIVE_TIER_PAGE_READ_2026-09-18.md)),
  three client-document defects found and fixed at the producer, and the
  infrastructure outlook checked against §9's four requirements line by line
  with the one gap closed. **Three things remain**, and each is a different
  kind of work rather than more of the same:
  - **Infrastructure COVERAGE** — council capital works, budget programmes and
    agency announcements are read by neither register. This is register
    acquisition, not a change to any module here, and the page already states
    all four limits on a full reading as well as an empty one.
  - **Two short pages on the Compass** (p3 68.3%, p33 77.9%), both diagnosed to
    their exact mechanism in the evidence document. p3 is Decision E working —
    the Verdict master drawn for a tier that publishes modelling the Compass
    withholds — and belongs to the open master-geometry item. p33 is the
    narrative packer at its own calibration boundary: the guard is stated in
    charged lines and the defect is in printed height. Moving it means
    re-measuring the charge model against the pinned engine across the corpus,
    which shifts page counts on every report. **Deliberately not changed here.**
  - **The educational treatment from the legacy Lot 20427 reference.** The
    navigation half is done — a 16-entry contents with per-section anchors
    replaced "The report (1)…(40)". The explanatory half exists per control
    (`planningControlGuide.pure.ts`) and is not yet a document-wide voice.
- **§10 — ten PDFs, every page read.** Generation spends a forwarded vendor
  credential and writes production rows, so it needs the authorised environment
  and disposable records. A fixture replay through the journey harness is
  possible today and is **not** the same thing; it will be reported as a
  retained-data replay if it is what gets run.
- **The Growth data question** (`SCORE_COMPRESSION_INVESTIGATION.md` §4.1) —
  whether `market_sales_medians` is populated for the corpus's states. A
  production read, not a code change, and the single highest-impact item
  outstanding.
- **The two disputed anchors** (`SCORE_CRITERIA_AND_CALIBRATION.md` §3) — each
  needs a published external distribution before it moves, and neither moves
  until the Growth question above is settled.

## 8. The documents this release is judged against

| document | what it carries |
| --- | --- |
| [`SCORE_COMPRESSION_INVESTIGATION.md`](./SCORE_COMPRESSION_INVESTIGATION.md) | §5 — eight hypotheses, each with a verdict; the mechanism derived and checked against real records |
| [`SCORE_CRITERIA_AND_CALIBRATION.md`](./SCORE_CRITERIA_AND_CALIBRATION.md) | §6 — the band definitions, the shipped anchors read against them, the benchmark each dispute needs |
| [`REPORT_OWNERSHIP_MATRIX.md`](./REPORT_OWNERSHIP_MATRIX.md) | §9 — which report owns which section, with producers, read by execution |
| [`SCORING_V2_METHODOLOGY.md`](./SCORING_V2_METHODOLOGY.md) | the method, updated for 3.0.0 and the publication policy, doc-code pinned |
| [`RISK_METHOD_RECOMMENDATION.md`](./RISK_METHOD_RECOMMENDATION.md) | §0 records what is deferred and what stands |
| [`evidence/FIVE_TIER_PAGE_READ_2026-09-18.md`](./evidence/FIVE_TIER_PAGE_READ_2026-09-18.md) | §9/§10 — all five tiers rendered and read page by page; three defects fixed at the producer; the two short Compass pages diagnosed |
| [`evidence/COVER_HEADING_DUPLICATE_2026-09-18.md`](./evidence/COVER_HEADING_DUPLICATE_2026-09-18.md) | the cover and contents defects, measured before and after |

## 9. Closeout estimate

Stated as work, not as a date, because three of the five items are blocked on
something outside this branch and an estimate that hides that is not an
estimate.

| item | shape | blocked on | estimate once unblocked |
| --- | --- | --- | --- |
| **Merge this release** | approval + one CI read on the final head | the owner's gate | same day |
| **§10 — ten PDFs, every page read** | drive Annabelle and Pallas through real generation on five tiers each, read all ~150 pages, complete R1–R12 on disposable records | **the authorised environment.** Generation spends a forwarded vendor credential and writes production rows; the A$25 test budget is untouched (A$0.00 spent) | 1 working day for the runs and the page read, plus whatever the environment takes to provision |
| **The Growth data question** | one production `SELECT` against `market_sales_medians` per corpus state | **a production read I cannot make** — the SQL tool is unavailable or denied in this session, and that restriction is not to be routed around | minutes to answer; if empty, the ingest is a day's work and it is the single highest-impact item in the programme |
| **The two disputed anchors** (§6) | move `GROSS_YIELD_ANCHORS` and `WALK_ANCHORS` off corpus medians onto published external distributions | **a published benchmark carrying its geography, dwelling type, period and sample limits** — and the Growth question above, because calibrating while Growth is missing fits the *absence of Growth* into the anchors | 1–2 days per anchor once the distribution is in hand |
| **§9 residue** (infrastructure coverage, the two short pages, the educational voice) | register acquisition; a packer re-calibration against the pinned engine; a document-wide explanatory pass | nothing — but each is a separate piece of work rather than the tail of this one | ~1 day, ~2–3 days, ~2 days respectively |

**What that means in one line.** The release itself is ready for the gate now.
§10 is a day's work the moment an authorised environment exists. Everything
else is either a single production read away from being answerable or is
honest, separable follow-on work that should not hold this release.
