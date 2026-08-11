# Identity verification inside NPC — the Didit Standalone APIs

**Read this before touching anything in the identity path.** The customer's
whole experience, the money, and the attempt allowance all hang off decisions
recorded here, and three of them are counter-intuitive.

The hosted flow that this replaces is [`DIDIT_IDV_INTEGRATION.md`](./DIDIT_IDV_INTEGRATION.md).
It is not deleted and must not be — see [Legacy](#legacy-what-is-still-wired-and-why).

## The shape

```
customer
  → NPC client portal
  → NPC camera (getUserMedia, in the page)
  → private Supabase Storage    aml-documents / aml-biometrics
  → aml-verification-processor  (Edge Function, holds the credential)
  → POST /v3/id-verification/     ┐
  → POST /v3/passive-liveness/    ├ three separately billed calls
  → POST /v3/face-match/          ┘
  → composeStandaloneOutcome      (one identity position)
  → aml.verification_checks       (canonical row)
  → portal-safe state
```

The browser never calls Didit, never holds the key, never sees a score or a
threshold, and never opens a window. There is no session, no `verification_url`,
no callback, no webhook and no SDK on the new path.

| Module | What it owns |
| --- | --- |
| `_shared/aml/identityDocuments.pure.ts` | the four documents, and which sides each needs |
| `_shared/aml/providers/diditStandalone.pure.ts` | reading responses, sanitising them, composing one outcome |
| `_shared/aml/providers/diditStandaloneClient.ts` | the three multipart calls. The only holder of `DIDIT_API_KEY` on this path |
| `_shared/aml/standaloneVerification.ts` | the sequence: claim, fail-fast, settle |
| `aml-verification-processor` | runs it, off the customer's request |
| `aml-client-portal` | `prepare_verification_attempt`, `submit_verification_attempt` |
| `IdentityVerificationStep.tsx` | choose → brief → front → back? → selfie → uploading → checking |

## Three things that keep biting

### 1. These calls cost money, and there is no idempotency key

Didit bills per **200 response**. `vendor_data` is documented as an opaque
correlation string and **explicitly not** as an idempotency key — do not treat
it as one. Everything below follows from that:

- **One owner per attempt.** `claimCheck` is a conditional `UPDATE` from a
  queued state to `processing`. A double tap, a second tab, a re-fired cron
  sweep and a redelivered outbox event all lose it and walk away.
- **Nothing retries a paid call.** The outbox machinery retries a *throwing*
  consumer ten times with backoff. For the self-hosted service that is correct;
  here it would be ten unattended purchases of one verification. The standalone
  branch in `verificationConsumer.ts` therefore **returns without throwing**,
  whatever happened. Do not "fix" that.
- **An ambiguous timeout stops the sequence.** The request left and we never
  learned what happened to it, so the billing state is unknown. It is recorded
  `provider_error_category = 'timeout'` with `billing_unknown: true`, consumes
  no attempt, and nothing re-sends it. A stale claim is retired to
  `technical_failure` by the sweep rather than re-run, for the same reason.

The controlled retry is a **fresh customer submission**, which consumes nothing
from the failed attempt.

### 2. Both thresholds are required, and a missing one means NOT READY

`DIDIT_LIVENESS_THRESHOLD` and `DIDIT_FACE_MATCH_THRESHOLD` (0–100). The
endpoints default to **30**, which Didit's own documentation calls permissive.
Inheriting that would make NPC's compliance position a vendor default nobody
chose, so `getStandaloneIdvProvider` **throws** when either is missing or out of
range, the portal reads that as unavailable, and no biometric is collected.

`DIDIT_WORKFLOW_ID` and `DIDIT_WEBHOOK_SECRET` are **not** required here. There
is no workflow and, with `save_api_request=false`, no session persists on
Didit's side and no webhook is ever emitted. Requiring either would refuse a
correctly configured deployment. They remain required by the *hosted* adapter.

Both thresholds are written onto every attempt (`outcome_detail.standalone
.thresholds_applied`) so a reviewer months later can see the policy in force on
the day.

### 3. An Australian driver licence has no MRZ

`invalid_mrz_action` and `inconsistent_data_action` both default to `DECLINE`.
A licence carries no ICAO machine-readable zone at all, so the default risks
declining a valid document for lacking a feature it was never issued with — and
a decline spends the customer's attempt and records an identity failure.

Both are sent as `NO_ACTION` and the corresponding warnings are mapped to a
**referral** in `diditStandalone.pure.ts` instead. Referring cannot produce a
false pass, which is the only outcome that would be worse.

## Reading a response

**A 200 is not a pass.** All three endpoints answer 200 with
`status: "Declined"`. Read the feature block.

**Unknown is never passed.** A missing block, an unparseable status, or a
document classified as something the customer did not select is a referral —
never a verification, and never (on its own) a finding against them.

**Unreadable is not failed.** `COULD_NOT_DETECT_DOCUMENT_TYPE`,
`NO_FACE_DETECTED`, `PORTRAIT_IMAGE_NOT_DETECTED` and a 400 carrying
`COULD_NOT_RECOGNIZE_DOCUMENT` all mean "we could not look", which is fixed by
taking the photograph again. They record `capture_unusable`, consume **no**
attempt, and the portal asks for a retake. `unreadable` beats `declined` in the
roll-up for exactly this reason.

### The composition rule

| Outcome | When |
| --- | --- |
| `verified` | all three Approved **and** the detected document is consistent with what the customer chose |
| `failed` | a step Declined on evidence — document security, liveness, face match |
| `pending` → `capture_unusable` | any step could not examine the capture. No attempt spent |
| `manual_review` → `referred` | everything else: indeterminate, a step that never ran, a classification mismatch |

**Identity Verified is not AML approved.** It is not a service gate, not a risk
position and not a screening result. Do not connect them.

### The check the hosted flow never needed

The hosted session restricted the capture with `expected_details`, so the
provider enforced country and document type on its own screen. The Standalone
ID endpoint has **no such parameter** — it classifies the document and tells us
what it found. So the restriction became a comparison after the fact
(`documentConsistency`): a mismatch can never become Verified, and it is not a
finding against the customer either, so it goes to a human.

## Storage and evidence

The browser never chooses a path. `prepare_verification_attempt` mints
`{caseId}/verification/{attemptId}/…` and stores it on the row; submission sends
an **attempt id and nothing else**. Both buckets are private and neither has
ever been public; the selfie stays in `aml-biometrics`, whose access policy is
tighter and whose reads are logged.

Nothing image-shaped is persisted. `portrait_image`, `front_image` and
`back_image` are stripped **by name** before anything reaches `outcome_detail`,
on top of the size-based sweep in `verificationEvidence.pure.ts` — the name
list exists because a short base64 string is still a face. Extracted name,
address, date of birth and MRZ are stripped too: they already live in the case
record, entered by the customer and adjudicated by staff.

The ID portrait is used **in server memory** as the face-match reference and
discarded. It is never persisted, logged, or returned to a browser.

**Retention of the source captures is unchanged and unresolved.** Nothing
deletes them after the provider answers. NPC's AML/privacy retention policy
governs them, and this programme deliberately did not invent a duration — that
is an operational follow-up, not a code change.

## Attempts

`1 initial + 2 retries = 3 consumed`, unchanged, counted by
`aml.verification_attempts_used()` which counts `attempt_consumed` rows only.

**Consumes nothing:** preparing, minting upload URLs, uploading, retaking,
cancelling, refreshing, a network failure, a timeout, a 429, a 5xx, a
credential or credit failure, a request Didit refused, an unreadable capture.

**Consumes an attempt:** a completed substantive outcome — a document that
failed its security checks, a liveness rejection, a face that did not match, or
a referral. Only `canonicalOutcome` decides, and it is shared with the
self-hosted path and the staff re-run so the three cannot drift.

## The dispatcher that was missing

`aml.verification.requested` has been emitted since `20260831000100` and had a
consumer the same day — but **nothing in this project has ever driven
`cross-portal-outbox-worker`**. Production `cron.job` holds 40 schedules and
names it in none of them. The self-hosted provider has never been active
(0 rows ever), so nobody had met it. A submission would have sat `queued` for
ever.

So: the portal dispatches `aml-verification-processor` directly (the wait is
seconds), **and** pg_cron runs its sweep every minute (a reclaimed isolate
cannot strand anybody). The outbox trigger now fires on `UPDATE` as well as
`INSERT`, because a draft becomes queued by an update and previously emitted
nothing. `idempotency_key` is per row, so it still emits exactly once.

## Legacy: what is still wired, and why

The hosted adapter, `start_hosted_verification`, `didit-webhook` and
`SecureIdentityCheck` all remain. On 2026-08-08 two hosted checks were still
`processing` in production, and removing the adapter would strand their
decisions. **No new attempt uses any of it**: the portal renders the capture
journey, and the older single-shot capture ops answer `capture_flow_superseded`
under the Standalone provider.

They can be removed once no `verification_checks` row has
`provider = 'didit'` with `processing_status` in
`('submitted','queued','processing')` and `superseded_at IS NULL`. At that
point `DIDIT_WORKFLOW_ID` and `DIDIT_WEBHOOK_SECRET` can go too.

## Switching a tenant on

Provider selection is server-side configuration and stays that way; the browser
can never send a provider. Both rows are seeded inactive:

```sql
UPDATE aml.provider_configs SET active = true
 WHERE tenant_id = 'default' AND capability = 'idv' AND provider_key = 'didit_standalone';
UPDATE aml.provider_configs SET active = false
 WHERE tenant_id = 'default' AND capability = 'idv' AND provider_key = 'didit';
```

Two statements, deliberately: `resolveTenantProvider` takes the
highest-priority **active** row, so exactly one may be active at a time.

Set `DIDIT_LIVENESS_THRESHOLD` and `DIDIT_FACE_MATCH_THRESHOLD` **before**
activating, or the portal will correctly report verification as unavailable.
Use a sandbox key while testing: sandbox keys return mock data and are not
billed. Never put a key in source.
