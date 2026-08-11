# Runbook — live negative tests (WP-15 / WP-22)

## What this is for

Every other security check in this repository reads source. This one asks the
**deployed** system whether the controls are actually there.

That distinction is the open item in the programme.
`CODEX_SECURITY_REMEDIATION_TRACKER.md` records `live_negative_test: false` on
**21 of 22** findings. The source is fixed and CI keeps it fixed; nothing has
ever confirmed that the functions running in production behave the way the
source says. A function that was never redeployed passes every static gate in
this repository.

Until this has been run once, "fixed" means "fixed in git".

## Before the first run

Three secrets, on a **`production-verification`** GitHub environment (the
workflow names it so you can put a required reviewer on it — these requests hit
production, and approving each run is the point rather than friction):

| Secret | What it is |
|---|---|
| `SUPABASE_URL` | `https://dduzbchuswwbefdunfct.supabase.co` |
| `SUPABASE_ANON_KEY` | the publishable key — already public, it ships in the browser bundle |
| `NON_SUPERADMIN_JWT` | an access token for an **active, non-superadmin** staff user |

Only the third needs care. It must be a real, currently-valid token for a user
who is *not* a superadmin — that is the whole point of NT-11 and NT-38, which
check that an authenticated-but-unprivileged caller is refused. A superadmin
token turns both rows green while proving the opposite of what they claim, so
this is the one input where being wrong is worse than being absent.

Access tokens expire. Expect to refresh this before each run; a stale token
shows up as NT-11 returning 401 instead of 403.

## Running it

Actions → **Security — live negative tests (WP-15)** → *Run workflow*.

Two optional inputs pick which cron-worker and internal-service function get
probed; the defaults (`market-updates-digest`, `agent-task-runner`) are fine
unless one of those has been retired.

## Reading the result

Each row prints one JSON line and lands in
`docs/security/wp15-evidence/<date>/negative-tests.jsonl`, uploaded as an
artifact for 90 days — including on failure, which is when it matters most.

```json
{"id":"NT-11","target":"admin-user-management","input":"authenticated non-superadmin JWT","expected":"403","observed":"403","result":"expected_denial"}
```

**`result` must be `expected_denial` on every row.** The job fails otherwise.

A `FAIL` means one of three things, and they need telling apart before anything
else happens:

1. **The control is genuinely missing in production.** Most likely cause: the
   function was never redeployed after the source fix. Check the deploy history
   for that function first — this is the failure mode the whole exercise exists
   to find.
2. **The credential is wrong.** A superadmin `NON_SUPERADMIN_JWT`, or an expired
   one. NT-11 and NT-38 are the rows that show this.
3. **The target moved.** A renamed or retired cron/internal function returns 404
   rather than 401, which reads as a failure and is not one. Fix the input, not
   the code.

## After a run

Update the `live_negative_test` flags in
`docs/security/CODEX_SECURITY_REMEDIATION_TRACKER.md` **from the run output**,
not by hand. A flag set from memory is worth less than the `false` it replaced,
because it looks like evidence.

## What it does not cover

Six of the original 36 matrix rows plus the four added by this programme. The
rest need a real portal session, provider fixtures, or a second tenant, and
adding them is per-row work. The matrix is the backlog; this harness is the part
that runs today.

Notably absent: everything requiring a client-portal or finance-portal session
(NT-12, NT-13, NT-15), storage signed-URL rebinding (NT-20, NT-21), and the
step-up replay rows (NT-17, NT-33 … NT-36) — those last are covered at source by
six dedicated gates in `scripts/security/`, but source is not deployment, which
is the entire premise of this document.
