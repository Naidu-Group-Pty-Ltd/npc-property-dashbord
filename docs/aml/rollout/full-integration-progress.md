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
- [ ] Stage 6 — attempt accounting in portal ops (uses
      aml.verification_attempts_used(); fallback for unmigrated schema)
- [ ] Stage 7 — transactional portal submission (idempotency, readiness gate)
- [ ] Stage 8 — verification outbox consumer (recovered file under review)
- [ ] Stage 9 — canonical provider-processing op (worker + staff retry share)
- [ ] Stage 10 — self-hosted service audit/config docs
- [ ] Stage 11 — client-safe readiness in portal
- [ ] Stage 12/13/14 — actionable requests, notifications, response contract
- [ ] Stage 15 — submission review workspace
- [ ] Stage 16 — document rejection loop
- [ ] Stage 17 — IDV evidence references
- [ ] Stage 18/19 — party reconciliation + verification links
- [ ] Stage 20 — party-scoped screening
- [ ] Stage 21 — canonical risk inputs
- [ ] Stage 22 — server-derived journey
- [ ] Stage 23 — unified staff surface
- [ ] Stage 24–26 — state consistency, security proofs, retention links
- [ ] Stage 27 — automated tests
- [ ] Stage 28 — database rehearsals (A fresh-ledger, B production-shaped)
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

Wire `verificationConsumer.ts` into the worker dispatch, deno-check both,
commit as `feat(aml): add idempotent verification worker`.
