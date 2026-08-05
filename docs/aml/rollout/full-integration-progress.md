# Full-integration progress — Client Portal ↔ Command Center

Live checkpoint file for the production-integration mission. Updated at every
stage boundary and before any long-running suite.

## Identity

- Branch: `claude/aml-client-command-center-production-integration`
- Created from: `origin/main` @ `5979b30c2` (merge-base verified)
- Imported history: PR #1937 (6 remediation commits + main sync `9d3475ca5`)
  and PR #1938 (matrix + 2 migrations) via fast-forward — authorship and
  focused commits preserved; branch does NOT depend on either PR merging.
- PR: #1939 (draft, targets main) — see PR body for scope.
- Worktree: clean apart from work-in-progress files listed per stage below.

## Interrupted-work recovery (Stage 0)

- Container restart recovered cleanly: committed work was already pushed on
  the #1938 branch; the only uncommitted artefact was
  `supabase/functions/cross-portal-outbox-worker/verificationConsumer.ts`
  (untracked, 6.4 KB), backed up to the session scratchpad before any branch
  operation. The interrupted worker-dispatch wiring edit to the worker's
  `index.ts` had been rejected and was NOT present — index.ts is pristine.
- No staged or unstaged diffs existed (empty patches recorded).

## Stage status

- [x] Stage 0 — recovery + backup
- [x] Stage 1 — branch + PR
- [x] Stage 2 — import audit: all #1937/#1938 commits imported verbatim via
      fast-forward (nothing obsolete; the interrupted consumer file is being
      completed on this branch rather than imported blind)
- [x] Stage 3 — integration matrix (imported; updated as stages complete)
- [x] Stage 4/5 — canonical model + migrations 20260831000000/000100
      (imported; schema verified against production before they were written)
- [x] Stage 6 — attempt accounting (RPC-first with legacy fallback; commit 94430b470)
- [x] Stage 7 — transactional portal submission (readiness gate, in-flight
      dedupe, per-capture idempotency, trigger-emitted event; 94430b470)
- [x] Stage 8 — verification outbox consumer wired into the platform worker
      (claim guards, eligibility, technical/unusable/authoritative
      classification; 843f05aab)
- [x] Stage 9 — staff technical retry (retry_verification_processing;
      57c8be6a1); runProviderForCheck is the shared processing body
- [x] Stage 11 — client-safe readiness (available / temporarily_unavailable /
      manual_verification_required; selfie collection gated; 94430b470)
- [x] Stage 12/13/14 — closed action vocabulary + safe projection,
      transactional request notifications (trigger), v1 response contract
      (94430b470 + migration 20260831000100)
- [x] Stage 21 — canonical risk inputs + staleness (907fae425)
- [x] Stage 22 — server-derived journey in overview (57c8be6a1)
- [x] Stage 27 — 24 integration contracts added; AML glob 703/703; registry
      PASS; WP-14 ratchet unchanged (f0dffc93b)
- [x] Stage 28B — production-shaped rehearsal: three migrations applied,
      trigger emits identifier-only events once, duplicate capture raises
      23505 (portal maps to already_processing), attempts fn counts only
      authoritative outcomes with case isolation, request notification +
      event transactional, action-code CHECK enforced, rollback per headers
      + reapply clean; DB destroyed
- [x] Stage 28A — fresh-ledger rehearsal: NOT replayable (documented
      pre-existing failure at parent-ledger row 90/~600; platform issue)
- [x] Submission Review backend + UI — get_submission_review (complete
      immutable package) and accept/changes/document/clarification/escalate/
      supersede; own workspace section; next-best-action retargeted
      (73064daa9 + 56aed2366)
- [x] Document rejection + replacement — dual reasons (client-safe code
      required; internal note staff-only), lineage columns, replacement
      request raised automatically (73064daa9)
- [x] P3 IDV evidence references + P6 biometric governance —
      aml.idv_evidence_references with classification, legal hold, disposal
      status/evidence; object never duplicated (20260901000000)
- [x] Party reconciliation backend + UI — work items, provenance, no fuzzy
      merge (suggestion-only), rationale + cross-case denial
- [x] Party verification linking — canonical links only, simulated/
      non-authoritative refused, unlink reason enforced, panel derives state
- [x] Party-scoped screening orchestration — subjects, freshness window,
      reviewer-only adjudication, panel with queue/re-screen/adjudicate
- [x] Unified staff verification surface — one canonical section plus a
      collapsed read-only legacy panel; duplicate VerificationTab unmounted
- [x] Client Portal action buttons — closed vocabulary → internal step
      routing (no URLs), lifecycle chips, v1 response contract
- [x] Retention registrations — 11 new record types registered with
      necessity-based years=0 for raw ID copies and biometrics
- [x] Tests — 48 integration contracts; AML glob 727/727
- [x] Rehearsal B (continuation) — four migrations applied on a
      production-shaped DB; lineage, P3/P6 evidence without duplication,
      legal-hold blocking, disposal evidence, suggestion-only similarity,
      adjudication, link isolation, immutable v1 snapshot, 11 retention rows;
      rollback per header + reapply clean; DB destroyed
- [x] Provider deployable package + 13 runbooks
      (docs/aml/rollout/verification-service-deployment.md) — audit, secret-free
      config contract, honest limitation register
- [x] Browser E2E — RUN on staging branch yncczbrmicjebjepfave with real
      Chromium across 360x800 / 768x1024 / 1440x900 / 1728x864: linked case
      returns AML-STG-00001 with a 6-step server journey, genuine no-case
      returns null-case, revoked session 401 portal_session_invalid,
      cross-client case_id excluded. aml-client-portal deployed as v2 there;
      all four migrations applied; queued check emitted exactly one
      identifier-only outbox event; attempts counter correctly 0 while queued.
      Environment notes: Chromium needed the agent proxy plus a TLS 1.2 cap;
      synthetic session tokens were re-dated. Screenshots not captured — the
      probe asserts contracts through the browser rather than rendering the
      Lovable-hosted SPA, which has no staging build target.
- [x] DEFECT FOUND AND FIXED by that E2E: 20260831000100's notification
      trigger wrote category='aml' but the production CHECK (verified
      read-only) allows only general|deal|document|message|property, so with
      migration 3 applied NO client request could be created at all. Fixed by
      additive 20260901000100 (widen the CHECK), proved on a disposable DB:
      insert fails before, succeeds after with notification + event + queued
      status; regression test added.
- [ ] Stage 10 — self-hosted service DEPLOYMENT itself (infrastructure host,
      secrets, owner) — external
- [x] Full staff-side browser E2E of the new review/reconciliation surfaces —
      RUN against the rendered SPA served locally in staging mode (24 specs,
      four viewports); see the round record above for exactly what is real
- [ ] Stage 29/30 — staging + browser E2E (blockers recorded below)
- [ ] Stage 31 — monitoring/runbooks
- [ ] Stages 32–36 — commits/PR/gates/release (release expected BLOCKED)

## Repository-validation round (browser + rehearsal)

Starting point: branch head `4d4efa3d6`; `origin/main` had advanced to
`199485506`. Merged (not rebased) as `7fe648002`; the incoming diff touched only
`package.json`/`package-lock.json`, `src/assets/intakePack/*` and
`src/lib/ciAssessment/*` — no AML, portal, provider, migration, auth or storage
surface. `main` then advanced a further 17 commits during the round and was
merged again as `42a19dcbd` (commercial/industrial finance redesign and the
intake-pack viewer, plus five AML *test* files where `if (!d.ok)` became
`if (d.ok === false)` — type narrowing only). AML vitest 749 passed after that
merge. Worktree clean and pushed at each stage boundary.

### GitHub CI

Real PR checks ran on `b37941021`: `GitGuardian Security Checks`, `verify`,
`supply-chain`, `render-container`, `pdf-import-release-gate` and
`pdf-import-regression` all green; `security` failed on
`supabase/functions/listing-images/index.ts: 6 → 8` (WP-14 edge-typecheck
ratchet). **That failure is identical on `main`** at `199485506` — this PR's
merge base — and on the commits after it (run 31021092008, job 92357669102).
`listing-images` is not touched by this branch; the change that raised its
count, `1c2fcee14`, is on `main`. The base branch is red and this PR inherits
it. The baseline update belongs with that change, not absorbed into an AML PR,
so the PR is being left **draft** while it stands, with a human reviewer
requested so review can proceed regardless.

### Browser test environment

- The SPA is served **locally** (`npx vite --mode staging --host 127.0.0.1
  --port 8080`) with every Supabase literal retargeted at the non-production
  preview branch `yncczbrmicjebjepfave` by `vite-staging-target.ts`. Zero
  production references remain in any served module (asserted), a fixed STAGING
  banner is injected, and both specs fail if the browser makes any request to
  the production host.
- Credentials live only in a git-ignored `.env.local`. Nothing is committed.
- **Safety defect found in this tooling and fixed:** gating on the variables
  alone was not enough, because `loadEnv` reads the dotenv *file* — a plain
  `npm run build` on a machine with a `.env.local` produced a staging-pointing
  bundle carrying a STAGING banner. Activation now also requires
  `--mode staging`, and a default build is verified clean (0 staging refs, no
  banner).
- Client-portal journeys run against the **real** deployed `aml-client-portal`
  on that branch. Only the portal shell's `client-portal-verify` bootstrap is
  fulfilled locally, because its session select joins `public.clients`, a table
  the branch does not carry. That does not weaken the access-control
  assertions: `aml-client-portal` performs its own session lookup, so the
  revoked-session refusal is still a real 401 from the real backend.
- Staff journeys run against the **real rendered SPA** with the `aml-*` boundary
  served from fixtures shaped to the response contracts in
  `src/lib/aml/amlCasesApi.ts`. The staff functions are not deployed to the
  branch and ~25 of the `aml.*` tables they query do not exist there (the parent
  ledger is not replayable — see blockers). Staff *server* behaviour is covered
  by the production-shaped rehearsal below and by the contract suite; what the
  browser proves is the rendered UI, routing, dialogs, focus and layout.

### Browser findings (all fixed, all with regression contracts)

| Ref | Defect | Fix |
| --- | --- | --- |
| DEF-B1 | The portal's no-case empty state rendered the API status line "No AML onboarding case yet.", which reads like a fault | Client-facing copy returned by the server so every consumer shows the same words |
| DEF-B2 | A terminology payload without `terminology_overrides` flowed into state as `undefined`, so the next `t()` threw and AmlLayout's ErrorBoundary replaced the **whole Command Centre** with "Something went wrong" | Coerced at the boundary (`asOverrideMap`), `t` defensive |
| DEF-B3 / B7 | Absent timestamps rendered the literal "Invalid Date" to compliance staff, in the workspace header and the legacy verification history | One shared `displayDate`/`displayDateTime` helper; every date render in the six touched surfaces goes through it |
| DEF-B4 | An absent attempt number printed "attempt undefined of 3" | Clause omitted unless the number is finite |
| DEF-B5 | **Material.** `processing_status`, `attempt_consumed`, `provider_error_category` and the `retry_verification_processing` op existed server-side and were already on the wire, but no staff UI read them: a check stranded in `technical_failure` rendered as "Awaiting adjudication" and could not be retried at all | Processing state shown beside the identity outcome, attempt accounting stated, simulation labelled, provider readiness surfaced, **Retry processing** offered only for `technical_failure`/`dead_lettered` with the vocabulary shared so the client cannot drift from the server |
| DEF-B6 | Five icon-only shell controls (menu, search, theme, account, notification bell) had no accessible name at 360x800 | `aria-label` on each |
| DEF-B8 | The party-verification form's viewport-keyed 4-up grid clipped every label, the party-type value and the button text — at 1728px as well as 360px, because the panel sits in the workspace's narrow middle column | One column by default, two-up only when the panel is wide, action on its own row; a clipping assertion now runs at all four viewports |
| DEF-B10 | The party-type picker offered `beneficiary`, which `aml.party_verification_links_party_type_check` rejects — picking it produced a server error | Picker reduced to exactly the nine types the CHECK allows |

### Rehearsal finding (blocking, fixed)

| Ref | Defect | Fix |
| --- | --- | --- |
| DEF-B9 | **Blocking.** `attempt_number` was doing two incompatible jobs — row identity (`uq_aml_verification_attempt`) and the allowance ceiling (`CHECK BETWEEN 1 AND 3`). Deriving it from the consumed-attempt count made the next capture reuse the previous number, so 23505 fired and the portal answered "your verification is already being checked": **a client whose first capture was unreadable could never recapture.** Deriving it from the row count instead hit the 1..3 cap after three captures even when none consumed an attempt. Both reachable in normal operation | New additive migration `20260901000200_aml_capture_row_identity.sql` moves row identity to `capture_sequence`, lifts the cap to `>= 1`, and backfills; the portal derives the row sequence from rows and only reports `already_processing` on a genuine idempotency-key collision |

### Production-shaped rehearsal (disposable Postgres 16, destroyed)

65 migrations applied in order on a fresh database, then the sixth release
migration; 16 behaviour proofs, each of which raises on failure rather than
reporting success:

1. pre-fix probe: with `20260831000100` applied and the category fix absent, the
   AFTER-INSERT notification trigger aborts the whole insert — **zero** client
   requests creatable (the defect, reproduced).
2. request + notification + outbox event + `notification_status='queued'`, all in
   the insert's transaction.
3. event payload carries identifiers only — no name, no message body.
4. action-code CHECK closed.
5. exactly one identifier-only verification event; a duplicate capture raises
   23505.
6. attempt accounting: outage, unusable capture and simulation consume nothing;
   `attempts_used = 1` from the one authoritative outcome.
7. a superseded authoritative outcome stops counting.
8. `processing_status` CHECK closed.
9. five consecutive unusable captures then a sixth recapture, all with
   `attempts_used = 0` — and the old `used + 1` formula still collides, so the
   defect is genuinely reproduced rather than assumed.
10. document rejection/replacement lineage over two cycles; client-safe reason
    and internal note kept apart; no version removed.
11. P3 evidence reference; a legal hold blocks disposal
    (`blocked_by_hold`); disposal writes evidence; the classification
    vocabulary is closed to P3/P6.
12. similarity is suggestion-only — resolution stays `open` until confirmed.
13. necessity-based retention (`years = 0`) registered for raw ID copies and
    biometrics.
14. `review_status` closed; a superseded submission snapshot is unchanged.
15. party verification links stay inside their case.
16. screening adjudication recorded with a note.

Rollback was then executed from the six migration headers **verbatim**. Two
statements refused — restoring the 1..3 `attempt_number` cap and narrowing the
notification category — which is exactly the precondition each header
documents ("only safe once no party holds more than three capture rows" /
"only safe once no row uses category='aml'"). With those preconditions met the
same statements succeeded, leaving a fully rolled-back schema. All six
migrations then **reapplied cleanly** and every convergence check passed;
the 16 proofs were re-run green after the reapply. The database was destroyed.

## Known blockers (recorded, not stopping independent work)

- No staging frontend exists (Lovable-hosted production frontend only);
  browser E2E requires one — recorded for Stage 29/30.
- Self-hosted verification service has no deployment target/owner; secrets
  and provider approval are human decisions (Option A/B register on #1937).
- Owner/sign-off register: all roles open; approvals must not be invented.
- Production migration ledger not replayable on fresh DBs (branch
  materialisation fails at ledger row 90/~600) — pre-existing platform
  defect; rehearsal A documents it, rehearsal B covers the release set.

## Next action

Repository work is complete for this round. What remains is external:
human review of PR #1939, the verification service's deployment target and
secrets, worker scheduling, a change window, and the security / privacy /
MLRO / operations sign-offs. Release remains BLOCKED.
