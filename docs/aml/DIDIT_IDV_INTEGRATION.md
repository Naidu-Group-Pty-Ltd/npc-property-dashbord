# Didit hosted identity verification

Didit is an **identity verification** provider and nothing else in this
codebase. It performs three checks — ID Verification, Face Match 1:1 and
Passive Liveness — and its result lands in the existing canonical record,
`aml.verification_checks`, as an ordinary `electronic_idv` row.

Read this before touching `_shared/aml/providers/didit*`, `didit-webhook/`, or
the hosted branch of `aml-client-portal`.

---

## What this is NOT

- **Not a second KYC source of truth.** There is no Didit-owned table. The
  canonical record is `aml.verification_checks`, exactly as before.
- **Not AML screening.** Didit's AML module, PEP screening, sanctions, adverse
  media and transaction monitoring are **not enabled and must not be**. NPC
  screens against its own DFAT/UN/OFAC copies (`local_lists`), determines PEP
  status itself, and gates service on a human decision. `diditAmlScope.test.ts`
  fails the build if any of that changes.
- **Not a clearance.** A Didit approval means *identity verified*. It does not
  clear the case, and nothing in this integration writes to `aml.cases`,
  screening, risk, holds or the service gate.

## Why it needed a new flow rather than a new adapter

The existing IDV pipeline is **capture-flow**: the Client Portal photographs a
document and a selfie into NPC's private buckets, the outbox worker downloads
them, and `runIdv()` is a synchronous call carrying two base64 images.

Didit is **hosted-session**: it owns the capture UI, the customer completes it
there, and the outcome arrives later on a signed webhook. Forcing that through
`runIdv()` would have meant NPC collecting a customer's images and posting them
to a provider that never asked for them — a second copy of the most sensitive
data we hold, moved for nothing.

So `IdvFlow` is declared explicitly (`capture` | `hosted_session`) and the two
registries are separate. `getIdvProvider()` **throws** if the resolved provider
is hosted, which is what stops the outbox worker picking one up.

```
capture flow (selfhosted, unchanged)     hosted flow (didit)
─────────────────────────────────────    ──────────────────────────────────
portal camera → NPC storage              portal → server creates session
submit_verification                      start_hosted_verification
verification_checks (document_reference) verification_checks (no document)
  ↓ trigger emits                          ↓ trigger does NOT emit
aml.verification.requested                 (nothing enters the outbox)
  ↓                                        ↓
outbox worker downloads captures         customer completes on Didit's UI
runIdv() → canonicalOutcome()              ↓
                                         signed webhook → didit-webhook
                                           ↓ server re-reads the decision
                                         applyDiditDecision() → canonicalOutcome()
```

Both paths converge on the same `canonicalOutcome()`, so attempt accounting,
exhaustion and the technical-vs-identity boundary behave identically.

## Keeping Didit checks out of the self-hosted worker

This is the defect most likely to be reintroduced. The worker downloads
`check.document_reference`; a Didit check has none, so it would throw
`storage_unreadable:document` and stamp a technical failure on a check whose
real outcome is already on its way.

Three locks, deliberately:

1. **The database trigger** (`20260908000000`) emits
   `aml.verification.requested` only when `document_reference IS NOT NULL`.
   Written as the consumer's actual precondition rather than a provider name,
   so any future hosted provider is covered without editing it.
2. **The worker** returns before claiming when `idvFlowFor(check.provider)` is
   `hosted_session`, and again when `document_reference` is null. This catches
   a legacy event already in the outbox from before the migration.
3. **`getIdvProvider()`** throws on a hosted key, so even a direct call cannot
   run one through the capture path.

## Required-feature validation — the rule that matters

An `Approved` session is **not** a pass on its own. NPC requires all three
modules to have actually executed and returned a decisive result:

| Situation | NPC outcome | Attempt consumed |
|---|---|---|
| Approved, all three modules Approved | `passed` | yes |
| Approved, a module missing / `Not Finished` | `referred` | yes |
| Approved, a module `In Review` | `referred` | yes |
| A module `Declined` (any session status) | `failed` | yes |
| `Declined` | `failed` (or `exhausted`) | yes |
| `In Review` | `referred` | yes |
| Unrecognised status | `referred` | yes |
| `Not Started`/`In Progress`/`Awaiting User`/`Resubmitted` | no change | **no** |
| `Expired`/`Abandoned`/`Kyc Expired` | no change, slot released | **no** |
| Didit API/webhook failure | no change, technical | **no** |

Unknown never becomes passed.

### Three V3 facts that break the obvious implementation

Read off the live account, not from memory:

- **Results are arrays**: `id_verifications`, `liveness_checks`, `face_matches`
  — plural, and `null` until that feature has run. `decision.face_match.status`
  is `undefined`, which a naive mapper turns into a pass.
- **The ID module has two names**: `OCR` in the workflow graph,
  `ID_VERIFICATION` on the session and decision. Validation runs against the
  decision, so it uses the latter.
- **Feature and session vocabularies differ.** A feature is `Not Finished |
  Approved | Declined | In Review`. A session adds `Not Started`,
  `In Progress`, `Awaiting User`, `Expired`, `Abandoned`, `Kyc Expired`,
  `Resubmitted`. Collapsing them loses the difference between "walked away"
  (free retry) and "we looked and said no" (consumed attempt).

## Webhook security

`didit-webhook` runs with `verify_jwt = false` because Didit's servers cannot
carry a Supabase JWT. **The HMAC is the authentication boundary.**

- `X-Signature`: HMAC-SHA256 over the **exact raw bytes**, hex, constant-time
  compared. The body is read as text and verified *before* `JSON.parse`, because
  parse→stringify does not round-trip byte-for-byte.
- `X-Timestamp`: rejected when `|now − ts| > 300`. Absolute, so a
  far-future timestamp is refused too.
- Missing secret ⇒ `not_configured` ⇒ rejected. Never accepted in the clear.
- Verification happens **before** a service-role client is constructed.

### The body is not the decision

The payload carries a `decision` object and it is ignored. The signature proves
the event is real; it does not make the body safe to derive an identity outcome
from. The authoritative decision is re-read over an authenticated
server-to-server call, then checked for correlation: session id, the configured
workflow id, and `vendor_data` matching this case and party. Any mismatch is an
integration fault — recorded, never a customer outcome.

### Idempotency, and why de-duplication is not what protects the customer

`aml.provider_events (provider, dedup_key)` de-duplicates on Didit's `event_id`,
which their retries reuse. But de-dup can be raced, and a crash can land between
the event insert and the row update.

So the real guarantee is the **conditional UPDATE**: settling is filtered on
`attempt_consumed = false AND processing_status IN ('submitted','queued','processing')`.
The second writer matches zero rows and reports `already_applied`. An attempt
cannot be consumed twice however many times the handler runs.

The event row is recorded **before** processing and marked `processed_at` only
after. A delivery that crashes in between is re-processed rather than
short-circuited as a replay — the failure mode of "dedupe first, process
second", which silently drops the outcome and strands the customer.

## Sessions

At most one in-flight hosted session per party, enforced by a partial unique
index (`uq_aml_verification_active_hosted_session`) rather than by check-then-insert,
because every lost race is a real session NPC pays for.

A double-click, refresh, second tab or backend timeout all land on the same
session: the portal reconciles the existing check against Didit and returns the
customer to it. **The hosted URL is never stored** — it embeds the session token
— so it is re-read from the decision endpoint each time and passed straight
through to that customer's browser.

An abandoned or expired session is released (`processing_status = 'cancelled'`,
`superseded_at` set) leaving `status` and `attempt_consumed` untouched: not
finishing is not failing.

## What NPC stores, and what it deliberately does not

`outcome_detail.didit` is built by **allow-list** (`summariseDiditDecision`),
not by removing known-bad keys — a deny-list over someone else's versioned
payload is an invitation to persist a field that did not exist when the list was
written.

Stored: session id, workflow id/version, session status, environment, mapped
outcome, reason, per-feature status/score/warning-categories, timestamps.

**Never stored:** the API key, the webhook secret, the session URL or token
(the URL *is* a credential), any image or video reference (`front_image`,
`portrait_image`, `reference_image`, `video_url`, …), or the identity data read
off the document (document number, MRZ, DOB, name, address). Didit returns
signed URLs to the customer's ID photograph and liveness video; NPC never
fetches or persists them. Not holding a duplicate copy of the biometrics is the
point of using a hosted provider.

## Configuration

Provider selection is **server-side only**. The browser is told `capture` or
`hosted` and nothing more — never a provider key, never the workflow id.

Server-side secrets (Supabase Edge Function environment):

| Name | Purpose |
|---|---|
| `DIDIT_API_KEY` | server-to-server API calls (`x-api-key`) |
| `DIDIT_WEBHOOK_SECRET` | HMAC verification of inbound webhooks |
| `DIDIT_WORKFLOW_ID` | fallback if not set in provider config |

Readiness requires **all three**. A deployment holding only the API key would
create chargeable sessions whose results could never be accepted.

The workflow id is preferably set in tenant config
(`aml.provider_configs.config.workflow_id`) so it can change without a deploy.
The migration seeds the `didit` provider row **inactive**; switching NPC onto it
is a deliberate operator action:

```sql
UPDATE aml.provider_configs
   SET active = true,
       config = jsonb_set(config, '{workflow_id}', '"<workflow-uuid>"')
 WHERE tenant_id = 'default' AND capability = 'idv' AND provider_key = 'didit';
-- and deactivate the previous IDV provider if it should no longer take traffic.
```

The webhook destination is configured in the Didit console (or via MCP) as
**v3**, subscribed to `status.updated` and `data.updated`, pointing at
`https://<project-ref>.supabase.co/functions/v1/didit-webhook`.

## Tests

| File | Covers |
|---|---|
| `src/lib/aml/diditDecision.test.ts` | status vocabulary, required-feature validation, correlation, sanitisation, and a **verbatim real payload** from the live sandbox |
| `src/lib/aml/diditWebhookSecurity.test.ts` | signature, replay window, constant-time compare, receiver ordering, routing safety, session gates |
| `src/lib/aml/diditIdempotency.test.ts` | the ugly cases — duplicate/concurrent/crashed/out-of-order deliveries — run functionally against the real settling logic |
| `src/lib/aml/diditAmlScope.test.ts` | Didit AML never enabled, no case/screening writes, portal privacy boundary, no credential under `src/` |
