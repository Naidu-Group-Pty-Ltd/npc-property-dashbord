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

### `POST /v3/session/` is an upsert, not a create

**It deduplicates on `workflow_id + vendor_data`.** Measured against the live
API rather than inferred: two calls with the same pair returned byte-identical
`session_id` and session token, left `session_number` unchanged, and merely
overwrote `metadata`. Changing one character of `vendor_data` returned a
genuinely new session.

That is why `vendor_data` is scoped to the attempt —
`npc:<case>:<party|primary>:<capture-sequence>`. With a case-and-party-only key
there was no way to ask for a session under a new configuration: the key was
stable for the life of the case, so every request for seven days returned the
same session, whatever had changed in between.

The counter is `capture_sequence`, which already existed on the row. It is
server-generated, monotonic per case and party, and carries no PII. It is **not
a charged attempt** — attempts are counted from settled outcomes
(`verification_attempts_used`), so re-minting for a technical reason costs the
customer nothing.

`parseVendorData` accepts both the three-part and four-part forms. Sessions
minted before attempt scoping stay valid for seven days, and refusing to parse
them would strand a live customer's decision.

### Stale configuration

A session is created against the workflow as it stood at that instant. Combined
with the dedup above, a customer who pressed Start before a workflow change was
pinned to the old configuration until the session expired — a reconfiguration
that never reached the people it was made for. That is what left customers on
the cross-device QR screen after `is_desktop_allowed` had already been
corrected.

Didit cannot tell you this happened: editing a published workflow mutates the
version **in place**, so a session created before the edit and the live
workflow after it both report `workflow_version: 1`. There is no obsolete
version number to compare.

So the marker is NPC's. `aml.provider_configs.config.workflow_revised_at` is an
ISO-8601 instant, **set by whoever changes the Didit workflow**:

```sql
UPDATE aml.provider_configs
   SET config = jsonb_set(config, '{workflow_revised_at}',
                          to_jsonb('<the workflow's updated_at>'::text), true)
 WHERE tenant_id = 'default' AND capability = 'idv' AND provider_key = 'didit';
```

`start_hosted_verification` releases any in-flight session created before it and
mints a fresh one. That release is a **technical supersede**: `status` and
`attempt_consumed` are untouched, no identity outcome is written, and the
timeline entry is categorised `technical`. Forgetting to set the marker is safe
in the boring direction — the guard does nothing, which is how it behaved
before it existed.

### One session per party

At most one in-flight hosted session per party, enforced by a partial unique
index (`uq_aml_verification_active_hosted_session`) rather than by check-then-insert,
because every lost race is a real session NPC pays for.

The attempt scope does not weaken this. Repeated requests for the *same*
attempt still produce the same key and therefore the same session, so a
double-click cannot buy two. Only a new attempt gets a new key.

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

## The workflow flag that decides whether the customer uses one device or two

**`is_desktop_allowed` defaults to `false` on a newly created workflow, and it
is the single most consequential setting on it.**

With it off, Didit refuses desktop capture outright. The customer does not get
a camera — they get a full-screen QR code and "continue on another device" as
the *primary* experience, with same-device capture nowhere. That is what
production shipped with, and it is not diagnosable from this repo: the portal
code is identical either way, the session is created normally, the API returns
200, and the only difference is what the provider's own page decides to render
inside the frame. The second "I have finished"-style button customers reported
was the handoff screen's own control, not a duplicate of ours.

Read it back after any workflow change:

```
didit_workflow_get → { "is_desktop_allowed": true, "status": "published" }
```

Both the live and sandbox `NPC Identity Verification` workflows are set to
`true`. Do not create a replacement workflow without setting it.

### What the embed must not withhold

The flag is the cause, but the frame can re-create the symptom. The provider
decides a device "cannot capture" from what actually works inside the iframe,
so a withheld capability becomes a device handoff rather than an error anyone
can see:

- **Delegate the provider's full documented `allow` set**, not just `camera`.
  `autoplay` and `encrypted-media` were missing, and the liveness pipeline is a
  video stream — a blocked one reads as "no camera".
- **No `sandbox` attribute.** On a cross-origin frame already granted
  `allow-same-origin allow-scripts` it contains nothing the same-origin policy
  is not already containing, and it silently withholds capabilities (downloads,
  presentation, storage access, pointer lock) that the capture uses.
- **Give it room.** A viewfinder inside a fixed-height box with its controls
  below the fold is a usability failure that reads to the customer as a broken
  camera.

### The flag is necessary, not sufficient

Correcting the workflow does not reach a customer who already has a session.
See "Stale configuration" under **Sessions** — the session is pinned to the
configuration it was minted under, and the provider will hand the same session
back for the same `vendor_data`. After changing the workflow, set
`config.workflow_revised_at`; without it the fix reaches nobody who had already
pressed Start.

One more to rule out if same-device capture still fails: a
`Permissions-Policy: camera=()` response header on the *portal's own document*
blocks the camera regardless of the iframe's `allow`. Check the document
request's response headers in DevTools — a header seen on a Cloudflare
challenge page (`HTTP 403`, `cf-mitigated: challenge`) is not the app's.

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
| `src/components/portal/IdentityVerificationStep.test.tsx` | the hosted flow rendered for real — server-minted session, the full documented permission set delegated, no sandbox, no failure warning before a failure, the fallback behind an explicit ask, and neither "I have finished" nor a provider message asserting anything |
| `src/lib/aml/idvAdapterReadiness.test.ts` | wiring comes from the registry, not a hardcoded key — hosted and capture providers both report correctly, `wired` stays distinct from `configured`, and readiness never carries a credential |
| `src/lib/aml/diditSessionLifecycle.test.ts` | a session minted under superseded configuration is not returned, a new attempt gets a genuinely new session while the same attempt stays idempotent, correlation still resolves case/party/attempt, and superseding costs no attempt and writes no outcome |

Two harnesses go further than unit tests, because the failures that matter most
here are wiring failures — and wiring is invisible to a unit test:

| Command | What it actually runs |
|---|---|
| `npm run test:didit-webhook` | boots the REAL `didit-webhook` function as a Deno process and drives it over HTTP with genuinely signed requests against an in-memory PostgREST + Didit stand-in. 20 scenarios, 75 assertions: duplicate/concurrent/crashed/out-of-order deliveries, bad signatures, stale timestamps, tampered bodies, wrong workflow, wrong party, every status, and a decision API outage. |
| `npm run test:didit-migration` | applies the migration chain to a throwaway PostgreSQL and asserts the behaviour the SQL exists for: a selfhosted check still emits `aml.verification.requested`, a hosted check emits nothing, a second active hosted session is refused with 23505, releasing an abandoned one frees the slot, and re-applying is a no-op. |

Neither needs credentials or network access to Didit.
