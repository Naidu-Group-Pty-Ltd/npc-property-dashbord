# S6 — the release package for the S5 reporting-engine work

*Prepared 18 September 2026 on `claude/adoring-hopper-g02tdt` (PR
[#2692](https://github.com/Naidu-Group-Pty-Ltd/npc-property-dashbord/pull/2692),
draft). The release-candidate head at the time of writing is `153ae1e38`;
**this stamp is re-checked against the PR's final head before merge**, and a
release is claimed only against a head whose CI has been read green, never
one still running.*

Release stays behind the owner's approval gate. This document is the order
of operations and the rollback, so that approving it is a decision about
recorded facts rather than a memory of the branch.

---

## 1. What ships, by version

| module | version | state |
| --- | --- | --- |
| `assessmentCompletion.pure.ts` | 1.1.0 | the five-dimension completion gate's reading; `scored: true` requires a valid 0–100 score, stale in-flight bounded |
| `scoringV2Production.pure.ts` | `FIVE_DIMENSION_COMPLETION_GATE` (S5/S6 §4) | a completed grade issues only at five valid dimensions; engine figures retained on `v2` |
| `conditionRecord.pure.ts` | 2.1.0 | the building method — admissibility, binding (expansion never deletion), refusal vocabulary; **not activated** (`CONDITION_METHOD_ACTIVATION` null, test-asserted) |
| `conditionRecordSubmission.pure.ts` | new | the submission contract: whitelist parse, storability vs admissibility, subject-bound best reading, the named unapplied-table state |
| `parcelGeometry.pure.ts` | 1.0.0 | the site half — parcel CANDIDATES, parcel-grain identify, the three-way sweep verdict; **no conversion** (`CONVERSIONS` frozen empty, test-asserted) |
| `riskEvidenceConnection.pure.ts` | 1.0.0 | register aggregation — a partial sweep reads `registers_incomplete`, never "nothing found" |
| `manage-investment-reports` | +2 actions | `submitConditionRecord` (edit-gated), `getConditionRecords` |
| `generate-investment-report` / `investment-scoring-service` | wiring | the subject-bound condition reading rides the scoring call as evidence; byte-identical output when absent (test-pinned) |
| frontend | new panels | `AssessmentCompletionCard`, `ConditionEvidencePanel` in the report view's aside; historical rows render unchanged |

No score, grade, weight, threshold, cap, CGR figure, financial formula, loan
treatment or stored row changes anywhere in this set. The one behavioural
change to issued grades is the completion gate itself, approved in S5/S6 §4.

## 2. Schema dependencies

Exactly one migration: **`20261204000000_property_condition_records.sql`** —
additive (one table, one IMMUTABLE validator function, one trigger, three
RLS policies; no existing object touched, no backfill).

- **Merging does NOT apply it.** DDL reaches production only through
  `apply-migration.yml` on the merged file, as its own explicitly triggered
  step.
- **Verified by application, not by reading**: applied verbatim and probed
  in an isolated PostgreSQL cluster —
  `docs/reports/evidence/MIGRATION_ISOLATED_TEST_2026-09-18.txt`
  (the original inline-subquery CHECK reproduced its 0A000 apply-time
  refusal first; then valid/invalid records, the absent-JSONB-key trap,
  FK linkage with `ON DELETE SET NULL`, the RLS matrix, no DELETE path,
  corrections under the trigger). Cluster was PG 16.13 against production's
  17.4; nothing probed differs between the majors and the difference is in
  the transcript.
- **Every reader tolerates its absence.** `getConditionRecords` answers the
  named `tableApplied: false` state; the panel renders that sentence and no
  submit button; the generator reads a missing table as no evidence. Proven
  through the actual screens (`SCREEN_STATES_CONDITION_2026-09-18.json`).

## 3. Deploy order

1. **Owner marks PR #2692 ready and merges** (squash or merge per repo
   convention — the owner's call; nothing here depends on it).
2. **Automatic — edge fleet deploy.** `deploy-supabase-functions.yml` runs
   on push to `main` for `supabase/functions/**`, and because `_shared/`
   changed it deploys **all 413 functions**, not the handful this PR names.
   That is the standing behaviour of the workflow, stated so the deploy's
   size is expected rather than alarming.
3. **Owner-triggered — apply the migration** via `apply-migration.yml` for
   `20261204000000_property_condition_records.sql`. Order relative to step 2
   is safe in either direction: the functions tolerate the missing table
   (named state), and the table without the functions is inert (nothing
   writes it). Doing it after step 2 is the tidy order.
4. **Frontend — published separately through Lovable.** The panels reach
   users only at this step. The edge API is backwards-compatible with the
   frontend that is live today: the two new actions are additive, nothing
   was removed or renamed, and `manage-investment-reports`' existing actions
   are untouched.
5. **Nothing else.** No template re-seed, no render-container change, no
   secret, no cron.

## 4. Rollback

- **Code**: revert the merge commit on `main`; the same workflow redeploys
  the previous fleet. No data migration is entangled with code behaviour —
  the completion gate and the evidence paths are code-side.
- **Migration**: no rollback required or recommended. It is additive and
  inert without callers; leaving the empty table in place after a code
  revert breaks nothing. If the owner wants it gone regardless, dropping
  `public.property_condition_records` and
  `public.condition_findings_shape_ok(jsonb)` is complete — no other object
  references them — through the same `apply-migration.yml` path as a new
  migration, never by hand.
- **Frontend**: republish the previous Lovable build. The old frontend
  against the new edge functions is the compatible pair described in step 4.

## 5. Verification standing (implemented / tested / visually verified / released)

| stream | implemented | tested | visually verified | released |
| --- | --- | --- | --- | --- |
| Completion gate + score-validity contract | yes | 38 specs | via the completion card screens | no |
| Condition record method (building) | yes (2.1.0, unactivated) | 38 specs | dialog screens | no |
| Submission surface + edge operations | yes | 22 specs + screen probe | 28/28 screen checks, screenshots delivered | no |
| Evidence → scoring (risk gap names what is on file) | yes | pinned byte-identical when absent | n/a (server-side) | no |
| Site half (parcel candidates, parcel-grain sweep) | yes (1.0.0, no conversion) | 15 specs + live probe | n/a (no surface yet) | no |
| Migration | prepared, NOT applied | isolated-cluster apply + 30 probes | n/a | no |

**Genuinely remaining, and why:**

- **R1–R12 journey verification in an authorised non-production
  environment** — the writing steps write to production and generation
  spends a forwarded vendor credential, so it needs the isolated project
  and disposable records the execution-route doc describes. The browser
  environment side is resolved (validation-on TLS measured:
  `BROWSER_TLS_TRUST_2026-09-18.json`); what remains is the environment to
  point at.
- **Ten fresh PDFs (five per validation property) with every page
  inspected** — depends on the same authorised environment, because
  generation is a spend and a write.
- **Approval B (activate the condition conversion)** — deliberately not
  sought here; first records received are the first evidence the deduction
  magnitudes are seen against.
- **Five-of-five demonstrated on Annabelle/Pallas** — requires real
  condition documents for those properties (the exact record needed is a
  building inspection report over the whole dwelling, per property), and
  for Pallas a confirmed lot/plan (two geocodes resolved two different
  lots; §6a of the recommendation).

## 6. CI

The claim standard: checks are read on the **exact release-candidate head**
after the last push, and a check still running is reported as running, never
as passed. The reading for the final head is recorded on PR #2692 at merge
time rather than frozen here.
