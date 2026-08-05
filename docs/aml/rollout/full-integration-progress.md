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
- [ ] Stage 10 — self-hosted service deployment (infrastructure + owner)
- [ ] Browser E2E — needs a served frontend against the synthetic staging
      backend (attempted next)
- [ ] Stage 29/30 — staging + browser E2E (blockers recorded below)
- [ ] Stage 31 — monitoring/runbooks
- [ ] Stages 32–36 — commits/PR/gates/release (release expected BLOCKED)

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

Build the remaining staff surfaces (Stage 15 submission review, Stage 23
unified verification UI, Stage 16 rejection loop), Stage 17 evidence
references and Stage 20 screening orchestration; then staging deploy +
browser E2E once a staging frontend and provider deployment exist
(blockers above). Release remains BLOCKED pending approvals.
